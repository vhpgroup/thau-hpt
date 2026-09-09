import ExcelJS from "exceljs";
import { assert } from "./validation.js";
export const productColumns = [
  ["code", "Mã hàng"],
  ["name", "Tên hàng"],
  ["unit", "Đơn vị"],
  ["model", "Model"],
  ["maker", "Hãng"],
  ["group_code", "Mã nhóm"],
  ["barcode", "Mã vạch"],
  ["min_stock", "Tồn tối thiểu"],
  ["serial_tracked", "Serial"],
  ["active", "Hoạt động"],
  ["description", "Mô tả"],
];
export async function workbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HPT";
  for (const { name, columns, data } of sheets) {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(([key, header]) => ({
      key,
      header,
      width: ["name", "note", "description"].includes(key) ? 36 : 22,
    }));
    for (const r of data)
      ws.addRow(
        Object.fromEntries(
          columns.map(([key]) => [
            key,
            r[key] === true
              ? "Có"
              : r[key] === false
                ? "Không"
                : String(r[key] ?? ""),
          ]),
        ),
      );
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: "A1",
      to: { row: Math.max(1, ws.rowCount), column: columns.length },
    };
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173758" },
    };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function parseProducts(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  assert(ws, "Không có trang tính.");
  assert(
    ws.rowCount <= 501 && ws.columnCount <= 30,
    "File tối đa 500 dòng và 30 cột.",
  );
  const headers = new Map();
  ws.getRow(1).eachCell((cell, col) => headers.set(cell.text.trim(), col));
  for (const key of ["Mã hàng", "Tên hàng", "Đơn vị"])
    assert(headers.has(key), `Thiếu cột ${key}. Hãy dùng file mẫu.`);
  const result = [];
  for (let row = 2; row <= ws.rowCount; row++) {
    if (!ws.getRow(row).hasValues) continue;
    const out = {};
    for (const [key, label] of productColumns) {
      const col = headers.get(label);
      if (!col) continue;
      const cell = ws.getCell(row, col);
      assert(
        !cell.formula,
        `Dòng ${row}: không dùng công thức trong danh mục.`,
      );
      out[key] = cell.text.trim();
    }
    for (const key of ["serial_tracked", "active"])
      if (key in out) {
        const v = out[key].toLowerCase();
        assert(
          ["có", "không", "true", "false", "1", "0", ""].includes(v),
          `Dòng ${row}: ${key} dùng Có/Không.`,
        );
        out[key] = v ? ["có", "true", "1"].includes(v) : key === "active";
      }
    if (!out.min_stock) out.min_stock = "0";
    result.push(out);
  }
  assert(result.length, "File chưa có hàng hóa.");
  return result;
}
