"use client";
import CatalogManager from "./CatalogManager.jsx";
import FinanceManager from "./FinanceManager.jsx";

import { useEffect, useRef, useState } from "react";
import InventoryReport from "./InventoryReport.jsx";
const fmt = (v) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(
    Number(v || 0),
  );
const money = (v) => fmt(v) + " ₫";
const date = (v) => (v ? String(v).slice(0, 10) : "—");
const statuses = {
  draft: "Nháp",
  submitted: "Chờ duyệt",
  approved: "Đã duyệt",
  posted: "Đã ghi sổ",
  closed: "Đã đóng",
  cancelled: "Đã hủy",
  open: "Đang đếm",
};
const roles = {
  admin: "Quản trị",
  manager: "Quản lý",
  warehouse: "Thủ kho",
  project: "Phụ trách dự án",
  viewer: "Chỉ xem",
  accountant: "Kế toán",
};
const types = {
  receipt: "Nhập kho",
  dispatch: "Xuất giao",
  transfer: "Chuyển kho",
  return_customer: "Khách trả giảm giao",
  return_supplier: "Trả nhà cung cấp",
  adjust_up: "Điều chỉnh tăng",
  adjust_down: "Điều chỉnh giảm",
};
const nav = [
  ["overview", "Tổng quan", "◫"],
  ["projects", "Dự án & gói thầu", "▤"],
  ["purchases", "Mua hàng", "↙"],
  ["stocks", "Tồn kho & giữ hàng", "▦"],
  ["documents", "Chứng từ kho", "⇄"],
  ["handovers", "Bàn giao", "✓"],
  ["counts", "Kiểm kê", "⊞"],
  ["catalog", "Hàng hóa & kho", "≡"],
  ["finance", "Công nợ & thu chi", "₫"],
  ["reports", "Báo cáo", "▥"],
  ["settings", "Quản trị", "⚙"],
];
function Badge({ value }) {
  return <span className={"badge " + value}>{statuses[value] || value}</span>;
}
function Empty({
  children = "Chưa có dữ liệu. Tạo bản ghi đầu tiên để bắt đầu.",
}) {
  return (
    <div className="empty">
      <span>○</span>
      <p>{children}</p>
    </div>
  );
}
function Table({ columns, data, keyField = "id" }) {
  return data.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={r[keyField] || i}>
              {columns.map(([key, , render]) => (
                <td key={key}>{render ? render(r) : (r[key] ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("Máy chủ chưa phản hồi. Hãy thử lại.");
  }
  if (!r.ok) {
    const e = new Error(data.error || "Không thể xử lý.");
    e.status = r.status;
    throw e;
  }
  return data;
}
export default function Workspace() {
  const [state, setState] = useState(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const retryKeys = useRef(new Map()),
    inFlight = useRef(false);
  async function refresh() {
    try {
      setState(await request("/api/state"));
    } catch (e) {
      if (e.status === 401) setState(null);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    setSearch("");
    setSelected("");
  }, [page]);
  async function act(payload, confirm = false) {
    if (inFlight.current) return false;
    if (
      confirm &&
      !window.confirm(
        "Xác nhận thao tác? Chứng từ đã ghi sổ sẽ được giữ nguyên để đối soát.",
      )
    )
      return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify(payload);
    let key = retryKeys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      retryKeys.current.set(fingerprint, key);
    }
    try {
      await request("/api/commands", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: fingerprint,
      });
      retryKeys.current.delete(fingerprint);
      setNotice("Đã lưu thành công.");
      await refresh();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="loading" role="status">
        Đang kết nối HPT…
      </main>
    );
  if (!state)
    return (
      <Login
        error={error}
        onLogin={async (data) => {
          setState(data.user ? null : data);
          setError("");
          await refresh();
        }}
      />
    );
  const finance = ["admin", "manager"].includes(state.user.role),
    worker = [...["admin", "manager"], "warehouse"].includes(state.user.role),
    planner = finance || state.user.role === "project";
  const find = (list, value) => state[list].find((x) => x.id === value);
  const label = (list, value) =>
    find(list, value)?.name || find(list, value)?.code || "—";
  const product = (value) => find("products", value);
  const itemLabel = (value) => {
    const i = find("items", value);
    return i ? `${label("packages", i.package_id)} · ${i.name}` : "Hàng dự trữ";
  };
  const filtered = (arr) =>
    arr.filter((x) =>
      JSON.stringify(x)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(
          search
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        ),
    );
  const open = (kind, initial = {}) => {
    setError("");
    setModal({ kind, initial });
  };
  const button = (title, fn, secondary = false) => (
    <button
      className={secondary ? "secondary" : "primary"}
      disabled={busy}
      onClick={fn}
    >
      {title}
    </button>
  );
  const header = (title, desc, actions) => (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
  const itemColumns = [
    [
      "name",
      "Hàng theo hợp đồng",
      (r) => (
        <>
          <b>{r.name}</b>
          <small>
            {product(r.product_id)?.code} · {label("packages", r.package_id)}
          </small>
        </>
      ),
    ],
    ["plan_qty", "Kế hoạch", (r) => fmt(r.plan_qty)],
    ["handed", "Bàn giao", (r) => fmt(r.handed)],
    ["in_transit", "Đang giao", (r) => fmt(r.in_transit)],
    ["reserved", "Đang giữ", (r) => fmt(r.reserved)],
    ["ordered", "Đang đặt", (r) => fmt(r.ordered)],
    [
      "shortage",
      "Thiếu nguồn",
      (r) => (
        <strong className={Number(r.shortage) > 0 ? "warning" : "positive"}>
          {fmt(r.shortage)}
        </strong>
      ),
    ],
    ...(finance
      ? [
          [
            "actions",
            "",
            (r) => (
              <button
                className="text-button"
                onClick={() =>
                  open("revision", {
                    id: r.id,
                    version: r.version,
                    plan_qty: r.plan_qty,
                  })
                }
              >
                Điều chỉnh
              </button>
            ),
          ],
        ]
      : []),
  ];
  const stockColumns = [
    ["code", "Mã hàng"],
    ["name", "Hàng hóa"],
    ["warehouse_name", "Kho"],
    ["qty", "Tồn thực tế", (r) => fmt(r.qty)],
    ["reserved", "Đang giữ", (r) => fmt(r.reserved)],
    [
      "available",
      "Khả dụng",
      (r) => <b className="positive">{fmt(r.available)}</b>,
    ],
    ["unit", "ĐVT"],
  ];
  const lineColumns = [
    [
      "product_id",
      "Hàng hóa",
      (r) => (
        <>
          <b>{product(r.product_id)?.name}</b>
          <small>{product(r.product_id)?.code}</small>
        </>
      ),
    ],
    ["warehouse_id", "Kho", (r) => label("warehouses", r.warehouse_id)],
    ["qty", "Số lượng", (r) => fmt(r.qty)],
    ...(finance
      ? [
          ["price", "Đơn giá", (r) => money(r.price)],
          [
            "cost_value",
            "Giá trị vốn",
            (r) => (r.cost_value === null ? "Chờ ghi sổ" : money(r.cost_value)),
          ],
        ]
      : []),
    ["project_item_id", "Dự án / gói", (r) => itemLabel(r.project_item_id)],
    ["serials", "Serial", (r) => r.serials.join(", ") || "—"],
  ];
  let content;
  if (page === "overview")
    content = (
      <>
        {header(
          "Điều phối hôm nay",
          "Theo dõi nguồn hàng và tiến độ bàn giao trong cùng một nơi.",
          button("Làm mới", refresh, true),
        )}
        <div className="metrics">
          <Metric
            label="Dự án đang quản lý"
            value={state.projects.length}
            note="Dự án trong phạm vi truy cập"
          />
          <Metric
            label="Dòng hàng thiếu nguồn"
            value={state.items.filter((i) => Number(i.shortage) > 0).length}
            note="Chưa đủ hàng giữ hoặc đơn mua"
          />
          <Metric
            label="Chờ duyệt kho"
            value={
              state.documents.filter((d) => d.status === "submitted").length
            }
            note="Chưa ảnh hưởng tồn kho"
          />
          <Metric
            label="Dòng đã bàn giao đủ"
            value={
              state.items.filter((i) => Number(i.handed) >= Number(i.plan_qty))
                .length
            }
            note={`Trên ${state.items.length} dòng kế hoạch`}
          />
        </div>
        {(!state.products.length || !state.warehouses.length) && (
          <div className="onboarding">
            <h3>Bắt đầu với danh mục chung</h3>
            <p>
              Tạo kho, hàng hóa và đối tác trước khi lập kế hoạch dự án hoặc
              chứng từ.
            </p>
            {button("Mở danh mục", () => setPage("catalog"))}
          </div>
        )}
        <div className="panel">
          <div className="panel-title">
            <h3>Hàng cần bổ sung nguồn</h3>
            <button className="text-button" onClick={() => setPage("projects")}>
              Xem dự án →
            </button>
          </div>
          <Table
            columns={itemColumns}
            data={state.items.filter((i) => Number(i.shortage) > 0)}
          />
        </div>
        <div className="note">
          Nhập kho cập nhật nguồn hàng. Tiến độ dự án chỉ tăng khi xác nhận bàn
          giao cho khách.
        </div>
      </>
    );
  if (page === "projects")
    content = (
      <>
        {header(
          "Dự án & gói thầu",
          "Kế hoạch, nguồn hàng và bàn giao được theo dõi riêng.",
          planner ? (
            <>
              {button("+ Dự án", () => open("project"))}
              {button("+ Gói thầu", () => open("package"), true)}
              {button("+ Dòng kế hoạch", () => open("item"), true)}
            </>
          ) : null,
        )}
        <div className="project-grid">
          {filtered(state.projects).map((p) => (
            <button
              className={
                "project-card " + (selected === p.id ? "selected" : "")
              }
              key={p.id}
              onClick={() => setSelected(selected === p.id ? "" : p.id)}
            >
              <span className="eyebrow">{p.code}</span>
              <h3>{p.name}</h3>
              <p>{label("partners", p.customer_id)}</p>
              <div>
                <span>
                  {state.packages.filter((k) => k.project_id === p.id).length}{" "}
                  gói thầu
                </span>
                <span>Hạn {date(p.deadline)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="panel-title">
            <h3>
              {selected ? label("projects", selected) : "Toàn bộ kế hoạch"}
            </h3>
            <a href="/api/export?type=items">Xuất CSV</a>
          </div>
          <Table
            columns={itemColumns}
            data={filtered(
              state.items.filter(
                (i) =>
                  !selected ||
                  find("packages", i.package_id)?.project_id === selected,
              ),
            )}
          />
        </div>
      </>
    );
  if (page === "purchases")
    content = (
      <>
        {header(
          "Mua hàng",
          "Mỗi dòng đơn mua có thể phân bổ cho một dòng kế hoạch.",
          finance ? button("+ Đơn mua", () => open("purchase")) : null,
        )}
        {state.user.role === "project" ? (
          <Empty>
            Thông tin mua hàng được tổng hợp tại cột “Đang đặt” trong dự án của
            bạn.
          </Empty>
        ) : (
          filtered(state.purchases).map((p) => (
            <div className="panel" key={p.id}>
              <div className="panel-title">
                <div>
                  <h3>
                    {p.code} <Badge value={p.status} />
                  </h3>
                  <p>
                    {label("partners", p.supplier_id)} · Dự kiến{" "}
                    {date(p.expected_date)}
                  </p>
                </div>
                <div className="actions">
                  {finance &&
                    p.status === "draft" &&
                    button("Gửi duyệt", () =>
                      act({ action: "purchase.submit", id: p.id }),
                    )}
                  {finance &&
                    p.status === "submitted" &&
                    button("Duyệt đơn", () =>
                      act({ action: "purchase.approve", id: p.id }, true),
                    )}
                  {finance &&
                    p.status === "approved" &&
                    button(
                      "Đóng phần còn lại",
                      () => open("closePurchase", { id: p.id }),
                      true,
                    )}
                </div>
              </div>
              <Table
                data={state.purchaseLines.filter((l) => l.order_id === p.id)}
                columns={[
                  [
                    "product_id",
                    "Hàng hóa",
                    (r) => product(r.product_id)?.name,
                  ],
                  [
                    "project_item_id",
                    "Phân bổ",
                    (r) => itemLabel(r.project_item_id),
                  ],
                  ["qty", "Đặt", (r) => fmt(r.qty)],
                  ["received_qty", "Đã nhận", (r) => fmt(r.received_qty)],
                  ...(finance
                    ? [["price", "Giá mua", (r) => money(r.price)]]
                    : []),
                  [
                    "actions",
                    "",
                    (r) =>
                      worker &&
                      p.status === "approved" &&
                      Number(r.received_qty) < Number(r.qty) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            open("document", {
                              type: "receipt",
                              lines: [
                                {
                                  product_id: r.product_id,
                                  purchase_line_id: r.id,
                                  project_item_id: r.project_item_id || "",
                                  qty: String(
                                    Number(r.qty) - Number(r.received_qty),
                                  ),
                                  price: r.price || "0",
                                },
                              ],
                            })
                          }
                        >
                          Nhận hàng →
                        </button>
                      ),
                  ],
                ]}
              />
            </div>
          ))
        )}
        {!state.purchases.length && state.user.role !== "project" && <Empty />}
      </>
    );
  if (page === "stocks")
    content = (
      <>
        {header(
          "Tồn kho & giữ hàng",
          "Khả dụng = tồn thực tế − lượng đang giữ cho dự án.",
          <>
            {(worker || planner) &&
              button("+ Giữ hàng", () => open("reservation"))}
            <a className="button secondary" href="/api/export?type=stocks">
              Xuất CSV
            </a>
          </>,
        )}
        <div className="panel">
          <Table columns={stockColumns} data={filtered(state.stocks)} />
        </div>
        <div className="panel">
          <div className="panel-title">
            <h3>Hàng đã giữ cho dự án</h3>
            <span>{state.reservations.length} phân bổ còn hiệu lực</span>
          </div>
          <Table
            data={filtered(state.reservations)}
            columns={[
              [
                "project_item_id",
                "Dòng kế hoạch",
                (r) => itemLabel(r.project_item_id),
              ],
              [
                "warehouse_id",
                "Kho",
                (r) => label("warehouses", r.warehouse_id),
              ],
              ["remaining", "Còn giữ", (r) => fmt(r.remaining)],
              [
                "actions",
                "",
                (r) =>
                  (worker || planner) && (
                    <button
                      className="text-button"
                      onClick={() =>
                        open("release", { id: r.id, qty: r.remaining })
                      }
                    >
                      Giải phóng
                    </button>
                  ),
              ],
            ]}
          />
        </div>
      </>
    );
  if (page === "documents")
    content = (
      <>
        {header(
          "Chứng từ kho",
          "Nháp → chờ duyệt → ghi sổ. Chỉ phiếu ghi sổ tác động tồn.",
          worker ? button("+ Lập phiếu", () => open("document")) : null,
        )}
        <div className="panel">
          <Table
            data={filtered(state.documents)}
            columns={[
              [
                "code",
                "Số phiếu",
                (r) => (
                  <button
                    className="text-button strong"
                    onClick={() => setSelected(selected === r.id ? "" : r.id)}
                  >
                    {r.code}
                  </button>
                ),
              ],
              ["type", "Nghiệp vụ", (r) => types[r.type]],
              ["business_date", "Ngày", (r) => date(r.business_date)],
              ["status", "Trạng thái", (r) => <Badge value={r.status} />],
              [
                "actions",
                "",
                (r) => (
                  <div className="actions">
                    {worker && r.status === "draft" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act({
                            action: "document.submit",
                            id: r.id,
                            version: r.version,
                          })
                        }
                      >
                        Gửi duyệt
                      </button>
                    )}
                    {finance && r.status === "submitted" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "document.post",
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
                    {worker && ["draft", "submitted"].includes(r.status) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "document.cancel",
                              id: r.id,
                              version: r.version,
                            },
                            true,
                          )
                        }
                      >
                        Hủy
                      </button>
                    )}
                  </div>
                ),
              ],
            ]}
          />
        </div>
        {selected && find("documents", selected) && (
          <div className="panel">
            <div className="panel-title">
              <div>
                <h3>Chi tiết {find("documents", selected).code}</h3>
                <p>{find("documents", selected).note || "Không có ghi chú"}</p>
              </div>
            </div>
            <Table
              columns={lineColumns}
              data={state.lines.filter((l) => l.document_id === selected)}
            />
          </div>
        )}
      </>
    );
  const dispatchLines = state.lines.filter((l) => {
    const d = find("documents", l.document_id);
    return d?.type === "dispatch" && d.status === "posted";
  });
  if (page === "handovers")
    content = (
      <>
        {header(
          "Bàn giao",
          "Xác nhận số lượng khách đã nhận theo phiếu xuất gốc.",
        )}
        <div className="panel">
          <div className="panel-title">
            <h3>Phiếu xuất và lượng đã xác nhận</h3>
          </div>
          <Table
            data={filtered(dispatchLines)}
            columns={[
              [
                "document_id",
                "Phiếu xuất",
                (r) => find("documents", r.document_id)?.code,
              ],
              ["product_id", "Hàng", (r) => product(r.product_id)?.name],
              [
                "project_item_id",
                "Gói thầu",
                (r) => itemLabel(r.project_item_id),
              ],
              ["qty", "Đã xuất", (r) => fmt(r.qty)],
              ["handed_qty", "Đã bàn giao", (r) => fmt(r.handed_qty)],
              ["returned_qty", "Trả giảm giao", (r) => fmt(r.returned_qty)],
              [
                "actions",
                "",
                (r) =>
                  planner &&
                  Number(r.handed_qty) < Number(r.qty) && (
                    <button
                      className="primary"
                      onClick={() =>
                        open("handover", {
                          line_id: r.id,
                          qty: String(Number(r.qty) - Number(r.handed_qty)),
                        })
                      }
                    >
                      Xác nhận
                    </button>
                  ),
              ],
            ]}
          />
        </div>
        <div className="panel">
          <div className="panel-title">
            <h3>Lịch sử xác nhận</h3>
          </div>
          <Table
            data={state.handovers}
            columns={[
              [
                "created_at",
                "Thời điểm",
                (r) => new Date(r.created_at).toLocaleString("vi-VN"),
              ],
              [
                "line_id",
                "Hàng hóa",
                (r) =>
                  product(
                    state.lines.find((l) => l.id === r.line_id)?.product_id,
                  )?.name,
              ],
              ["qty", "Số lượng", (r) => fmt(r.qty)],
              ["recipient", "Người nhận"],
            ]}
          />
        </div>
      </>
    );
  if (page === "counts")
    content = (
      <>
        {header(
          "Kiểm kê kho",
          "Khóa phát sinh trong kho khi đếm; chênh lệch được ghi bằng phiếu điều chỉnh.",
          worker ? button("+ Phiên kiểm kê", () => open("count")) : null,
        )}
        {state.counts.map((c) => (
          <div className="panel" key={c.id}>
            <div className="panel-title">
              <div>
                <h3>
                  {label("warehouses", c.warehouse_id)}{" "}
                  <Badge value={c.status} />
                </h3>
                <p>Mở ngày {date(c.created_at)}</p>
              </div>
              <div className="actions">
                {finance &&
                  c.status === "open" &&
                  button("Nhập kết quả & duyệt", () =>
                    open("countPost", { id: c.id }),
                  )}
                {worker &&
                  c.status === "open" &&
                  button(
                    "Hủy phiên",
                    () => act({ action: "count.cancel", id: c.id }, true),
                    true,
                  )}
              </div>
            </div>
            <Table
              data={state.countLines.filter((l) => l.count_id === c.id)}
              columns={[
                ["product_id", "Hàng", (r) => product(r.product_id)?.name],
                ["system_qty", "Tồn hệ thống", (r) => fmt(r.system_qty)],
                [
                  "counted_qty",
                  "Đã đếm",
                  (r) =>
                    r.counted_qty === null ? "Chờ đếm" : fmt(r.counted_qty),
                ],
                [
                  "serials",
                  "Serial hệ thống",
                  (r) => r.serials.join(", ") || "—",
                ],
              ]}
            />
          </div>
        ))}
        {!state.counts.length && <Empty />}
      </>
    );
  if (page === "catalog")
    content = (
      <CatalogManager
        state={state}
        act={act}
        busy={busy}
        error={error}
        openLegacy={open}
      />
    );
  if (page === "finance")
    content = (
      <FinanceManager state={state} act={act} busy={busy} error={error} />
    );
  if (page === "reports")
    content = (
      <>
        {header(
          "Báo cáo",
          "Lãi gộp hàng hóa theo phần đã bàn giao, chưa trừ chi phí dự án.",
          finance ? (
            <a className="button secondary" href="/api/export?type=report">
              Xuất CSV
            </a>
          ) : null,
        )}
        {<InventoryReport warehouses={state.warehouses} />}
        {finance ? (
          <>
            <div className="metrics">
              <Metric
                label="Giá trị tồn toàn công ty"
                value={money(
                  state.valuations.reduce((s, v) => s + Number(v.value), 0),
                )}
                note="Bao gồm kho cách ly thuộc sở hữu"
              />
              <Metric
                label="Lãi gộp hàng đã bàn giao"
                value={money(
                  state.report.reduce((s, v) => s + Number(v.profit), 0),
                )}
                note="Chưa gồm vận chuyển, lắp đặt và chi phí khác"
              />
            </div>
            <div className="panel">
              <div className="panel-title">
                <h3>Định giá tồn</h3>
              </div>
              <Table
                data={state.valuations}
                keyField="product_id"
                columns={[
                  ["code", "Mã hàng"],
                  ["name", "Hàng"],
                  ["qty", "Lượng", (r) => fmt(r.qty)],
                  [
                    "average_cost",
                    "Giá vốn bình quân",
                    (r) => money(r.average_cost),
                  ],
                  ["value", "Giá trị tồn", (r) => money(r.value)],
                ]}
              />
            </div>
            <div className="panel">
              <div className="panel-title">
                <h3>Lãi gộp hàng theo dòng hợp đồng</h3>
              </div>
              <Table
                data={state.report}
                columns={[
                  ["name", "Dòng hàng"],
                  ["handed", "Bàn giao ròng", (r) => fmt(r.handed)],
                  ["revenue", "Giá trị bàn giao", (r) => money(r.revenue)],
                  ["cost", "Giá vốn", (r) => money(r.cost)],
                  ["profit", "Lãi gộp", (r) => money(r.profit)],
                ]}
              />
            </div>
          </>
        ) : (
          <Empty>
            Tài khoản của bạn chưa có quyền xem giá vốn. Báo cáo số lượng nằm ở
            Tồn kho và Dự án.
          </Empty>
        )}
      </>
    );
  if (page === "settings")
    content = (
      <>
        {header(
          "Quản trị",
          "Tài khoản, khóa kỳ và nhật ký thao tác.",
          <>
            {state.user.role === "admin" &&
              button("+ Người dùng", () => open("user"))}
            {finance && button("Khóa kỳ", () => open("period"), true)}
          </>,
        )}
        <div className="note">
          Đã khóa nghiệp vụ đến: <b>{date(state.settings.closed_through)}</b>.
          Không được ghi sổ vào kỳ đã khóa.
        </div>
        {state.user.role === "admin" && (
          <div className="panel">
            <Table
              data={state.users}
              columns={[
                ["username", "Tài khoản"],
                ["name", "Họ tên"],
                ["role", "Vai trò", (r) => roles[r.role]],
                [
                  "actions",
                  "",
                  (r) => (
                    <button
                      className="text-button"
                      onClick={() => open("password", { id: r.id })}
                    >
                      Đặt lại mật khẩu
                    </button>
                  ),
                ],
              ]}
            />
          </div>
        )}
        {finance && (
          <div className="panel">
            <div className="panel-title">
              <h3>100 thao tác gần nhất</h3>
            </div>
            <Table
              data={state.audit}
              columns={[
                [
                  "created_at",
                  "Thời gian",
                  (r) => new Date(r.created_at).toLocaleString("vi-VN"),
                ],
                ["actor_name", "Người thực hiện"],
                ["action", "Thao tác"],
                [
                  "entity_id",
                  "Mã tham chiếu",
                  (r) => <code>{r.entity_id.slice(0, 12)}</code>,
                ],
              ]}
            />
          </div>
        )}
      </>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>H</span>
          <div>
            HPT<small>DỰ ÁN & KHO</small>
          </div>
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {nav.map(([key, title, icon]) => (
            <button
              className={page === key ? "active" : ""}
              key={key}
              onClick={() => setPage(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{state.user.name.slice(0, 1)}</div>
          <div>
            <b>{state.user.name}</b>
            <small>{roles[state.user.role]}</small>
          </div>
          <button
            aria-label="Đăng xuất"
            title="Đăng xuất"
            onClick={async () => {
              try {
                await request("/api/auth/logout", { method: "POST" });
                setState(null);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            ↪
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Vận hành / <b>{nav.find((n) => n[0] === page)?.[1]}</b>
          </span>
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              placeholder="Tìm trong màn hình…"
              aria-label="Tìm kiếm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>
        <div className="workspace">
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Đóng thông báo">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
              <button onClick={() => setNotice("")} aria-label="Đóng thông báo">
                ×
              </button>
            </div>
          )}
          {content}
        </div>
      </main>
      {modal && (
        <Editor
          config={modal}
          state={state}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          onSave={async (p) => {
            if (await act(p)) setModal(null);
          }}
        />
      )}
    </div>
  );
}
function Metric({ label, value, note }) {
  return (
    <div className="metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Login({ error: outer, onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-card">
        <div className="login-mark">HPT</div>
        <p className="eyebrow">DỰ ÁN & KHO</p>
        <h1>Đăng nhập hệ thống</h1>
        <p>Điều phối hàng hóa từ kế hoạch đến bàn giao.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await onLogin(
                await request("/api/auth/login", {
                  method: "POST",
                  body: JSON.stringify(data),
                }),
              );
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Tài khoản
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {(error || outer) && (
            <div className="alert error" role="alert">
              {error || outer}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Đang xác thực…" : "Đăng nhập →"}
          </button>
        </form>
        <small>Tài khoản do quản trị viên công ty cấp.</small>
      </div>
    </main>
  );
}
function Editor({ config, state, busy, error, onClose, onSave }) {
  const { kind, initial } = config,
    dialog = useRef(null);
  const [values, setValues] = useState({
      ...(kind === "document"
        ? {
            type: "receipt",
            business_date: new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date()),
          }
        : {}),
      ...initial,
    }),
    [lines, setLines] = useState(initial.lines || [{}]);
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  const update = (key, v) => setValues((old) => ({ ...old, [key]: v }));
  const opt = (list, label = "name") =>
    state[list].map((x) => ({
      value: x.id,
      label: `${x.code ? x.code + " · " : ""}${x[label]}`,
    }));
  const itemOptions = state.items.map((i) => ({
    value: i.id,
    label: `${state.packages.find((p) => p.id === i.package_id)?.code} · ${i.name}`,
  }));
  const input = (
    key,
    label,
    type = "text",
    options = null,
    required = true,
  ) => (
    <label key={key}>
      {label}
      {options ? (
        <select
          required={required}
          value={values[key] || ""}
          onChange={(e) => update(key, e.target.value)}
        >
          <option value="">
            {required ? "Chọn…" : "Không gắn / hàng dự trữ"}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "checkbox" ? (
        <input
          type="checkbox"
          checked={!!values[key]}
          onChange={(e) => update(key, e.target.checked)}
        />
      ) : (
        <input
          type={type}
          step="any"
          required={required}
          value={values[key] ?? ""}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </label>
  );
  let title = "",
    action = "",
    fields = [];
  if (kind === "product") {
    title = "Thêm hàng hóa";
    action = "product.create";
    fields = [
      input("code", "Mã hàng"),
      input("name", "Tên hàng"),
      input("unit", "Đơn vị tính"),
      input("model", "Model", "text", null, false),
      input("maker", "Hãng", "text", null, false),
      input("serial_tracked", "Theo dõi theo serial", "checkbox", null, false),
    ];
  }
  if (kind === "warehouse") {
    title = "Thêm kho";
    action = "warehouse.create";
    fields = [
      input("code", "Mã kho"),
      input("name", "Tên kho"),
      input("kind", "Loại kho", "text", [
        { value: "owned", label: "Kho hàng sở hữu" },
        { value: "quarantine", label: "Kho cách ly" },
      ]),
    ];
  }
  if (kind === "partner") {
    title = "Thêm đối tác";
    action = "partner.create";
    fields = [
      input("code", "Mã đối tác"),
      input("name", "Tên đối tác"),
      input("kind", "Vai trò", "text", [
        { value: "customer", label: "Khách hàng" },
        { value: "supplier", label: "Nhà cung cấp" },
        { value: "both", label: "Khách hàng & NCC" },
      ]),
    ];
  }
  if (kind === "project") {
    title = "Tạo dự án";
    action = "project.create";
    fields = [
      input("code", "Mã dự án"),
      input("name", "Tên dự án"),
      input("customer_id", "Khách hàng", "text", opt("partners"), false),
      input("deadline", "Hạn dự kiến", "date", null, false),
      ...(state.user.role === "admin"
        ? [input("owner_id", "Người phụ trách", "text", opt("users"), false)]
        : []),
    ];
  }
  if (kind === "package") {
    title = "Tạo gói thầu";
    action = "package.create";
    fields = [
      input("project_id", "Dự án", "text", opt("projects")),
      input("code", "Mã gói / TBMT"),
      input("name", "Tên gói"),
      input("deadline", "Hạn giao", "date", null, false),
    ];
  }
  if (kind === "item") {
    title = "Thêm dòng kế hoạch";
    action = "item.create";
    fields = [
      input("package_id", "Gói thầu", "text", opt("packages")),
      input("product_id", "Mã hàng", "text", opt("products")),
      input("name", "Tên theo hợp đồng", "text", null, false),
      input("plan_qty", "Số lượng", "number"),
      input("sale_price", "Đơn giá bán chưa VAT", "number"),
    ];
  }
  if (kind === "revision") {
    title = "Điều chỉnh kế hoạch";
    action = "item.revise";
    fields = [
      input("plan_qty", "Kế hoạch mới", "number"),
      input("reason", "Lý do / phụ lục"),
    ];
  }
  if (kind === "reservation") {
    title = "Giữ hàng cho dự án";
    action = "reservation.create";
    fields = [
      input("project_item_id", "Dòng kế hoạch", "text", itemOptions),
      input("warehouse_id", "Kho giữ", "text", opt("warehouses")),
      input("qty", "Số lượng giữ", "number"),
    ];
  }
  if (kind === "release") {
    title = "Giải phóng hàng giữ";
    action = "reservation.release";
    fields = [input("qty", "Lượng giải phóng", "number")];
  }
  if (kind === "purchase") {
    title = "Lập đơn mua";
    action = "purchase.create";
    fields = [
      input("code", "Số đơn"),
      input("supplier_id", "Nhà cung cấp", "text", opt("partners")),
      input("expected_date", "Ngày dự kiến nhận", "date", null, false),
    ];
  }
  if (kind === "closePurchase") {
    title = "Đóng phần đơn mua chưa nhận";
    action = "purchase.close";
    fields = [input("reason", "Lý do đóng")];
  }
  if (kind === "document") {
    title = "Lập chứng từ kho";
    action = "document.create";
    fields = [
      input("code", "Số phiếu"),
      input(
        "type",
        "Nghiệp vụ",
        "text",
        Object.entries(types).map(([value, label]) => ({ value, label })),
      ),
      input("business_date", "Ngày nghiệp vụ", "date"),
      input("note", "Ghi chú / lý do", "text", null, false),
    ];
  }
  if (kind === "handover") {
    title = "Xác nhận bàn giao";
    action = "handover.create";
    fields = [
      input("qty", "Số lượng nhận", "number"),
      input("recipient", "Người nhận / số biên bản"),
      <label key="serials">
        Serial bàn giao (mỗi dòng một serial)
        <textarea
          value={values.serialText || ""}
          onChange={(e) => update("serialText", e.target.value)}
        />
      </label>,
    ];
  }
  if (kind === "user") {
    title = "Cấp tài khoản";
    action = "user.create";
    fields = [
      input("username", "Tài khoản"),
      input("name", "Họ tên"),
      input("password", "Mật khẩu (12–128 ký tự)", "password"),
      input(
        "role",
        "Vai trò",
        "text",
        Object.entries(roles).map(([value, label]) => ({ value, label })),
      ),
    ];
  }
  if (kind === "password") {
    title = "Đặt lại mật khẩu và thu hồi phiên";
    action = "user.password";
    fields = [input("password", "Mật khẩu mới (12–128 ký tự)", "password")];
  }
  if (kind === "count") {
    title = "Mở phiên kiểm kê";
    action = "count.create";
    fields = [
      input("warehouse_id", "Kho kiểm kê", "text", opt("warehouses")),
      <label key="products">
        Mã hàng cần đếm (giữ Ctrl để chọn nhiều)
        <select
          multiple
          required
          size={7}
          value={values.product_ids || []}
          onChange={(e) =>
            update(
              "product_ids",
              Array.from(e.target.selectedOptions, (o) => o.value),
            )
          }
        >
          {opt("products").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>,
    ];
  }
  if (kind === "countPost") {
    title = "Kết quả kiểm kê và duyệt";
    action = "count.post";
    fields = state.countLines
      .filter((l) => l.count_id === initial.id)
      .map((l) => (
        <fieldset key={l.id}>
          <legend>
            {state.products.find((p) => p.id === l.product_id)?.name} · Hệ
            thống: {fmt(l.system_qty)}
          </legend>
          {input("count_" + l.id, "Thực đếm", "number")}
          {input(
            "price_" + l.id,
            "Đơn giá ghi nhận phần tăng",
            "number",
            null,
            false,
          )}
          <label>
            Serial đếm (mỗi dòng một serial)
            <textarea
              value={values["serial_" + l.id] || ""}
              onChange={(e) => update("serial_" + l.id, e.target.value)}
            />
          </label>
        </fieldset>
      ));
  }
  if (kind === "period") {
    title = "Khóa kỳ nghiệp vụ";
    action = "period.close";
    fields = [input("date", "Khóa đến hết ngày", "date")];
  }
  const isLines = ["document", "purchase"].includes(kind);
  function lineInput(i, key, label, options = null, required = true) {
    const l = lines[i];
    return (
      <label key={key}>
        {label}
        {options ? (
          <select
            required={required}
            value={l[key] || ""}
            onChange={(e) => {
              const value = e.target.value;
              setLines((old) =>
                old.map((x, j) => {
                  if (j !== i) return x;
                  let y = { ...x, [key]: value };
                  if (key === "purchase_line_id" && value) {
                    const p = state.purchaseLines.find((p) => p.id === value);
                    y = {
                      ...y,
                      product_id: p.product_id,
                      project_item_id: p.project_item_id || "",
                      price: p.price || "0",
                    };
                  }
                  if (key === "source_line_id" && value) {
                    const s = state.lines.find((s) => s.id === value);
                    y = {
                      ...y,
                      product_id: s.product_id,
                      project_item_id:
                        values.type === "return_customer"
                          ? s.project_item_id || ""
                          : "",
                      price: s.price || "0",
                    };
                  }
                  return y;
                }),
              );
            }}
          >
            <option value="">{required ? "Chọn…" : "Không gắn"}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            required={required}
            type="number"
            step="any"
            value={l[key] ?? ""}
            onChange={(e) =>
              setLines((old) =>
                old.map((x, j) =>
                  j === i ? { ...x, [key]: e.target.value } : x,
                ),
              )
            }
          />
        )}
      </label>
    );
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={isLines ? "wide" : ""}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const payload = { ...values, action };
          delete payload.serialText;
          if (isLines)
            payload.lines = lines.map((l) => {
              const out = {
                ...l,
                price: l.price || "0",
                serials: (l.serialText || "")
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              };
              delete out.serialText;
              return out;
            });
          if (kind === "countPost")
            payload.lines = state.countLines
              .filter((l) => l.count_id === initial.id)
              .map((l) => ({
                id: l.id,
                counted_qty: values["count_" + l.id],
                price: values["price_" + l.id] || "0",
                serials: (values["serial_" + l.id] || "")
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              }));
          if (kind === "handover")
            payload.serials = (values.serialText || "")
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean);
          onSave(payload);
        }}
      >
        <div className="dialog-head">
          <div>
            <p className="eyebrow">HPT · NGHIỆP VỤ</p>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          <div className="form-grid">{fields}</div>
          {isLines && (
            <div className="line-editor">
              <h3>Danh sách hàng hóa</h3>
              {lines.map((l, i) => (
                <fieldset key={i}>
                  <legend>Dòng {i + 1}</legend>
                  <div className="form-grid">
                    {lineInput(i, "product_id", "Hàng hóa", opt("products"))}
                    {lineInput(i, "qty", "Số lượng")}
                    {lineInput(i, "price", "Đơn giá mua / nhận", null, false)}
                    {(kind === "purchase" ||
                      ["receipt", "dispatch", "return_customer"].includes(
                        values.type,
                      )) &&
                      lineInput(
                        i,
                        "project_item_id",
                        "Dòng dự án",
                        itemOptions,
                        false,
                      )}
                    {kind === "document" &&
                      lineInput(i, "warehouse_id", "Kho", opt("warehouses"))}
                    {values.type === "transfer" &&
                      lineInput(
                        i,
                        "to_warehouse_id",
                        "Kho nhận",
                        opt("warehouses"),
                      )}
                    {kind === "document" &&
                      values.type === "receipt" &&
                      lineInput(
                        i,
                        "purchase_line_id",
                        "Dòng đơn mua",
                        state.purchaseLines
                          .filter(
                            (p) =>
                              state.purchases.find((o) => o.id === p.order_id)
                                ?.status === "approved",
                          )
                          .map((p) => ({
                            value: p.id,
                            label: `${state.purchases.find((o) => o.id === p.order_id)?.code} · ${state.products.find((x) => x.id === p.product_id)?.name}`,
                          })),
                        false,
                      )}
                    {kind === "document" &&
                      ["return_customer", "return_supplier"].includes(
                        values.type,
                      ) &&
                      lineInput(
                        i,
                        "source_line_id",
                        "Dòng chứng từ gốc",
                        state.lines
                          .filter((s) => {
                            const d = state.documents.find(
                              (d) => d.id === s.document_id,
                            );
                            return (
                              d?.status === "posted" &&
                              d.type ===
                                (values.type === "return_customer"
                                  ? "dispatch"
                                  : "receipt")
                            );
                          })
                          .map((s) => ({
                            value: s.id,
                            label: `${state.documents.find((d) => d.id === s.document_id)?.code} · ${state.products.find((p) => p.id === s.product_id)?.name}`,
                          })),
                      )}
                    {kind === "document" && (
                      <label>
                        Serial (mỗi dòng một serial)
                        <textarea
                          value={l.serialText || ""}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((x, j) =>
                                j === i
                                  ? { ...x, serialText: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        setLines((old) => old.filter((_, j) => j !== i))
                      }
                    >
                      Bỏ dòng
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() => setLines((old) => [...old, {}])}
              >
                + Thêm dòng hàng
              </button>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <span>
            {isLines
              ? "Chứng từ được lưu nháp trước khi duyệt."
              : "Kiểm tra thông tin trước khi lưu."}
          </span>
          <button type="button" disabled={busy} onClick={onClose}>
            Đóng
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu thông tin"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
