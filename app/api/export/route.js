import { pool } from "../../../lib/db.js";
import { sessionUser } from "../../../lib/auth.js";
import { readState, csv } from "../../../lib/read.js";
import { handler } from "../../../lib/http.js";
import { assert, FINANCE } from "../../../lib/validation.js";
export const GET = handler(async (request) => {
  const user = await sessionUser(pool(), request),
    type = new URL(request.url).searchParams.get("type") || "stocks";
  assert(
    ["stocks", "items", "report"].includes(type),
    "Loại báo cáo không hợp lệ.",
  );
  if (type === "report")
    assert(FINANCE.includes(user.role), "Không có quyền xem giá vốn.", 403);
  const state = await readState(user);
  const columns =
    type === "stocks"
      ? [
          ["code", "Mã hàng"],
          ["name", "Tên hàng"],
          ["warehouse_name", "Kho"],
          ["unit", "ĐVT"],
          ["qty", "Tồn"],
          ["reserved", "Đang giữ"],
          ["available", "Khả dụng"],
        ]
      : type === "items"
        ? [
            ["name", "Tên hàng hợp đồng"],
            ["plan_qty", "Kế hoạch"],
            ["shipped", "Đã xuất ròng"],
            ["handed", "Bàn giao ròng"],
            ["reserved", "Đang giữ"],
            ["ordered", "Đang đặt"],
            ["shortage", "Thiếu nguồn"],
          ]
        : [
            ["name", "Hàng"],
            ["handed", "Bàn giao"],
            ["revenue", "Giá trị bàn giao"],
            ["cost", "Giá vốn"],
            ["profit", "Lãi gộp hàng"],
          ];
  return new Response(csv(state[type], columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hpt-${type}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
