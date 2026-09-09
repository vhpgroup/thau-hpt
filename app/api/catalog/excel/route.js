import { pool, transaction, rows } from "../../../../lib/db.js";
import { sessionUser } from "../../../../lib/auth.js";
import { handler, originCheck, json } from "../../../../lib/http.js";
import { allow, assert } from "../../../../lib/validation.js";
import {
  workbook,
  parseProducts,
  productColumns,
} from "../../../../lib/excel.js";
import { previewProducts } from "../../../../lib/catalog.js";
export const runtime = "nodejs";
export const GET = handler(async (request) => {
  await sessionUser(pool(), request);
  const template = new URL(request.url).searchParams.has("template");
  const data = template
    ? []
    : await rows(
        pool(),
        "SELECT p.*,g.code group_code FROM products p LEFT JOIN product_groups g ON g.id=p.group_id ORDER BY p.code",
      );
  const buffer = await workbook([
    { name: "Hàng hóa", columns: productColumns, data },
  ]);
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${template ? "mau-hang-hoa" : "hang-hoa"}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});
export const POST = handler(async (request) => {
  originCheck(request);
  const actor = await sessionUser(pool(), request);
  allow(actor, ["admin", "manager", "warehouse"]);
  const reader = request.body?.getReader();
  assert(reader, "Thiếu file.");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 5 * 1024 * 1024) {
      await reader.cancel();
      assert(false, "File tối đa 5 MB.", 413);
    }
    chunks.push(value);
  }
  const form = await new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
  const file = form.get("file");
  assert(
    file &&
      typeof file.arrayBuffer === "function" &&
      /\.xlsx$/i.test(file.name),
    "Chọn file .xlsx.",
  );
  const data = await parseProducts(Buffer.from(await file.arrayBuffer()));
  const preview = await transaction((db) => previewProducts(db, actor, data));
  return json({ rows: data, ...preview });
});
