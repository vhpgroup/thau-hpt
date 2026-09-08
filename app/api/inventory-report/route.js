import { pool, rows } from "../../../lib/db.js";
import { sessionUser } from "../../../lib/auth.js";
import { handler, json } from "../../../lib/http.js";
import { date, assert, FINANCE } from "../../../lib/validation.js";
import { csv } from "../../../lib/read.js";
export const GET = handler(async (request) => {
  const actor = await sessionUser(pool(), request),
    q = new URL(request.url).searchParams;
  const from = date(q.get("from")),
    to = date(q.get("to"));
  assert(from && to && from <= to, "Chọn khoảng ngày hợp lệ.");
  const data = await rows(
    pool(),
    `SELECT p.id,p.code,p.name,p.unit,
 COALESCE(SUM(CASE WHEN d.business_date<$1 THEN m.qty ELSE 0 END),0) opening,
 COALESCE(SUM(CASE WHEN d.business_date>=$1 AND m.qty>0 THEN m.qty ELSE 0 END),0) incoming,
 COALESCE(SUM(CASE WHEN d.business_date>=$1 AND m.qty<0 THEN -m.qty ELSE 0 END),0) outgoing,
 COALESCE(SUM(m.qty),0) closing
 FROM movements m JOIN document_lines l ON l.id=m.line_id JOIN documents d ON d.id=l.document_id JOIN products p ON p.id=m.product_id
 WHERE d.business_date<=$2 AND ($3::uuid IS NULL OR m.warehouse_id=$3::uuid)
 AND ($3::uuid IS NOT NULL OR d.type<>'transfer') GROUP BY p.id ORDER BY p.code`,
    [from, to, q.get("warehouse") || null],
  );
  if (q.get("format") === "csv")
    return new Response(
      csv(data, [
        ["code", "Mã hàng"],
        ["name", "Hàng"],
        ["unit", "ĐVT"],
        ["opening", "Tồn đầu"],
        ["incoming", "Nhập"],
        ["outgoing", "Xuất"],
        ["closing", "Tồn cuối"],
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="nhap-xuat-ton.csv"',
          "Cache-Control": "no-store",
        },
      },
    );
  return json({ data });
});
