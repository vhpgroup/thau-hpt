"use client";
import { useState } from "react";
export default function InventoryReport({ warehouses }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + "01"),
    [to, setTo] = useState(today),
    [warehouse, setWarehouse] = useState(""),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loadedQuery, setLoadedQuery] = useState("");
  const params = new URLSearchParams({
    from,
    to,
    ...(warehouse ? { warehouse } : {}),
  });
  return (
    <div className="panel">
      <div className="panel-title">
        <h3>Nhập–xuất–tồn theo kỳ</h3>
        {data && (
          <a href={"/api/inventory-report?" + loadedQuery + "&format=csv"}>
            Xuất kết quả CSV
          </a>
        )}
      </div>
      <form
        className="report-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const q = params.toString(),
              r = await fetch("/api/inventory-report?" + q),
              j = await r.json();
            if (!r.ok) throw Error(j.error);
            setData(j.data);
            setLoadedQuery(q);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Từ ngày
          <input
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Kho
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">Toàn công ty</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Đang tính…" : "Xem báo cáo"}
        </button>
      </form>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Mã hàng",
                  "Tên hàng",
                  "ĐVT",
                  "Tồn đầu",
                  "Nhập",
                  "Xuất",
                  "Tồn cuối",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  {[
                    "code",
                    "name",
                    "unit",
                    "opening",
                    "incoming",
                    "outgoing",
                    "closing",
                  ].map((k) => (
                    <td key={k}>{r[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.length && (
            <p className="empty">Không có phát sinh đến ngày đã chọn.</p>
          )}
        </div>
      )}
    </div>
  );
}
