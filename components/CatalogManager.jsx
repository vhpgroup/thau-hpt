"use client";
import { useState } from "react";
import { Grid, Dialog, Field, amount } from "./ModuleUI.jsx";
export default function CatalogManager({
  state,
  act,
  busy,
  error,
  openLegacy,
}) {
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [status, setStatus] = useState("active"),
    [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [values, setValues] = useState({}),
    [preview, setPreview] = useState(null),
    [importError, setImportError] = useState(""),
    [loading, setLoading] = useState(false);
  const worker = ["admin", "manager", "warehouse"].includes(state.user.role),
    manager = ["admin", "manager"].includes(state.user.role),
    financial = ["admin", "manager", "accountant"].includes(state.user.role);
  const set = (key, v) => setValues((s) => ({ ...s, [key]: v }));
  const show = (kind, v = {}) => {
    setValues(v);
    setForm(kind);
  };
  const field = (key, label, type = "text", options, required = true) => (
    <Field
      key={key}
      label={label}
      value={values[key]}
      onChange={(v) => set(key, v)}
      type={type}
      options={options}
      required={required}
    />
  );
  const groups = (state.groups || []).map((g) => ({
    value: g.id,
    label: g.code + " · " + g.name,
  }));
  const quantity = (p) =>
    state.stocks
      .filter((s) => s.product_id === p.id)
      .reduce((a, b) => a + Number(b.qty), 0);
  const held = (p) =>
    state.stocks
      .filter((s) => s.product_id === p.id)
      .reduce((a, b) => a + Number(b.reserved), 0);
  const items = state.products.filter(
    (p) =>
      (!group || p.group_id === group) &&
      (status === "all" ||
        (status === "active" && p.active) ||
        (status === "inactive" && !p.active) ||
        (status === "low" && p.active && quantity(p) < Number(p.min_stock))) &&
      [p.code, p.name, p.model, p.maker, p.barcode]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(search.toLocaleLowerCase("vi")),
  );
  const p = state.products.find((p) => p.id === selected),
    val = state.valuations.find((v) => v.product_id === selected);
  async function upload(file) {
    if (!file) return;
    setLoading(true);
    setImportError("");
    setPreview(null);
    try {
      const data = new FormData();
      data.append("file", file);
      const r = await fetch("/api/catalog/excel", {
          method: "POST",
          body: data,
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      setPreview(j);
    } catch (e) {
      setImportError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Hàng hóa & kho</h2>
          <p>Quản lý mã hàng, mức tồn và toàn bộ lịch sử phát sinh.</p>
        </div>
        <div className="actions">
          {worker && (
            <>
              <button
                className="primary"
                onClick={() =>
                  show("product", {
                    active: true,
                    serial_tracked: false,
                    min_stock: "0",
                  })
                }
              >
                + Hàng hóa
              </button>
              <button onClick={() => show("group")}>+ Nhóm hàng</button>
              <button
                onClick={() => {
                  setPreview(null);
                  setImportError("");
                  setForm("import");
                }}
              >
                Nhập Excel
              </button>
            </>
          )}
          <a className="button" href="/api/catalog/excel">
            Xuất Excel
          </a>
        </div>
      </div>
      <div className="filter-row">
        <Field
          label="Tìm hàng"
          value={search}
          onChange={setSearch}
          required={false}
        />
        <Field
          label="Nhóm hàng"
          value={group}
          onChange={setGroup}
          options={groups}
          required={false}
        />
        <Field
          label="Trạng thái"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Đang sử dụng" },
            { value: "inactive", label: "Đã ngừng" },
            { value: "low", label: "Dưới tồn tối thiểu" },
            { value: "all", label: "Tất cả" },
          ]}
        />
      </div>
      <div className="panel">
        <Grid
          data={items}
          columns={[
            [
              "code",
              "Mã hàng",
              (r) => (
                <button
                  className="text-button strong"
                  onClick={() => setSelected(r.id)}
                >
                  {r.code}
                </button>
              ),
            ],
            ["name", "Tên hàng"],
            [
              "group_id",
              "Nhóm",
              (r) => state.groups.find((g) => g.id === r.group_id)?.name || "—",
            ],
            ["unit", "ĐVT"],
            ["qty", "Tồn", (r) => amount(quantity(r))],
            ["held", "Đang giữ", (r) => amount(held(r))],
            [
              "min_stock",
              "Tối thiểu",
              (r) => (
                <span
                  className={quantity(r) < Number(r.min_stock) ? "warning" : ""}
                >
                  {amount(r.min_stock)}
                </span>
              ),
            ],
            [
              "active",
              "Trạng thái",
              (r) => (r.active ? "Đang dùng" : "Đã ngừng"),
            ],
            [
              "actions",
              "",
              (r) =>
                worker && (
                  <button
                    className="text-button"
                    onClick={() => show("product", r)}
                  >
                    Sửa
                  </button>
                ),
            ],
          ]}
        />
      </div>
      {p && (
        <div className="panel">
          <div className="panel-title">
            <div>
              <h3>
                {p.code} · {p.name}
              </h3>
              <p>
                {p.model} · {p.maker} · {p.unit} ·{" "}
                {p.serial_tracked ? "Theo serial" : "Theo số lượng"}
              </p>
              <p>{p.description}</p>
            </div>
            <button onClick={() => setSelected(null)}>Đóng chi tiết</button>
          </div>
          <div className="detail-metrics">
            <span>
              Tồn: <b>{amount(quantity(p))}</b>
            </span>
            <span>
              Giữ: <b>{amount(held(p))}</b>
            </span>
            <span>
              Khả dụng: <b>{amount(quantity(p) - held(p))}</b>
            </span>
            {financial && (
              <>
                <span>
                  Giá vốn: <b>{amount(val?.average_cost)} ₫</b>
                </span>
                <span>
                  Giá trị tồn: <b>{amount(val?.value)} ₫</b>
                </span>
              </>
            )}
          </div>
          <Grid
            data={state.stocks.filter((s) => s.product_id === p.id)}
            columns={[
              ["warehouse_name", "Kho"],
              ["qty", "Tồn"],
              ["reserved", "Giữ"],
              ["available", "Khả dụng"],
            ]}
          />
          <div className="panel-title">
            <h3>Lịch sử nhập–xuất và nơi giao</h3>
          </div>
          <Grid
            data={state.movements.filter((m) => m.product_id === p.id)}
            columns={[
              [
                "business_date",
                "Ngày",
                (r) => String(r.business_date).slice(0, 10),
              ],
              ["document_code", "Phiếu"],
              [
                "type",
                "Nghiệp vụ",
                (r) =>
                  ({
                    receipt: "Nhập kho",
                    dispatch: "Xuất giao",
                    transfer: "Chuyển kho",
                    return_customer: "Khách trả",
                    return_supplier: "Trả NCC",
                    adjust_up: "Điều chỉnh tăng",
                    adjust_down: "Điều chỉnh giảm",
                  })[r.type] || r.type,
              ],
              [
                "warehouse_id",
                "Kho",
                (r) =>
                  state.warehouses.find((w) => w.id === r.warehouse_id)?.name,
              ],
              ["qty", "Biến động", (r) => amount(r.qty)],
              [
                "destination",
                "Dự án / khách",
                (r) => {
                  const l = state.lines.find((l) => l.id === r.line_id),
                    i = state.items.find((i) => i.id === l?.project_item_id),
                    pk = state.packages.find((pk) => pk.id === i?.package_id),
                    pj = state.projects.find((pj) => pj.id === pk?.project_id);
                  return pj
                    ? pj.name +
                        " · " +
                        (state.partners.find((x) => x.id === pj.customer_id)
                          ?.name || "")
                    : "—";
                },
              ],
            ]}
          />
          {p.serial_tracked && (
            <>
              <div className="panel-title">
                <h3>Serial hiện tại</h3>
              </div>
              <Grid
                data={state.serials.filter((s) => s.product_id === p.id)}
                columns={[
                  ["serial", "Serial"],
                  [
                    "warehouse_id",
                    "Vị trí",
                    (r) =>
                      r.warehouse_id
                        ? state.warehouses.find((w) => w.id === r.warehouse_id)
                            ?.name
                        : "Đã xuất / ngoài kho",
                  ],
                  [
                    "last_line_id",
                    "Chứng từ gần nhất",
                    (r) =>
                      state.documents.find(
                        (d) =>
                          d.id ===
                          state.lines.find((l) => l.id === r.last_line_id)
                            ?.document_id,
                      )?.code || "—",
                  ],
                ]}
              />
            </>
          )}
        </div>
      )}
      <div className="split">
        <div className="panel">
          <div className="panel-title">
            <h3>Kho</h3>
            {manager && (
              <button onClick={() => openLegacy("warehouse")}>+ Kho</button>
            )}
          </div>
          <Grid
            data={state.warehouses}
            columns={[
              ["code", "Mã"],
              ["name", "Tên kho"],
              [
                "active",
                "Trạng thái",
                (r) => (r.active ? "Đang dùng" : "Đã ngừng"),
              ],
              [
                "actions",
                "",
                (r) =>
                  manager && (
                    <button
                      className="text-button"
                      onClick={() => show("warehouse", r)}
                    >
                      Sửa
                    </button>
                  ),
              ],
            ]}
          />
        </div>
        <div className="panel">
          <div className="panel-title">
            <h3>Đối tác</h3>
            {worker && (
              <button onClick={() => openLegacy("partner")}>+ Đối tác</button>
            )}
          </div>
          <Grid
            data={state.partners}
            columns={[
              ["code", "Mã"],
              ["name", "Tên"],
              ["tax_code", "Mã số thuế"],
              ["phone", "Điện thoại"],
              [
                "actions",
                "",
                (r) =>
                  worker && (
                    <button
                      className="text-button"
                      onClick={() => show("partner", r)}
                    >
                      Sửa
                    </button>
                  ),
              ],
            ]}
          />
        </div>
      </div>
      {form && (
        <Dialog
          title={
            {
              product: values.id ? "Sửa hàng hóa" : "Thêm hàng hóa",
              group: "Thêm nhóm hàng",
              warehouse: "Sửa kho",
              partner: "Sửa đối tác",
              import: "Nhập danh mục Excel",
            }[form]
          }
          wide={form === "import"}
          busy={busy || loading}
          error={importError || error}
          onClose={() => setForm(null)}
          onSubmit={async () => {
            const payload =
              form === "import"
                ? {
                    action: "catalog.products.import",
                    rows: preview?.rows,
                    token: preview?.token,
                  }
                : {
                    ...values,
                    action:
                      form === "product"
                        ? "catalog.product." + (values.id ? "update" : "create")
                        : form === "group"
                          ? "catalog.group.create"
                          : "catalog." + form + ".update",
                  };
            if (form === "import" && !preview) {
              setImportError("Chọn file và xem trước trước khi nhập.");
              return;
            }
            if (await act(payload)) {
              setForm(null);
            }
          }}
        >
          {form === "import" ? (
            <>
              <p className="note">
                Tối đa 500 dòng. Mã trùng sẽ cập nhật thông tin; không thay đổi
                tồn kho. Tạo nhóm hàng trước khi nhập.
              </p>
              <a href="/api/catalog/excel?template=1">Tải file mẫu Excel</a>
              <label className="upload-label">
                Chọn file .xlsx
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => upload(e.target.files[0])}
                />
              </label>
              {preview && (
                <>
                  <p className="note">
                    Tạo mới {preview.created} · Cập nhật {preview.updated}. Kiểm
                    tra rồi bấm Lưu.
                  </p>
                  <Grid
                    data={preview.prepared.map((r) => ({
                      ...r.product,
                      id: r.row,
                      operation: r.old ? "Cập nhật" : "Thêm mới",
                    }))}
                    columns={[
                      ["code", "Mã"],
                      ["name", "Tên"],
                      ["unit", "Đơn vị"],
                      ["min_stock", "Tối thiểu"],
                      ["operation", "Thao tác"],
                    ]}
                  />
                </>
              )}
            </>
          ) : (
            <div className="form-grid">
              {field("code", "Mã")}
              {field("name", "Tên")}
              {form === "product" && (
                <>
                  {field("unit", "Đơn vị tính")}
                  {field("group_id", "Nhóm hàng", "text", groups, false)}
                  {field("model", "Model", "text", undefined, false)}
                  {field("maker", "Hãng", "text", undefined, false)}
                  {field("barcode", "Mã vạch", "text", undefined, false)}
                  {field("min_stock", "Tồn tối thiểu", "number")}
                  {field("serial_tracked", "Quản lý serial", "checkbox")}
                  {field("active", "Đang sử dụng", "checkbox")}
                  {field("description", "Mô tả", "textarea", undefined, false)}
                </>
              )}
              {form === "warehouse" && (
                <>
                  {field("address", "Địa chỉ", "text", undefined, false)}
                  {field("kind", "Loại kho", "text", [
                    { value: "owned", label: "Kho sở hữu" },
                    { value: "quarantine", label: "Cách ly" },
                  ])}
                  {field("active", "Đang sử dụng", "checkbox")}
                </>
              )}
              {form === "partner" && (
                <>
                  {field("tax_code", "Mã số thuế", "text", undefined, false)}
                  {field("phone", "Điện thoại", "text", undefined, false)}
                  {field("address", "Địa chỉ", "text", undefined, false)}
                </>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
