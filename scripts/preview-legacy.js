import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { csv } from "../lib/read.js";
// Read-only conversion preview. Never replay old vouchers or add source receipts to stock.
const [kind, source, destination = "migration-output"] = process.argv.slice(2);
if (!["warehouse", "project"].includes(kind) || !source) {
  console.error(
    "Dùng: npm run migration:preview -- warehouse backup.json [output-dir]\nHoặc: npm run migration:preview -- project hpt.db [output-dir]",
  );
  process.exit(1);
}
const raw = await readFile(source),
  digest = createHash("sha256").update(raw).digest("hex");
const output = resolve(destination);
await mkdir(output, { recursive: true });
let report, candidates;
if (kind === "warehouse") {
  const data = JSON.parse(raw.toString("utf8"));
  if (
    !Array.isArray(data.products) ||
    !data.stocks ||
    typeof data.stocks !== "object" ||
    !Array.isArray(data.warehouses)
  )
    throw Error("Không đúng định dạng JSON xuất từ quan-ly-kho.");
  const products = new Map(data.products.map((p) => [p.id, p])),
    warehouses = new Map(data.warehouses.map((w) => [w.id, w]));
  candidates = [];
  const issues = [];
  for (const [wid, stocks] of Object.entries(data.stocks))
    for (const [pid, qty] of Object.entries(stocks)) {
      const p = products.get(pid),
        w = warehouses.get(wid);
      if (!p || !w || !Number.isFinite(Number(qty)) || Number(qty) < 0) {
        issues.push({
          warehouse_id: wid,
          product_id: pid,
          reason: "Thiếu danh mục hoặc tồn không hợp lệ",
        });
        continue;
      }
      candidates.push({
        legacy_product_id: pid,
        legacy_warehouse_id: wid,
        sku: p.sku || "",
        name: p.name || "",
        unit: p.unit || "",
        warehouse: w.name,
        qty: String(qty),
        legacy_cost: String(p.costPrice || 0),
        target_product_id: "",
        target_warehouse_id: "",
        approved_cost: "",
        decision: "CẦN ĐỐI SOÁT",
      });
    }
  report = {
    source: kind,
    digest,
    product_count: data.products.length,
    warehouse_count: data.warehouses.length,
    voucher_count: Array.isArray(data.vouchers) ? data.vouchers.length : 0,
    opening_candidates: candidates.length,
    issues,
    warning:
      "Chỉ là ứng viên mở sổ. Không tự tin cậy giá vốn cũ; không replay vouchers đồng thời với stocks. Không xuất người dùng/mật khẩu.",
  };
  await writeFile(
    resolve(output, "warehouse-candidates.csv"),
    csv(
      candidates,
      Object.keys(
        candidates[0] || {
          legacy_product_id: "",
          legacy_warehouse_id: "",
          sku: "",
          name: "",
          qty: "",
          decision: "",
        },
      ).map((k) => [k, k]),
    ),
  );
} else {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  try {
    const projects = db.prepare("SELECT id,name FROM projects").all();
    const packages = db
      .prepare("SELECT id,project_id,code,name FROM packages")
      .all();
    const items = db
      .prepare(
        "SELECT id,package_id,order_no,name,unit,plan_qty,unit_price,model,maker FROM items",
      )
      .all();
    const receipts = db
      .prepare("SELECT id,item_id,qty,received_date FROM receipts")
      .all();
    candidates = receipts.map((r) => ({
      ...r,
      decision:
        Number(r.qty) === 0
          ? "MỐC THEO DÕI, KHÔNG NHẬP KHO"
          : "CẦN ĐỐI CHIẾU PHIẾU KHO",
      matched_warehouse_voucher_id: "",
    }));
    report = {
      source: kind,
      digest,
      projects,
      packages,
      items,
      receipt_count: receipts.length,
      warning:
        "Không coi receipt là tồn kho hoặc bàn giao. Phải xác minh sự kiện trùng với nguồn kho.",
    };
    await writeFile(
      resolve(output, "project-receipts.csv"),
      csv(candidates, [
        ["id", "legacy_receipt_id"],
        ["item_id", "legacy_item_id"],
        ["qty", "qty"],
        ["received_date", "received_date"],
        ["decision", "decision"],
        ["matched_warehouse_voucher_id", "matched_warehouse_voucher_id"],
      ]),
    );
  } finally {
    db.close();
  }
}
await writeFile(
  resolve(output, `${kind}-review.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  `Đã tạo bản đối soát ở ${output}. Chưa ghi dữ liệu vào phần mềm mới.`,
);
