import { randomUUID } from "node:crypto";
import { one, rows } from "./db.js";
import {
  D,
  allow,
  FINANCE,
  assert,
  text,
  uuid,
  number,
  date,
  today,
} from "./validation.js";
const money = (v) => number(v, true, 2);
const day = (v) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const optional = (v, max = 200) =>
  String(v || "")
    .trim()
    .slice(0, max);
async function get(db, table, id) {
  const r = await one(db, `SELECT * FROM ${table} WHERE id=$1`, [uuid(id)]);
  assert(r, "Không tìm thấy chứng từ.", 404);
  return r;
}
async function openDate(db, value) {
  const d = date(value);
  assert(d && d <= today(), "Ngày ghi nhận phải hợp lệ và không ở tương lai.");
  const s = await one(db, "SELECT closed_through FROM settings WHERE id=1");
  assert(!s.closed_through || d > day(s.closed_through), "Kỳ đã khóa.");
  return d;
}
async function latest(db, partner, side) {
  return one(
    db,
    `SELECT MAX(d) AS last_date FROM (
 SELECT business_date d FROM debt_documents WHERE partner_id=$1 AND side=$2 AND status='posted'
 UNION ALL SELECT business_date FROM cash_payments WHERE partner_id=$1 AND side=$2 AND status IN ('posted','void')
 UNION ALL SELECT void_date FROM cash_payments WHERE partner_id=$1 AND side=$2 AND status='void'
 UNION ALL SELECT s.business_date FROM settlements s JOIN cash_payments p ON p.id=s.payment_id WHERE p.partner_id=$1 AND p.side=$2) q`,
    [partner, side],
  );
}
async function postingDate(db, d, partner, side) {
  const value = await openDate(db, d);
  const last = await latest(db, partner, side);
  assert(
    !last.last_date || value >= day(last.last_date),
    "Không ghi lùi trước phát sinh công nợ/thu chi của đối tác.",
  );
  return value;
}
async function remainingDebt(db, id) {
  return one(
    db,
    `SELECT d.*,
 d.amount-COALESCE((SELECT SUM(c.amount) FROM debt_documents c WHERE c.source_debt_id=d.id AND c.status='posted'),0)-COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.debt_id=d.id),0) remaining
 FROM debt_documents d WHERE d.id=$1`,
    [id],
  );
}
async function remainingCash(db, id) {
  return one(
    db,
    `SELECT p.*,p.amount-COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.payment_id=p.id),0) remaining FROM cash_payments p WHERE p.id=$1`,
    [id],
  );
}
async function partnerCheck(db, partner, side) {
  assert(["ar", "ap"].includes(side), "Chọn phải thu hoặc phải trả.");
  const p = await get(db, "partners", partner);
  assert(
    p.kind === "both" || p.kind === (side === "ar" ? "customer" : "supplier"),
    "Đối tác không đúng vai trò phải thu/phải trả.",
  );
}
export async function financeCommand(db, actor, input) {
  allow(actor, FINANCE);
  const id = randomUUID(),
    action = input.action;
  if (action === "finance.debt.create") {
    const kind = input.kind || "charge";
    assert(["charge", "credit"].includes(kind), "Loại công nợ không hợp lệ.");
    let partner = input.partner_id,
      side = input.side,
      project = input.project_id || null,
      pk = input.package_id || null,
      po = input.purchase_order_id || null,
      source = input.source_document_id || null,
      sourceDebt = null;
    if (kind === "credit") {
      sourceDebt = await get(db, "debt_documents", input.source_debt_id);
      assert(
        sourceDebt.status === "posted" && sourceDebt.kind === "charge",
        "Chứng từ giảm phải tham chiếu khoản nợ đã ghi sổ.",
      );
      partner = sourceDebt.partner_id;
      side = sourceDebt.side;
      project = sourceDebt.project_id;
      pk = sourceDebt.package_id;
      po = sourceDebt.purchase_order_id;
      source = null;
    }
    await partnerCheck(db, partner, side);
    if (pk) {
      const p = await get(db, "packages", pk);
      assert(
        !project || project === p.project_id,
        "Gói thầu không thuộc dự án.",
      );
      project = p.project_id;
    }
    if (project) {
      const p = await get(db, "projects", project);
      if (side === "ar")
        assert(p.customer_id === partner, "Khách hàng không khớp dự án.");
    }
    if (po) {
      const p = await get(db, "purchase_orders", po);
      assert(
        side === "ap" && p.supplier_id === partner,
        "Đơn mua không thuộc nhà cung cấp phải trả.",
      );
      assert(["approved", "closed"].includes(p.status), "Đơn mua chưa duyệt.");
    }
    if (source) {
      const d = await get(db, "documents", source);
      assert(
        d.status === "posted" &&
          d.type === (side === "ar" ? "dispatch" : "receipt"),
        "Chứng từ kho nguồn không hợp lệ.",
      );
      const links = await rows(
        db,
        `SELECT l.project_item_id,i.package_id,pk.project_id,pj.customer_id,p.supplier_id,l.purchase_line_id FROM document_lines l LEFT JOIN project_items i ON i.id=l.project_item_id LEFT JOIN packages pk ON pk.id=i.package_id LEFT JOIN projects pj ON pj.id=pk.project_id LEFT JOIN purchase_lines pl ON pl.id=l.purchase_line_id LEFT JOIN purchase_orders p ON p.id=pl.order_id WHERE l.document_id=$1`,
        [source],
      );
      assert(
        links.length &&
          links.every((l) =>
            side === "ar"
              ? l.customer_id === partner &&
                (!project || l.project_id === project) &&
                (!pk || l.package_id === pk)
              : l.supplier_id === partner,
          ),
        "Chứng từ kho không xác minh được đúng đối tác/dự án.",
      );
    }
    const business = date(input.business_date),
      due = date(input.due_date || input.business_date);
    assert(
      business && due && due >= business,
      "Ngày đến hạn phải từ ngày ghi nhận trở đi.",
    );
    await db.query(
      `INSERT INTO debt_documents(id,code,side,kind,partner_id,project_id,package_id,purchase_order_id,source_document_id,source_debt_id,reference,note,business_date,due_date,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        text(input.code, "Số chứng từ", 60).toUpperCase(),
        side,
        kind,
        partner,
        project,
        pk,
        po,
        source,
        sourceDebt?.id || null,
        optional(input.reference),
        text(input.note, "Nội dung / căn cứ", 2000),
        business,
        due,
        money(input.amount),
        actor.id,
      ],
    );
    return { id };
  }
  if (action === "finance.payment.create") {
    await partnerCheck(db, input.partner_id, input.side);
    assert(
      ["bank", "cash"].includes(input.method),
      "Phương thức không hợp lệ.",
    );
    const business = date(input.business_date);
    assert(business, "Nhập ngày thu/chi.");
    await db.query(
      `INSERT INTO cash_payments(id,code,side,partner_id,business_date,amount,method,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        text(input.code, "Số phiếu", 60).toUpperCase(),
        input.side,
        input.partner_id,
        business,
        money(input.amount),
        input.method,
        optional(input.reference),
        text(input.note, "Nội dung thu/chi", 2000),
        actor.id,
      ],
    );
    return { id };
  }
  if (/^finance\.(debt|payment)\.(submit|post|cancel)$/.test(action)) {
    const [, type, op] = action.split("."),
      table = type === "debt" ? "debt_documents" : "cash_payments",
      d = await get(db, table, input.id);
    assert(
      Number(input.version) === d.version,
      "Chứng từ đã thay đổi, hãy tải lại.",
      409,
    );
    assert(
      op === "post"
        ? d.status === "submitted"
        : op === "cancel"
          ? ["draft", "submitted"].includes(d.status)
          : d.status === "draft",
      "Trạng thái chứng từ không cho phép thao tác.",
      409,
    );
    if (op === "post") {
      assert(
        actor.role === "admin" || d.created_by !== actor.id,
        "Người lập không tự duyệt chứng từ.",
      );
      await partnerCheck(db, d.partner_id, d.side);
      await postingDate(db, day(d.business_date), d.partner_id, d.side);
      if (type === "debt" && d.kind === "credit") {
        const original = await remainingDebt(db, d.source_debt_id);
        assert(
          original.status === "posted" && D(original.remaining).gte(d.amount),
          "Giảm vượt công nợ chưa thanh toán. Hoàn tác phân bổ trước nếu cần.",
        );
      }
      await db.query(
        `UPDATE ${table} SET status='posted',posted_by=$1,posted_at=now(),version=version+1 WHERE id=$2`,
        [actor.id, d.id],
      );
    } else
      await db.query(
        `UPDATE ${table} SET status=$1,version=version+1 WHERE id=$2`,
        [op === "submit" ? "submitted" : "cancelled", d.id],
      );
    return { id: d.id };
  }
  if (action === "finance.allocate") {
    const p = await remainingCash(db, uuid(input.payment_id)),
      d = await remainingDebt(db, uuid(input.debt_id));
    assert(p && d, "Không tìm thấy khoản thu/chi hoặc công nợ.", 404);
    assert(
      p.status === "posted" && d.status === "posted" && d.kind === "charge",
      "Chỉ phân bổ chứng từ đã ghi sổ.",
    );
    assert(
      p.side === d.side && p.partner_id === d.partner_id,
      "Không phân bổ khác đối tác hoặc khác chiều phải thu/phải trả.",
    );
    const amount = money(input.amount);
    assert(
      D(amount).lte(p.remaining) && D(amount).lte(d.remaining),
      "Phân bổ vượt tiền chưa dùng hoặc khoản nợ còn lại.",
    );
    const business = await postingDate(
      db,
      input.business_date,
      p.partner_id,
      p.side,
    );
    assert(
      business >= day(p.business_date) && business >= day(d.business_date),
      "Ngày phân bổ trước chứng từ nguồn.",
    );
    await db.query(
      "INSERT INTO settlements(id,payment_id,debt_id,amount,business_date,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [id, p.id, d.id, amount, business, actor.id],
    );
    return { id };
  }
  if (action === "finance.allocation.reverse") {
    const s = await get(db, "settlements", input.id);
    assert(D(s.amount).gt(0), "Chỉ hoàn tác phân bổ gốc.");
    assert(
      !(await one(db, "SELECT id FROM settlements WHERE reverses_id=$1", [
        s.id,
      ])),
      "Phân bổ đã hoàn tác.",
      409,
    );
    text(input.reason, "Lý do hoàn tác", 1000);
    const p = await get(db, "cash_payments", s.payment_id);
    const business = await postingDate(
      db,
      input.business_date,
      p.partner_id,
      p.side,
    );
    assert(
      business >= day(s.business_date),
      "Ngày hoàn tác trước ngày phân bổ.",
    );
    await db.query(
      "INSERT INTO settlements(id,payment_id,debt_id,amount,business_date,created_by,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        s.payment_id,
        s.debt_id,
        D(s.amount).neg().toFixed(2),
        business,
        actor.id,
        s.id,
      ],
    );
    return { id };
  }
  if (action === "finance.payment.void") {
    const p = await remainingCash(db, uuid(input.id));
    assert(p?.status === "posted", "Phiếu chưa ghi sổ hoặc đã hủy.", 409);
    assert(Number(input.version) === p.version, "Phiên bản đã thay đổi.", 409);
    assert(
      D(p.remaining).eq(p.amount),
      "Phải hoàn tác toàn bộ phân bổ trước khi hủy phiếu.",
    );
    const business = await postingDate(
      db,
      input.business_date,
      p.partner_id,
      p.side,
    );
    await db.query(
      "UPDATE cash_payments SET status='void',void_date=$1,void_reason=$2,voided_by=$3,version=version+1 WHERE id=$4",
      [business, text(input.reason, "Lý do hủy", 1000), actor.id, p.id],
    );
    return { id: p.id };
  }
  assert(false, "Thao tác công nợ không hợp lệ.", 404);
}
export async function financeState(db, actor, asOf = today()) {
  allow(actor, FINANCE);
  const asof = date(asOf);
  assert(asof, "Ngày báo cáo không hợp lệ.");
  const debts = await rows(
    db,
    `SELECT d.*,p.name partner_name,p.code partner_code,COALESCE((SELECT SUM(c.amount) FROM debt_documents c WHERE c.source_debt_id=d.id AND c.status='posted' AND c.business_date<=$1),0) credited,COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.debt_id=d.id AND s.business_date<=$1),0) allocated FROM debt_documents d JOIN partners p ON p.id=d.partner_id WHERE d.business_date<=$1 ORDER BY d.business_date DESC,d.code`,
    [asof],
  );
  const payments = await rows(
    db,
    `SELECT p.*,pt.name partner_name,pt.code partner_code,COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.payment_id=p.id AND s.business_date<=$1),0) allocated FROM cash_payments p JOIN partners pt ON pt.id=p.partner_id WHERE p.business_date<=$1 ORDER BY p.business_date DESC,p.code`,
    [asof],
  );
  const settlements = await rows(
    db,
    `SELECT s.*,p.code payment_code,d.code debt_code,p.partner_id,p.side FROM settlements s JOIN cash_payments p ON p.id=s.payment_id JOIN debt_documents d ON d.id=s.debt_id WHERE s.business_date<=$1 ORDER BY s.business_date DESC,s.created_at DESC`,
    [asof],
  );
  const summaries = new Map(),
    events = [];
  function summary(r) {
    const k = r.side + ":" + r.partner_id;
    if (!summaries.has(k))
      summaries.set(k, {
        id: k,
        side: r.side,
        partner_id: r.partner_id,
        partner_code: r.partner_code,
        partner_name: r.partner_name,
        charged: D(0),
        credited: D(0),
        paid: D(0),
        remaining: D(0),
        advance: D(0),
        overdue: D(0),
        due_1_30: D(0),
        due_31_60: D(0),
        due_61_90: D(0),
        due_over_90: D(0),
      });
    return summaries.get(k);
  }
  for (const d of debts) {
    d.remaining =
      d.kind === "charge"
        ? D(d.amount).minus(d.credited).minus(d.allocated).toFixed(2)
        : "0.00";
    d.overdue_days = Math.max(
      0,
      Math.floor((Date.parse(asof) - Date.parse(day(d.due_date))) / 86400000),
    );
    if (d.status !== "posted") continue;
    const s = summary(d);
    if (d.kind === "charge") {
      s.charged = s.charged.plus(d.amount);
      s.remaining = s.remaining.plus(d.remaining);
      if (d.overdue_days > 0 && D(d.remaining).gt(0)) {
        s.overdue = s.overdue.plus(d.remaining);
        const k =
          d.overdue_days <= 30
            ? "due_1_30"
            : d.overdue_days <= 60
              ? "due_31_60"
              : d.overdue_days <= 90
                ? "due_61_90"
                : "due_over_90";
        s[k] = s[k].plus(d.remaining);
      }
    } else s.credited = s.credited.plus(d.amount);
    events.push({
      id: d.id,
      partner_id: d.partner_id,
      side: d.side,
      date: day(d.business_date),
      code: d.code,
      type: d.kind === "charge" ? "Ghi nhận công nợ" : "Giảm công nợ",
      amount: D(d.amount)
        .mul(d.kind === "charge" ? 1 : -1)
        .toFixed(2),
      note: d.note,
    });
  }
  for (const p of payments) {
    const active =
      p.status === "posted" || (p.status === "void" && day(p.void_date) > asof);
    p.remaining = active ? D(p.amount).minus(p.allocated).toFixed(2) : "0.00";
    p.effective_status = active ? "posted" : p.status;
    if (!["posted", "void"].includes(p.status)) continue;
    const s = summary(p);
    if (active) {
      s.paid = s.paid.plus(p.amount);
      s.advance = s.advance.plus(p.remaining);
    }
    events.push({
      id: p.id,
      partner_id: p.partner_id,
      side: p.side,
      date: day(p.business_date),
      code: p.code,
      type: p.side === "ar" ? "Thu tiền" : "Chi tiền",
      amount: D(p.amount).neg().toFixed(2),
      note: p.note,
    });
    if (p.status === "void" && day(p.void_date) <= asof)
      events.push({
        id: p.id + "-void",
        partner_id: p.partner_id,
        side: p.side,
        date: day(p.void_date),
        code: p.code,
        type: "Hủy thu/chi",
        amount: p.amount,
        note: p.void_reason,
      });
  }
  const numericKeys = [
    "charged",
    "credited",
    "paid",
    "remaining",
    "advance",
    "overdue",
    "due_1_30",
    "due_31_60",
    "due_61_90",
    "due_over_90",
  ];
  const balances = Array.from(summaries.values()).map((s) => ({
    ...s,
    net: s.remaining.minus(s.advance).toFixed(2),
    ...Object.fromEntries(numericKeys.map((k) => [k, s[k].toFixed(2)])),
  }));
  events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const running = new Map();
  for (const e of events) {
    const k = e.side + e.partner_id;
    const v = (running.get(k) || D(0)).plus(e.amount);
    running.set(k, v);
    e.balance = v.toFixed(2);
  }
  return { asof, debts, payments, settlements, balances, events };
}
