"use client";
import { useEffect, useRef } from "react";
export const amount = (v) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(
    Number(v || 0),
  );
export const currentDay = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
export function Grid({ data, columns }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([k, label]) => (
              <th key={k}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map(([k, , fn]) => (
                <td key={k}>{fn ? fn(r) : (r[k] ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <p className="empty">Chưa có dữ liệu phù hợp.</p>}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  error,
  wide = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
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
          {children}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Đóng
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = "text",
  options,
  required = true,
  ...rest
}) {
  return (
    <label>
      {label}
      {options ? (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          {...rest}
        >
          <option value="">{required ? "Chọn…" : "Không gắn"}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "checkbox" ? (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          {...rest}
        />
      ) : type === "textarea" ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          {...rest}
        />
      ) : (
        <input
          type={type}
          step="any"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          {...rest}
        />
      )}
    </label>
  );
}
