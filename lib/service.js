import { randomUUID, createHash } from "node:crypto";
import { one, rows, transaction } from "./db.js";
import {
  D,
  AppError,
  assert,
  text,
  code,
  uuid,
  number,
  date,
  today,
  allow,
} from "./validation.js";
import { createUser, hashPassword } from "./auth.js";
const managers = ["admin", "manager"];
const workers = [...managers, "warehouse"];
const planners = [...managers, "project"];
const id = () => randomUUID();
const q6 = (v) => D(v).toFixed(6);
const activeUser = async (db, actor) => {
  const u = await one(db, "SELECT id,name,role,active FROM users WHERE id=$1", [
    actor.id,
  ]);
  assert(u?.active, "Tài khoản không còn hoạt động.", 401);
  return u;
};
async function get(db, table, value) {
  const r = await one(db, `SELECT * FROM ${table} WHERE id=$1`, [uuid(value)]);
  assert(r, "Không tìm thấy bản ghi.", 404);
  return r;
}
async function itemAccess(db, actor, itemId) {
  const item = await one(
    db,
    `SELECT i.*,pj.owner_id FROM project_items i JOIN packages pk ON pk.id=i.package_id JOIN projects pj ON pj.id=pk.project_id WHERE i.id=$1`,
    [uuid(itemId)],
  );
  assert(item, "Không tìm thấy dòng kế hoạch.", 404);
  if (actor.role === "project")
    assert(item.owner_id === actor.id, "Dự án ngoài phạm vi của bạn.", 403);
  return item;
}
async function audit(db, actor, action, entity, details) {
  await db.query(
    "INSERT INTO audit_logs(id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [id(), actor.id, action, entity, JSON.stringify(details)],
  );
}
export async function progress(db, itemId) {
  const item = await get(db, "project_items", itemId);
  const delivered = await one(
    db,
    `SELECT COALESCE(SUM(l.qty-l.returned_qty),0) shipped,COALESCE(SUM(l.handed_qty-l.returned_qty),0) handed
 FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE l.project_item_id=$1 AND d.type='dispatch' AND d.status='posted'`,
    [itemId],
  );
  const held = await one(
    db,
    "SELECT COALESCE(SUM(remaining),0) n FROM reservations WHERE project_item_id=$1",
    [itemId],
  );
  const ordered = await one(
    db,
    `SELECT COALESCE(SUM(l.qty-l.received_qty),0) n FROM purchase_lines l JOIN purchase_orders p ON p.id=l.order_id
 WHERE l.project_item_id=$1 AND p.status='approved'`,
    [itemId],
  );
  const shortage = D.max(
    0,
    D(item.plan_qty).minus(delivered.shipped).minus(held.n).minus(ordered.n),
  );
  return {
    ...item,
    shipped: delivered.shipped,
    handed: delivered.handed,
    in_transit: D(delivered.shipped).minus(delivered.handed).toFixed(3),
    reserved: held.n,
    ordered: ordered.n,
    shortage: shortage.toFixed(3),
  };
}
async function stock(db, warehouse, product) {
  const balance = await one(
    db,
    "SELECT qty FROM balances WHERE warehouse_id=$1 AND product_id=$2",
    [warehouse, product],
  );
  const held = await one(
    db,
    "SELECT COALESCE(SUM(remaining),0) n FROM reservations WHERE warehouse_id=$1 AND product_id=$2",
    [warehouse, product],
  );
  return {
    qty: D(balance?.qty || 0),
    held: D(held.n),
    available: D(balance?.qty || 0).minus(held.n),
  };
}
async function countLock(db, warehouse, exception = null) {
  const c = await one(
    db,
    "SELECT id FROM stock_counts WHERE warehouse_id=$1 AND status='open'",
    [warehouse],
  );
  assert(
    !c || c.id === exception,
    "Kho đang kiểm kê. Hoàn tất hoặc hủy kiểm kê trước khi phát sinh.",
  );
}
async function reserve(db, actor, input, fromReceipt = false) {
  const item = await itemAccess(db, actor, input.project_item_id);
  const wh = await get(db, "warehouses", input.warehouse_id);
  await countLock(db, wh.id);
  assert(
    wh.active && wh.kind === "owned",
    "Chỉ giữ hàng ở kho đang hoạt động, không cách ly.",
  );
  const qty = number(input.qty);
  const p = await get(db, "products", item.product_id);
  assert(
    !p.serial_tracked || D(qty).isInteger(),
    "Hàng theo serial cần số lượng nguyên.",
  );
  const s = await stock(db, wh.id, item.product_id);
  assert(s.available.gte(qty), "Không đủ tồn khả dụng để giữ hàng.");
  const pr = await progress(db, item.id);
  assert(D(pr.shortage).gte(qty), "Lượng giữ vượt nhu cầu chưa có nguồn hàng.");
  const rid = id();
  await db.query(
    "INSERT INTO reservations(id,project_item_id,warehouse_id,product_id,remaining,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [rid, item.id, wh.id, item.product_id, qty, actor.id],
  );
  return { id: rid, fromReceipt };
}
async function createDocument(db, actor, input) {
  const types = [
    "receipt",
    "dispatch",
    "transfer",
    "return_customer",
    "return_supplier",
    "adjust_up",
    "adjust_down",
  ];
  assert(types.includes(input.type), "Loại phiếu không hợp lệ.");
  if (input.type.startsWith("adjust")) allow(actor, managers);
  assert(
    Array.isArray(input.lines) &&
      input.lines.length > 0 &&
      input.lines.length <= 200,
    "Phiếu cần 1–200 dòng.",
  );
  const did = id();
  await db.query(
    "INSERT INTO documents(id,code,type,business_date,note,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [
      did,
      code(input.code),
      input.type,
      date(input.business_date) || today(),
      String(input.note || "").slice(0, 2000),
      actor.id,
    ],
  );
  for (const l of input.lines) {
    const product = await get(db, "products", l.product_id);
    const warehouse = await get(db, "warehouses", l.warehouse_id);
    assert(
      product.active && warehouse.active,
      "Hàng hoặc kho đã ngừng sử dụng.",
    );
    const qty = number(l.qty);
    let price = number(l.price ?? "0", false, 6);
    if (l.project_item_id) {
      const item = await itemAccess(db, actor, l.project_item_id);
      assert(item.product_id === product.id, "Mã hàng không khớp dòng dự án.");
    }
    if (l.purchase_line_id) {
      assert(input.type === "receipt", "Chỉ phiếu nhập liên kết đơn mua.");
      const pl = await get(db, "purchase_lines", l.purchase_line_id);
      price = pl.price;
    }
    if (l.source_line_id)
      assert(
        input.type.startsWith("return_"),
        "Chỉ phiếu trả liên kết dòng nguồn.",
      );
    if (l.project_item_id)
      assert(
        ["receipt", "dispatch", "return_customer"].includes(input.type),
        "Nghiệp vụ không hỗ trợ liên kết dự án.",
      );
    if (l.source_line_id) await get(db, "document_lines", l.source_line_id);
    if (input.type === "transfer") {
      const dest = await get(db, "warehouses", l.to_warehouse_id);
      assert(dest.active && dest.id !== warehouse.id, "Kho nhận không hợp lệ.");
    }
    const serials = (Array.isArray(l.serials) ? l.serials : []).map((s) =>
      text(s, "Serial", 120).normalize("NFKC").toUpperCase(),
    );
    assert(
      new Set(serials).size === serials.length,
      "Serial trùng trong dòng.",
    );
    assert(
      product.serial_tracked
        ? D(qty).isInteger() && D(qty).eq(serials.length)
        : serials.length === 0,
      "Số serial phải khớp số lượng hàng quản lý serial.",
    );
    await db.query(
      `INSERT INTO document_lines(id,document_id,product_id,warehouse_id,to_warehouse_id,project_item_id,purchase_line_id,source_line_id,qty,price,serials)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id(),
        did,
        product.id,
        warehouse.id,
        input.type === "transfer" ? l.to_warehouse_id : null,
        l.project_item_id || null,
        l.purchase_line_id || null,
        l.source_line_id || null,
        qty,
        price,
        JSON.stringify(serials),
      ],
    );
  }
  if (input.type.startsWith("adjust"))
    text(input.note, "Lý do điều chỉnh", 2000);
  return { id: did };
}
async function consumeReservation(db, itemId, warehouse, product, qty) {
  let left = D(qty);
  for (const r of await rows(
    db,
    "SELECT * FROM reservations WHERE project_item_id=$1 AND warehouse_id=$2 AND product_id=$3 AND remaining>0 ORDER BY created_at,id",
    [itemId, warehouse, product],
  )) {
    const take = D.min(left, r.remaining);
    await db.query(
      "UPDATE reservations SET remaining=remaining-$1 WHERE id=$2",
      [take.toFixed(3), r.id],
    );
    left = left.minus(take);
    if (left.eq(0)) break;
  }
  assert(left.eq(0), "Cần giữ đủ hàng tại kho trước khi xuất giao dự án.");
}
async function postDocument(db, actor, input, countException = null) {
  allow(actor, managers);
  const doc = await get(db, "documents", input.id);
  assert(doc.status === "submitted", "Chỉ ghi sổ phiếu chờ duyệt.", 409);
  assert(
    actor.role === "admin" || doc.created_by !== actor.id,
    "Người lập không tự duyệt phiếu.",
  );
  assert(
    Number(input.version) === doc.version,
    "Phiếu đã thay đổi. Tải lại trước khi duyệt.",
    409,
  );
  const business = dateString(doc.business_date);
  const settings = await one(db, "SELECT * FROM settings WHERE id=1");
  assert(
    !settings.closed_through || business > dateString(settings.closed_through),
    "Kỳ đã khóa.",
  );
  assert(business <= today(), "Không ghi sổ ngày tương lai.");
  const lines = await rows(
    db,
    "SELECT * FROM document_lines WHERE document_id=$1 ORDER BY id",
    [doc.id],
  );
  for (const l of lines) {
    const product = await get(db, "products", l.product_id),
      wh = await get(db, "warehouses", l.warehouse_id);
    await countLock(db, wh.id, countException);
    if (l.to_warehouse_id)
      await countLock(db, l.to_warehouse_id, countException);
    assert(product.active && wh.active, "Hàng hoặc kho đã ngừng sử dụng.");
    await db.query(
      "INSERT INTO valuations(product_id) VALUES($1) ON CONFLICT DO NOTHING",
      [product.id],
    );
    const val = await one(db, "SELECT * FROM valuations WHERE product_id=$1", [
      product.id,
    ]);
    assert(
      !val.last_date || business >= dateString(val.last_date),
      "Không ghi lùi trước giao dịch đã chốt giá vốn.",
    );
    const qty = D(l.qty),
      s = await stock(db, wh.id, product.id);
    let value = D(0),
      delta = qty,
      source = null,
      poLine = null;
    const outbound = [
      "dispatch",
      "return_supplier",
      "adjust_down",
      "transfer",
    ].includes(doc.type);
    if (doc.type === "dispatch") {
      assert(wh.kind === "owned", "Không xuất giao từ kho cách ly.");
      if (l.project_item_id) {
        const item = await itemAccess(db, actor, l.project_item_id);
        assert(item.product_id === product.id, "Mã hàng dự án không khớp.");
        const pr = await progress(db, item.id);
        assert(D(pr.shipped).plus(qty).lte(pr.plan_qty), "Xuất vượt kế hoạch.");
        await consumeReservation(db, item.id, wh.id, product.id, qty);
      }
    }
    if (outbound) {
      const afterRelease = await stock(db, wh.id, product.id);
      assert(
        afterRelease.available.gte(qty),
        "Không đủ tồn khả dụng; hàng có thể đang giữ cho dự án.",
      );
      assert(D(val.qty).gte(qty), "Không đủ số dư định giá.");
      value = qty.eq(val.qty)
        ? D(val.value)
        : D(val.value).mul(qty).div(val.qty).toDecimalPlaces(6);
      delta = qty.neg();
    }
    if (doc.type === "receipt") {
      value = qty.mul(l.price).toDecimalPlaces(6);
      assert(
        !l.project_item_id || l.purchase_line_id,
        "Nhận cho dự án phải qua dòng đơn mua phân bổ.",
      );
      if (l.purchase_line_id) {
        poLine = await get(db, "purchase_lines", l.purchase_line_id);
        const po = await get(db, "purchase_orders", poLine.order_id);
        assert(
          po.status === "approved" && poLine.product_id === product.id,
          "Đơn mua chưa duyệt hoặc sai mã hàng.",
        );
        assert(
          (poLine.project_item_id || null) === (l.project_item_id || null),
          "Dự án nhận phải khớp phân bổ đơn mua.",
        );
        assert(
          D(poLine.received_qty).plus(qty).lte(poLine.qty),
          "Nhận vượt lượng đặt còn lại.",
        );
        assert(
          D(poLine.price).eq(l.price),
          "Giá nhận phải khớp giá đơn mua đã duyệt.",
        );
        await db.query(
          "UPDATE purchase_lines SET received_qty=received_qty+$1 WHERE id=$2",
          [l.qty, poLine.id],
        );
      }
    }
    if (doc.type === "adjust_up") value = qty.mul(l.price).toDecimalPlaces(6);
    if (doc.type.startsWith("return_")) {
      assert(l.source_line_id, "Trả hàng phải tham chiếu dòng nguồn.");
      source = await get(db, "document_lines", l.source_line_id);
      const sourceDoc = await get(db, "documents", source.document_id);
      assert(
        sourceDoc.status === "posted" && source.product_id === product.id,
        "Nguồn chưa ghi sổ hoặc sai mã hàng.",
      );
      assert(
        D(source.returned_qty).plus(qty).lte(source.qty),
        "Trả vượt số lượng nguồn còn lại.",
      );
      if (doc.type === "return_customer") {
        assert(
          sourceDoc.type === "dispatch",
          "Khách trả phải tham chiếu phiếu xuất.",
        );
        assert(
          D(source.returned_qty).plus(qty).lte(source.handed_qty),
          "Chỉ trả giảm giao phần đã bàn giao.",
        );
        assert(
          (l.project_item_id || null) === (source.project_item_id || null),
          "Dự án trả phải khớp phiếu xuất gốc.",
        );
        value = D(source.cost_value)
          .mul(qty)
          .div(source.qty)
          .toDecimalPlaces(6);
      } else
        assert(
          sourceDoc.type === "receipt",
          "Trả NCC phải tham chiếu phiếu nhập.",
        );
      await db.query(
        "UPDATE document_lines SET returned_qty=returned_qty+$1 WHERE id=$2",
        [l.qty, source.id],
      );
    }
    // Serial ownership is checked against the actual current location and original dispatch.
    for (const serial of l.serials) {
      const current = await one(
        db,
        "SELECT * FROM serials WHERE product_id=$1 AND serial=$2",
        [product.id, serial],
      );
      if (outbound) {
        assert(
          current?.warehouse_id === wh.id,
          `Serial ${serial} không ở kho xuất.`,
        );
        if (source)
          assert(
            source.serials.includes(serial),
            "Serial không thuộc dòng nhập gốc.",
          );
      } else if (doc.type === "return_customer") {
        assert(
          source.serials.includes(serial) &&
            current &&
            !current.warehouse_id &&
            current.last_line_id === source.id,
          "Serial không thuộc lần giao đang trả.",
        );
        const handed = await rows(
          db,
          "SELECT serials FROM handovers WHERE line_id=$1",
          [source.id],
        );
        assert(
          handed.some((h) => h.serials.includes(serial)),
          "Serial chưa được bàn giao.",
        );
      } else
        assert(
          !current,
          `Serial ${serial} đã có lịch sử; nhận lại phải dùng trả hàng.`,
        );
      const destination =
        doc.type === "transfer" ? l.to_warehouse_id : outbound ? null : wh.id;
      await db.query(
        `INSERT INTO serials(product_id,serial,warehouse_id,last_line_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(product_id,serial) DO UPDATE SET warehouse_id=EXCLUDED.warehouse_id,last_line_id=EXCLUDED.last_line_id`,
        [product.id, serial, destination, l.id],
      );
    }
    await db.query("UPDATE document_lines SET cost_value=$1 WHERE id=$2", [
      q6(value),
      l.id,
    ]);
    const signedValue = outbound ? value.neg() : value;
    await move(db, l, wh.id, delta, signedValue);
    if (doc.type === "transfer") {
      const dest = await get(db, "warehouses", l.to_warehouse_id);
      assert(dest.active, "Kho nhận đã ngừng sử dụng.");
      await move(db, l, dest.id, qty, value);
      await db.query("UPDATE valuations SET last_date=$1 WHERE product_id=$2", [
        business,
        product.id,
      ]);
    } else {
      await db.query(
        "UPDATE valuations SET qty=qty+$1,value=value+$2,last_date=$3 WHERE product_id=$4",
        [delta.toFixed(3), q6(signedValue), business, product.id],
      );
    }
    if (poLine?.project_item_id)
      await reserve(
        db,
        actor,
        {
          project_item_id: poLine.project_item_id,
          warehouse_id: wh.id,
          qty: l.qty,
        },
        true,
      );
  }
  await db.query(
    "UPDATE documents SET status='posted',posted_by=$1,posted_at=now(),version=version+1 WHERE id=$2",
    [actor.id, doc.id],
  );
  return { id: doc.id };
}
async function move(db, line, warehouse, qty, value) {
  await db.query(
    "INSERT INTO balances(warehouse_id,product_id,qty) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
    [warehouse, line.product_id],
  );
  await db.query(
    "UPDATE balances SET qty=qty+$1 WHERE warehouse_id=$2 AND product_id=$3",
    [qty.toFixed(3), warehouse, line.product_id],
  );
  await db.query(
    "INSERT INTO movements(id,line_id,product_id,warehouse_id,qty,value) VALUES($1,$2,$3,$4,$5,$6)",
    [id(), line.id, line.product_id, warehouse, qty.toFixed(3), q6(value)],
  );
}
export const dateString = (v) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
export async function command(actor, input, key, database) {
  assert(
    typeof key === "string" && key.length >= 8 && key.length <= 100,
    "Thiếu khóa chống ghi trùng.",
  );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transaction(async (db) => {
    actor = await activeUser(db, actor);
    const cached = await one(
      db,
      "SELECT * FROM idempotency WHERE actor_id=$1 AND key=$2",
      [actor.id, key],
    );
    if (cached) {
      assert(cached.hash === hash, "Khóa đã dùng cho nội dung khác.", 409);
      return cached.response;
    }
    const result = await execute(db, actor, input);
    const safe = { ...input };
    delete safe.password;
    await audit(
      db,
      actor,
      input.action,
      result.id || input.id || input.action,
      safe,
    );
    await db.query(
      "INSERT INTO idempotency(actor_id,key,hash,response) VALUES($1,$2,$3,$4)",
      [actor.id, key, hash, JSON.stringify(result)],
    );
    return result;
  }, database);
}
async function execute(db, actor, input) {
  const resultId = id();
  switch (input.action) {
    case "product.create":
      allow(actor, workers);
      await db.query(
        "INSERT INTO products(id,code,name,unit,model,maker,serial_tracked) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          resultId,
          code(input.code),
          text(input.name, "Tên hàng"),
          text(input.unit, "Đơn vị", 40),
          String(input.model || "").slice(0, 100),
          String(input.maker || "").slice(0, 100),
          input.serial_tracked === true,
        ],
      );
      break;
    case "warehouse.create":
      allow(actor, managers);
      assert(
        ["owned", "quarantine"].includes(input.kind),
        "Loại kho không hợp lệ.",
      );
      await db.query(
        "INSERT INTO warehouses(id,code,name,kind) VALUES($1,$2,$3,$4)",
        [resultId, code(input.code), text(input.name, "Tên kho"), input.kind],
      );
      break;
    case "partner.create":
      allow(actor, workers);
      assert(
        ["customer", "supplier", "both"].includes(input.kind),
        "Loại đối tác không hợp lệ.",
      );
      await db.query(
        "INSERT INTO partners(id,code,name,kind) VALUES($1,$2,$3,$4)",
        [
          resultId,
          code(input.code),
          text(input.name, "Tên đối tác"),
          input.kind,
        ],
      );
      break;
    case "project.create": {
      allow(actor, planners);
      const owner =
        actor.role === "project" ? actor.id : uuid(input.owner_id || actor.id);
      await get(db, "users", owner);
      await db.query(
        "INSERT INTO projects(id,code,name,customer_id,owner_id,deadline) VALUES($1,$2,$3,$4,$5,$6)",
        [
          resultId,
          code(input.code),
          text(input.name, "Tên dự án"),
          input.customer_id ? uuid(input.customer_id) : null,
          owner,
          date(input.deadline),
        ],
      );
      break;
    }
    case "package.create": {
      allow(actor, planners);
      const project = await get(db, "projects", input.project_id);
      assert(
        actor.role !== "project" || project.owner_id === actor.id,
        "Dự án ngoài phạm vi.",
        403,
      );
      await db.query(
        "INSERT INTO packages(id,project_id,code,name,deadline) VALUES($1,$2,$3,$4,$5)",
        [
          resultId,
          project.id,
          code(input.code),
          text(input.name, "Tên gói"),
          date(input.deadline),
        ],
      );
      break;
    }
    case "item.create": {
      allow(actor, planners);
      const pk = await get(db, "packages", input.package_id),
        pj = await get(db, "projects", pk.project_id),
        p = await get(db, "products", input.product_id);
      assert(
        actor.role !== "project" || pj.owner_id === actor.id,
        "Dự án ngoài phạm vi.",
        403,
      );
      assert(p.active, "Hàng đã ngừng sử dụng.");
      await db.query(
        "INSERT INTO project_items(id,package_id,product_id,name,plan_qty,sale_price) VALUES($1,$2,$3,$4,$5,$6)",
        [
          resultId,
          pk.id,
          p.id,
          text(input.name || p.name, "Tên hợp đồng"),
          number(input.plan_qty),
          number(input.sale_price || "0", false, 6),
        ],
      );
      break;
    }
    case "item.revise": {
      allow(actor, managers);
      const pr = await progress(db, uuid(input.id)),
        qty = number(input.plan_qty);
      text(input.reason, "Lý do thay đổi", 1000);
      assert(
        Number(input.version) === pr.version,
        "Kế hoạch đã thay đổi.",
        409,
      );
      assert(
        D(qty).gte(D(pr.shipped).plus(pr.reserved).plus(pr.ordered)),
        "Kế hoạch không được thấp hơn hàng đã giao/giữ/đang đặt.",
      );
      await db.query(
        "UPDATE project_items SET plan_qty=$1,version=version+1 WHERE id=$2",
        [qty, pr.id],
      );
      return { id: pr.id };
    }
    case "purchase.create": {
      allow(actor, managers);
      const supplier = await get(db, "partners", input.supplier_id);
      assert(supplier.kind !== "customer", "Chọn đối tác nhà cung cấp.");
      assert(
        Array.isArray(input.lines) &&
          input.lines.length > 0 &&
          input.lines.length <= 200,
        "Đơn mua cần 1–200 dòng.",
      );
      await db.query(
        "INSERT INTO purchase_orders(id,code,supplier_id,created_by,expected_date) VALUES($1,$2,$3,$4,$5)",
        [
          resultId,
          code(input.code),
          supplier.id,
          actor.id,
          date(input.expected_date),
        ],
      );
      for (const l of input.lines) {
        const product = await get(db, "products", l.product_id);
        if (l.project_item_id) {
          const item = await itemAccess(db, actor, l.project_item_id);
          assert(item.product_id === product.id, "Mã hàng phân bổ không khớp.");
        }
        await db.query(
          "INSERT INTO purchase_lines(id,order_id,product_id,project_item_id,qty,price) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id(),
            resultId,
            product.id,
            l.project_item_id || null,
            number(l.qty),
            number(l.price, false, 6),
          ],
        );
      }
      break;
    }
    case "purchase.submit":
    case "purchase.approve":
    case "purchase.close": {
      allow(actor, managers);
      const po = await get(db, "purchase_orders", input.id);
      if (input.action === "purchase.submit") {
        assert(po.status === "draft", "Đơn không ở trạng thái nháp.", 409);
        await db.query(
          "UPDATE purchase_orders SET status='submitted' WHERE id=$1",
          [po.id],
        );
      } else if (input.action === "purchase.approve") {
        assert(po.status === "submitted", "Đơn chưa chờ duyệt.", 409);
        assert(
          actor.role === "admin" || po.created_by !== actor.id,
          "Người lập không tự duyệt.",
        );
        // Group lines by demand before activating the order; each line cannot reuse the same shortage.
        for (const l of await rows(
          db,
          "SELECT project_item_id,SUM(qty) qty FROM purchase_lines WHERE order_id=$1 AND project_item_id IS NOT NULL GROUP BY project_item_id",
          [po.id],
        )) {
          const pr = await progress(db, l.project_item_id);
          assert(
            D(pr.shortage).gte(l.qty),
            "Đơn mua phân bổ vượt nhu cầu chưa có nguồn.",
          );
        }
        await db.query(
          "UPDATE purchase_orders SET status='approved',approved_by=$1 WHERE id=$2",
          [actor.id, po.id],
        );
      } else {
        assert(
          po.status === "approved",
          "Chỉ đóng phần còn lại của đơn đã duyệt.",
          409,
        );
        text(input.reason, "Lý do đóng");
        await db.query(
          "UPDATE purchase_orders SET status='closed' WHERE id=$1",
          [po.id],
        );
      }
      return { id: po.id };
    }
    case "reservation.create":
      allow(actor, [...workers, "project"]);
      return reserve(db, actor, input);
    case "reservation.release": {
      allow(actor, [...workers, "project"]);
      const r = await get(db, "reservations", input.id);
      await itemAccess(db, actor, r.project_item_id);
      const qty = number(input.qty);
      assert(D(r.remaining).gte(qty), "Giải phóng vượt lượng giữ.");
      await db.query(
        "UPDATE reservations SET remaining=remaining-$1 WHERE id=$2",
        [qty, r.id],
      );
      return { id: r.id };
    }
    case "document.create":
      allow(actor, workers);
      return createDocument(db, actor, input);
    case "document.submit":
    case "document.cancel": {
      allow(actor, workers);
      const d = await get(db, "documents", input.id);
      assert(
        d.status === "draft" ||
          (input.action === "document.cancel" && d.status === "submitted"),
        "Phiếu không thể thay đổi ở trạng thái này.",
        409,
      );
      assert(
        managers.includes(actor.role) || d.created_by === actor.id,
        "Chỉ người lập hoặc quản lý được đổi trạng thái.",
        403,
      );
      assert(Number(input.version) === d.version, "Phiếu đã thay đổi.", 409);
      await db.query(
        "UPDATE documents SET status=$1,version=version+1 WHERE id=$2",
        [input.action.endsWith("submit") ? "submitted" : "cancelled", d.id],
      );
      return { id: d.id };
    }
    case "document.post":
      return postDocument(db, actor, input);
    case "handover.create": {
      allow(actor, planners);
      const l = await get(db, "document_lines", input.line_id),
        doc = await get(db, "documents", l.document_id);
      assert(
        doc.status === "posted" && doc.type === "dispatch",
        "Nguồn phải là phiếu xuất đã ghi sổ.",
      );
      if (l.project_item_id) await itemAccess(db, actor, l.project_item_id);
      else allow(actor, managers);
      const qty = number(input.qty);
      assert(
        D(l.handed_qty).plus(qty).lte(l.qty),
        "Bàn giao vượt lượng xuất còn lại.",
      );
      const product = await get(db, "products", l.product_id),
        serials = (input.serials || []).map((s) =>
          text(s, "Serial", 120).normalize("NFKC").toUpperCase(),
        );
      assert(new Set(serials).size === serials.length, "Serial trùng.");
      if (product.serial_tracked) {
        assert(D(qty).eq(serials.length), "Số serial bàn giao không khớp.");
        const prev = await rows(
          db,
          "SELECT serials FROM handovers WHERE line_id=$1",
          [l.id],
        );
        assert(
          serials.every(
            (s) =>
              l.serials.includes(s) && !prev.some((p) => p.serials.includes(s)),
          ),
          "Serial chưa xuất hoặc đã bàn giao.",
        );
      } else assert(!serials.length, "Hàng không quản lý serial.");
      await db.query(
        "INSERT INTO handovers(id,line_id,qty,recipient,serials,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          resultId,
          l.id,
          qty,
          text(input.recipient, "Người nhận"),
          JSON.stringify(serials),
          actor.id,
        ],
      );
      await db.query(
        "UPDATE document_lines SET handed_qty=handed_qty+$1 WHERE id=$2",
        [qty, l.id],
      );
      break;
    }
    case "user.create":
      allow(actor, ["admin"]);
      return createUser(db, input);
    case "user.password": {
      allow(actor, ["admin"]);
      const u = await get(db, "users", input.id);
      await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        await hashPassword(input.password),
        u.id,
      ]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      return { id: u.id };
    }
    case "period.close": {
      allow(actor, managers);
      const closed = date(input.date);
      assert(closed && closed <= today(), "Ngày khóa không hợp lệ.");
      const old = await one(
        db,
        "SELECT closed_through FROM settings WHERE id=1",
      );
      assert(
        !old.closed_through || closed >= dateString(old.closed_through),
        "Không mở lại kỳ đã khóa trong bản này.",
      );
      await db.query("UPDATE settings SET closed_through=$1 WHERE id=1", [
        closed,
      ]);
      return { id: "1" };
    }
    case "count.create": {
      allow(actor, workers);
      const wh = await get(db, "warehouses", input.warehouse_id);
      assert(wh.active, "Kho đã ngừng sử dụng.");
      await countLock(db, wh.id);
      assert(
        Array.isArray(input.product_ids) &&
          input.product_ids.length > 0 &&
          input.product_ids.length <= 200,
        "Chọn 1–200 mã hàng để kiểm kê.",
      );
      assert(
        new Set(input.product_ids).size === input.product_ids.length,
        "Mã hàng kiểm kê bị trùng.",
      );
      await db.query(
        "INSERT INTO stock_counts(id,warehouse_id,created_by) VALUES($1,$2,$3)",
        [resultId, wh.id, actor.id],
      );
      for (const pid of input.product_ids) {
        const p = await get(db, "products", pid),
          s = await stock(db, wh.id, p.id);
        const serials = await rows(
          db,
          "SELECT serial FROM serials WHERE product_id=$1 AND warehouse_id=$2 ORDER BY serial",
          [p.id, wh.id],
        );
        await db.query(
          "INSERT INTO count_lines(id,count_id,product_id,system_qty,serials) VALUES($1,$2,$3,$4,$5)",
          [
            id(),
            resultId,
            p.id,
            s.qty.toFixed(3),
            JSON.stringify(serials.map((s) => s.serial)),
          ],
        );
      }
      break;
    }
    case "count.cancel": {
      allow(actor, workers);
      const c = await get(db, "stock_counts", input.id);
      assert(c.status === "open", "Phiên kiểm kê đã đóng.", 409);
      assert(
        managers.includes(actor.role) || c.created_by === actor.id,
        "Chỉ người lập hoặc quản lý được hủy.",
        403,
      );
      await db.query("UPDATE stock_counts SET status='cancelled' WHERE id=$1", [
        c.id,
      ]);
      return { id: c.id };
    }
    case "count.post": {
      allow(actor, managers);
      const c = await get(db, "stock_counts", input.id);
      assert(c.status === "open", "Phiên kiểm kê đã đóng.", 409);
      assert(
        actor.role === "admin" || c.created_by !== actor.id,
        "Người lập không tự duyệt.",
      );
      const existing = await rows(
        db,
        "SELECT * FROM count_lines WHERE count_id=$1 ORDER BY id",
        [c.id],
      );
      assert(
        Array.isArray(input.lines) &&
          input.lines.length === existing.length &&
          new Set(input.lines.map((l) => l.id)).size === existing.length,
        "Phải nhập đủ và không lặp dòng kiểm kê.",
      );
      const up = [],
        down = [];
      for (const original of existing) {
        const l = input.lines.find((l) => l.id === original.id);
        assert(l, "Thiếu dòng kiểm kê.");
        const counted = number(l.counted_qty, false),
          product = await get(db, "products", original.product_id);
        const serials = (l.serials || []).map((s) =>
          text(s, "Serial", 120).normalize("NFKC").toUpperCase(),
        );
        assert(new Set(serials).size === serials.length, "Trùng serial đếm.");
        const base = {
          product_id: product.id,
          warehouse_id: c.warehouse_id,
          price: number(l.price || "0", false, 6),
        };
        if (product.serial_tracked) {
          assert(D(counted).eq(serials.length), "Số serial đếm không khớp.");
          const added = serials.filter((s) => !original.serials.includes(s)),
            missing = original.serials.filter((s) => !serials.includes(s));
          if (added.length)
            up.push({ ...base, qty: String(added.length), serials: added });
          if (missing.length)
            down.push({
              ...base,
              qty: String(missing.length),
              serials: missing,
            });
        } else {
          assert(!serials.length, "Mã hàng không quản lý serial.");
          const diff = D(counted).minus(original.system_qty);
          if (diff.gt(0)) up.push({ ...base, qty: diff.toFixed(3) });
          if (diff.lt(0)) down.push({ ...base, qty: diff.abs().toFixed(3) });
        }
        await db.query(
          "UPDATE count_lines SET counted_qty=$1,counted_serials=$2 WHERE id=$3",
          [counted, JSON.stringify(serials), original.id],
        );
      }
      for (const [type, lines] of [
        ["adjust_down", down],
        ["adjust_up", up],
      ])
        if (lines.length) {
          const d = await createDocument(db, actor, {
            type,
            code: `KK-${c.id}-${type === "adjust_up" ? "T" : "G"}`,
            business_date: today(),
            note: "Điều chỉnh kiểm kê " + c.id,
            lines,
          });
          await db.query(
            "UPDATE documents SET status='submitted',created_by=$1 WHERE id=$2",
            [c.created_by, d.id],
          );
          await postDocument(db, actor, { id: d.id, version: 1 }, c.id);
        }
      await db.query(
        "UPDATE stock_counts SET status='posted',posted_at=now() WHERE id=$1",
        [c.id],
      );
      return { id: c.id };
    }
    default:
      throw new AppError(404, "Thao tác không được hỗ trợ.");
  }
  return { id: resultId };
}
