import Decimal from "decimal.js";
Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export const D = (v) => new Decimal(v);
D.max = (...values) => Decimal.max(...values);
D.min = (...values) => Decimal.min(...values);
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(condition, message, status = 422) {
  if (!condition) throw new AppError(status, message);
}
export function text(v, label, max = 200) {
  assert(
    typeof v === "string" && v.trim().length > 0 && v.trim().length <= max,
    `${label}: cần nhập từ 1 đến ${max} ký tự.`,
  );
  return v.trim();
}
export function code(v) {
  return text(v, "Mã", 60).normalize("NFKC").toUpperCase();
}
export function uuid(v) {
  assert(
    typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "ID không hợp lệ.",
  );
  return v;
}
export function number(v, positive = true, places = 3) {
  assert(typeof v === "string" || typeof v === "number", "Số không hợp lệ.");
  let n;
  try {
    n = D(v);
  } catch {
    throw new AppError(422, "Số không hợp lệ.");
  }
  assert(
    n.isFinite() &&
      (positive ? n.gt(0) : n.gte(0)) &&
      n.decimalPlaces() <= places &&
      n.lt("1000000000000"),
    `Số phải ${positive ? "lớn hơn" : "không nhỏ hơn"} 0, tối đa ${places} chữ số thập phân.`,
  );
  return n.toFixed(places);
}
export function date(v) {
  if (!v) return null;
  assert(
    typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Ngày không hợp lệ.",
  );
  return v;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}
export function allow(actor, roles) {
  assert(
    actor?.active && roles.includes(actor.role),
    "Bạn không có quyền thực hiện thao tác này.",
    403,
  );
}
export const FINANCE = ["admin", "manager"];
