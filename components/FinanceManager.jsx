"use client";
import { useEffect, useState, useRef } from "react";
import { Dialog, Field, Grid, amount, currentDay } from "./ModuleUI.jsx";
const labels = {
  draft: "Nháp",
  submitted: "Chờ duyệt",
  posted: "Đã ghi sổ",
  cancelled: "Đã hủy",
  void: "Đã hủy ghi nhận",
};
export default function FinanceManager({ state, act, busy, error }) {
  const [side, setSide] = useState("ar"),
    [partner, setPartner] = useState(""),
    [asof, setAsof] = useState(currentDay()),
    [data, setData] = useState(null),
    [loadError, setLoadError] = useState(""),
    [form, setForm] = useState(null),
    [values, setValues] = useState({});
  const seq = useRef(0);
  const permitted = ["admin", "manager", "accountant"].includes(
    state.user.role,
  );
  const params = new URLSearchParams({
    side,
    asof,
    ...(partner ? { partner } : {}),
  });
  async function refresh() {
    const n = ++seq.current;
    try {
      const r = await fetch("/api/finance?" + params),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (n === seq.current) {
        setData(j);
        setLoadError("");
      }
    } catch (e) {
      if (n === seq.current) setLoadError(e.message);
    }
  }
  useEffect(() => {
    if (permitted) {
      setData(null);
      refresh();
    }
  }, [state, side, partner, asof]);
  if (!permitted)
    return (
      <div className="panel">
        <p className="empty">
          Chỉ quản trị, quản lý và kế toán được truy cập công nợ.
        </p>
      </div>
    );
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));
  const show = (kind, v = {}) => {
    setValues({
      side,
      business_date: currentDay(),
      due_date: currentDay(),
      partner_id: partner,
      method: "bank",
      ...v,
    });
    setForm(kind);
  };
  const field = (k, label, type = "text", options, required = true) => (
    <Field
      key={k}
      label={label}
      type={type}
      value={values[k]}
      onChange={(v) => set(k, v)}
      options={options}
      required={required}
    />
  );
  const partnerOptions = state.partners
    .filter(
      (p) =>
        p.kind === "both" ||
        p.kind === (side === "ar" ? "customer" : "supplier"),
    )
    .map((p) => ({ value: p.id, label: p.code + " · " + p.name }));
  const controls = (r, type) => (
    <div className="actions">
      {r.status === "draft" && (
        <button
          disabled={busy}
          onClick={() =>
            act({
              action: `finance.${type}.submit`,
              id: r.id,
              version: r.version,
            })
          }
        >
          Gửi duyệt
        </button>
      )}
      {r.status === "submitted" &&
        (state.user.role === "admin" || r.created_by !== state.user.id) && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              act(
                {
                  action: `finance.${type}.post`,
                  id: r.id,
                  version: r.version,
                },
                true,
              )
            }
          >
            Ghi sổ
          </button>
        )}
      {["draft", "submitted"].includes(r.status) && (
        <button
          disabled={busy}
          onClick={() =>
            act(
              {
                action: `finance.${type}.cancel`,
                id: r.id,
                version: r.version,
              },
              true,
            )
          }
        >
          Hủy nháp
        </button>
      )}
      {type === "debt" &&
        r.status === "posted" &&
        r.kind === "charge" &&
        Number(r.remaining) > 0 && (
          <button
            onClick={() =>
              show("credit", { source_debt_id: r.id, amount: r.remaining })
            }
          >
            Giảm nợ
          </button>
        )}
      {type === "payment" &&
        r.status === "posted" &&
        Number(r.remaining) > 0 && (
          <button
            onClick={() =>
              show("allocate", {
                payment_id: r.id,
                partner_id: r.partner_id,
                amount: r.remaining,
              })
            }
          >
            Phân bổ
          </button>
        )}
      {type === "payment" &&
        r.status === "posted" &&
        Number(r.allocated) === 0 && (
          <button
            onClick={() => show("void", { id: r.id, version: r.version })}
          >
            Hủy ghi nhận
          </button>
        )}
    </div>
  );
  const debtOptions =
    data?.debts
      .filter(
        (d) =>
          d.status === "posted" &&
          d.kind === "charge" &&
          Number(d.remaining) > 0 &&
          (!values.partner_id || d.partner_id === values.partner_id),
      )
      .map((d) => ({
        value: d.id,
        label: d.code + " · còn " + amount(d.remaining),
      })) || [];
  const totals = (key) =>
    (data?.balances || []).reduce((s, b) => s + Number(b[key]), 0);
  async function save() {
    let payload = { ...values };
    if (form === "debt" || form === "credit")
      payload = {
        ...payload,
        action: "finance.debt.create",
        kind: form === "credit" ? "credit" : "charge",
      };
    if (form === "payment") payload.action = "finance.payment.create";
    if (form === "allocate") payload.action = "finance.allocate";
    if (form === "reverse") payload.action = "finance.allocation.reverse";
    if (form === "void") payload.action = "finance.payment.void";
    if (await act(payload)) {
      setForm(null);
      await refresh();
    }
  }
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Công nợ & thu chi</h2>
          <p>Ghi nhận có duyệt, thanh toán từng đợt và tách phần ứng trước.</p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => show("debt")}>
            + {side === "ar" ? "Phải thu" : "Phải trả"}
          </button>
          <button onClick={() => show("payment")}>
            + {side === "ar" ? "Thu tiền" : "Chi tiền"}
          </button>
          <a
            className="button"
            href={"/api/finance?" + params + "&format=xlsx"}
          >
            Xuất Excel
          </a>
        </div>
      </div>
      <div className="filter-row">
        <Field
          label="Loại công nợ"
          value={side}
          onChange={(v) => {
            setSide(v);
            setPartner("");
          }}
          options={[
            { value: "ar", label: "Khách hàng · Phải thu" },
            { value: "ap", label: "Nhà cung cấp · Phải trả" },
          ]}
        />
        <Field
          label="Đối tác"
          value={partner}
          onChange={setPartner}
          options={partnerOptions}
          required={false}
        />
        <Field
          label="Số liệu đến hết ngày"
          type="date"
          value={asof}
          onChange={setAsof}
        />
      </div>
      {loadError && (
        <div className="alert error" role="alert">
          {loadError}
        </div>
      )}
      <div className="metrics">
        {[
          ["remaining", "Còn nợ"],
          ["overdue", "Đã quá hạn"],
          [
            "advance",
            side === "ar"
              ? "Khách ứng trước / chưa phân bổ"
              : "Ứng NCC / chưa phân bổ",
          ],
          ["net", "Số dư ròng"],
        ].map(([k, label]) => (
          <div className="metric" key={k}>
            <p>{label}</p>
            <strong>{amount(totals(k))}</strong>
            <small>VND · Đến {asof}</small>
          </div>
        ))}
      </div>
      {!data && !loadError && <p role="status">Đang tải công nợ…</p>}
      {data && (
        <>
          <div className="panel">
            <div className="panel-title">
              <h3>Đối soát từng đối tác</h3>
              <span>Số dư ròng = còn nợ − ứng trước</span>
            </div>
            <Grid
              data={data.balances}
              columns={[
                ["partner_name", "Đối tác"],
                ["remaining", "Còn nợ", (r) => amount(r.remaining)],
                ["advance", "Chưa phân bổ", (r) => amount(r.advance)],
                [
                  "overdue",
                  "Quá hạn",
                  (r) => <b className="warning">{amount(r.overdue)}</b>,
                ],
                ["due_1_30", "1–30 ngày", (r) => amount(r.due_1_30)],
                ["due_31_60", "31–60 ngày", (r) => amount(r.due_31_60)],
                ["due_61_90", "61–90 ngày", (r) => amount(r.due_61_90)],
                ["due_over_90", "Trên 90 ngày", (r) => amount(r.due_over_90)],
                ["net", "Số dư ròng", (r) => amount(r.net)],
              ]}
            />
          </div>
          <div className="panel">
            <div className="panel-title">
              <h3>Chứng từ {side === "ar" ? "phải thu" : "phải trả"}</h3>
              <span>Khoản nợ chỉ tính khi đã ghi sổ</span>
            </div>
            <Grid
              data={data.debts}
              columns={[
                ["code", "Số chứng từ"],
                ["partner_name", "Đối tác"],
                [
                  "kind",
                  "Loại",
                  (r) => (r.kind === "credit" ? "Giảm nợ" : "Ghi nhận nợ"),
                ],
                ["due_date", "Đến hạn", (r) => String(r.due_date).slice(0, 10)],
                ["amount", "Số tiền", (r) => amount(r.amount)],
                ["allocated", "Đã phân bổ", (r) => amount(r.allocated)],
                [
                  "remaining",
                  "Còn lại",
                  (r) =>
                    r.status === "posted" ? amount(r.remaining) : "Chưa ghi sổ",
                ],
                [
                  "status",
                  "Trạng thái",
                  (r) => (
                    <span className={"badge " + r.status}>
                      {labels[r.status]}
                    </span>
                  ),
                ],
                ["actions", "", (r) => controls(r, "debt")],
              ]}
            />
          </div>
          <div className="panel">
            <div className="panel-title">
              <h3>{side === "ar" ? "Phiếu thu" : "Phiếu chi"} & ứng trước</h3>
            </div>
            <Grid
              data={data.payments}
              columns={[
                ["code", "Số phiếu"],
                ["partner_name", "Đối tác"],
                [
                  "business_date",
                  "Ngày",
                  (r) => String(r.business_date).slice(0, 10),
                ],
                ["amount", "Số tiền", (r) => amount(r.amount)],
                ["allocated", "Đã phân bổ", (r) => amount(r.allocated)],
                ["remaining", "Chưa phân bổ", (r) => amount(r.remaining)],
                [
                  "effective_status",
                  "Trạng thái",
                  (r) => labels[r.effective_status],
                ],
                ["actions", "", (r) => controls(r, "payment")],
              ]}
            />
          </div>
          <div className="panel">
            <div className="panel-title">
              <h3>Phân bổ thanh toán</h3>
            </div>
            <Grid
              data={data.settlements}
              columns={[
                [
                  "business_date",
                  "Ngày",
                  (r) => String(r.business_date).slice(0, 10),
                ],
                ["payment_code", "Phiếu thu/chi"],
                ["debt_code", "Chứng từ nợ"],
                ["amount", "Số tiền", (r) => amount(r.amount)],
                [
                  "actions",
                  "",
                  (r) =>
                    Number(r.amount) > 0 &&
                    !data.settlements.some((s) => s.reverses_id === r.id) && (
                      <button onClick={() => show("reverse", { id: r.id })}>
                        Hoàn tác
                      </button>
                    ),
                ],
              ]}
            />
          </div>
          <div className="panel">
            <div className="panel-title">
              <h3>Sổ công nợ đối tác</h3>
              <span>Tiền ứng trước làm giảm số dư ròng</span>
            </div>
            <Grid
              data={data.events}
              columns={[
                ["date", "Ngày"],
                [
                  "partner_id",
                  "Đối tác",
                  (r) =>
                    state.partners.find((p) => p.id === r.partner_id)?.name,
                ],
                ["code", "Chứng từ"],
                ["type", "Nghiệp vụ"],
                ["amount", "Tăng / giảm", (r) => amount(r.amount)],
                ["balance", "Số dư đối tác", (r) => amount(r.balance)],
                ["note", "Diễn giải"],
              ]}
            />
          </div>
        </>
      )}
      {form && (
        <Dialog
          title={
            {
              debt: "Ghi nhận công nợ",
              credit: "Lập chứng từ giảm công nợ",
              payment: side === "ar" ? "Lập phiếu thu" : "Lập phiếu chi",
              allocate: "Phân bổ tiền vào chứng từ",
              reverse: "Hoàn tác phân bổ",
              void: "Hủy ghi nhận thu/chi",
            }[form]
          }
          onClose={() => setForm(null)}
          busy={busy}
          error={error}
          onSubmit={save}
        >
          <div className="form-grid">
            {["debt", "credit", "payment"].includes(form) &&
              field("code", "Số chứng từ / phiếu")}
            {["debt", "payment"].includes(form) &&
              field("partner_id", "Đối tác", "text", partnerOptions)}
            {field("business_date", "Ngày ghi nhận", "date")}
            {form === "debt" && field("due_date", "Hạn thanh toán", "date")}
            {["debt", "credit", "payment", "allocate"].includes(form) &&
              field("amount", "Số tiền VND (tổng cần thanh toán)", "number")}
            {form === "payment" &&
              field("method", "Phương thức", "text", [
                { value: "bank", label: "Chuyển khoản" },
                { value: "cash", label: "Tiền mặt" },
              ])}
            {form === "debt" && (
              <>
                {field(
                  "project_id",
                  "Dự án",
                  "text",
                  state.projects
                    .filter(
                      (p) =>
                        side === "ap" ||
                        !values.partner_id ||
                        p.customer_id === values.partner_id,
                    )
                    .map((p) => ({
                      value: p.id,
                      label: p.code + " · " + p.name,
                    })),
                  false,
                )}
                {field(
                  "package_id",
                  "Gói thầu",
                  "text",
                  state.packages
                    .filter(
                      (p) =>
                        !values.project_id ||
                        p.project_id === values.project_id,
                    )
                    .map((p) => ({
                      value: p.id,
                      label: p.code + " · " + p.name,
                    })),
                  false,
                )}
                {side === "ap" &&
                  field(
                    "purchase_order_id",
                    "Đơn mua",
                    "text",
                    state.purchases
                      .filter(
                        (p) =>
                          p.supplier_id === values.partner_id &&
                          ["approved", "closed"].includes(p.status),
                      )
                      .map((p) => ({ value: p.id, label: p.code })),
                    false,
                  )}
              </>
            )}
            {["debt", "credit", "payment"].includes(form) && (
              <>
                {field(
                  "reference",
                  "Số hóa đơn / tham chiếu",
                  "text",
                  undefined,
                  false,
                )}
                {field("note", "Nội dung và căn cứ ghi nhận", "textarea")}
              </>
            )}
            {form === "allocate" &&
              field("debt_id", "Khoản nợ nhận thanh toán", "text", debtOptions)}
            {["void", "reverse"].includes(form) &&
              field("reason", "Lý do", "textarea")}
          </div>
          <p className="note">
            {form === "payment"
              ? "Phiếu chưa phân bổ được theo dõi là ứng trước. Sau khi ghi sổ, bấm Phân bổ để trừ đúng khoản nợ."
              : "Chứng từ đã ghi sổ không sửa số tiền trực tiếp. Các thay đổi được lưu trong lịch sử."}
          </p>
        </Dialog>
      )}
    </>
  );
}
