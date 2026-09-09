import { randomUUID, createHash } from "node:crypto";
import { one, rows } from "./db.js";
import { allow, assert, text, code, number, uuid, D } from "./validation.js";
const workers = ["admin", "manager", "warehouse"];
const opt = (v, max = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
async function usedProduct(db, id) {
  return one(
    db,
    `SELECT 1 n WHERE EXISTS(SELECT 1 FROM document_lines WHERE product_id=$1) OR EXISTS(SELECT 1 FROM project_items WHERE product_id=$1) OR EXISTS(SELECT 1 FROM purchase_lines WHERE product_id=$1)`,
    [id],
  );
}
async function validateProduct(db, input, old = null) {
  const p = {
    code: code(input.code ?? old?.code),
    name: text(input.name ?? old?.name, "Tên hàng"),
    unit: text(input.unit ?? old?.unit, "Đơn vị", 40),
    model: opt(input.model ?? old?.model, 100),
    maker: opt(input.maker ?? old?.maker, 100),
    barcode: opt(input.barcode ?? old?.barcode, 100),
    description: opt(input.description ?? old?.description, 2000),
    group_id:
      input.group_id === undefined
        ? old?.group_id || null
        : input.group_id || null,
    min_stock: number(input.min_stock ?? old?.min_stock ?? "0", false),
    serial_tracked:
      input.serial_tracked === undefined
        ? old?.serial_tracked || false
        : input.serial_tracked,
    active: input.active === undefined ? (old?.active ?? true) : input.active,
  };
  assert(
    typeof p.active === "boolean" && typeof p.serial_tracked === "boolean",
    "Trạng thái phải là đúng/sai.",
  );
  if (p.group_id)
    assert(
      await one(db, "SELECT id FROM product_groups WHERE id=$1", [
        uuid(p.group_id),
      ]),
      "Nhóm hàng không tồn tại.",
    );
  const duplicate = await one(db, "SELECT id FROM products WHERE code=$1", [
    p.code,
  ]);
  assert(!duplicate || duplicate.id === old?.id, "Mã hàng đã tồn tại.", 409);
  if (old) {
    if (p.unit !== old.unit || p.serial_tracked !== old.serial_tracked)
      assert(
        !(await usedProduct(db, old.id)),
        "Không đổi đơn vị hoặc chế độ serial khi hàng đã được sử dụng.",
      );
    if (!p.active) {
      const blocking = await one(
        db,
        `SELECT 1 n WHERE EXISTS(SELECT 1 FROM balances WHERE product_id=$1 AND qty>0)
    OR EXISTS(SELECT 1 FROM reservations WHERE product_id=$1 AND remaining>0)
    OR EXISTS(SELECT 1 FROM purchase_lines l JOIN purchase_orders p ON p.id=l.order_id WHERE l.product_id=$1 AND p.status IN ('draft','submitted','approved') AND l.received_qty<l.qty)
    OR EXISTS(SELECT 1 FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE l.product_id=$1 AND d.status IN ('draft','submitted'))
    OR EXISTS(SELECT 1 FROM project_items i WHERE i.product_id=$1 AND i.plan_qty>COALESCE((SELECT SUM(l.handed_qty-l.returned_qty) FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE l.project_item_id=i.id AND d.status='posted' AND d.type='dispatch'),0))
    OR EXISTS(SELECT 1 FROM count_lines l JOIN stock_counts c ON c.id=l.count_id WHERE l.product_id=$1 AND c.status='open')`,
        [old.id],
      );
      assert(
        !blocking,
        "Chưa thể ngừng hàng: còn tồn, giữ hàng hoặc nghiệp vụ chưa hoàn tất.",
      );
    }
  }
  return p;
}
async function saveProduct(db, p, old = null) {
  const id = old?.id || randomUUID();
  const values = [
    p.code,
    p.name,
    p.unit,
    p.model,
    p.maker,
    p.barcode,
    p.description,
    p.group_id,
    p.min_stock,
    p.serial_tracked,
    p.active,
    id,
  ];
  if (old)
    await db.query(
      `UPDATE products SET code=$1,name=$2,unit=$3,model=$4,maker=$5,barcode=$6,description=$7,group_id=$8,min_stock=$9,serial_tracked=$10,active=$11,version=version+1 WHERE id=$12`,
      values,
    );
  else
    await db.query(
      "INSERT INTO products(code,name,unit,model,maker,barcode,description,group_id,min_stock,serial_tracked,active,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      values,
    );
  return { id };
}
export async function previewProducts(db, actor, input) {
  allow(actor, workers);
  assert(
    Array.isArray(input) && input.length > 0 && input.length <= 500,
    "Excel cần từ 1 đến 500 dòng hàng.",
  );
  const seen = new Set(),
    prepared = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i],
      c = code(row.code);
    assert(!seen.has(c), `Dòng ${i + 2}: mã ${c} lặp trong file.`);
    seen.add(c);
    const old = await one(db, "SELECT * FROM products WHERE code=$1", [c]);
    const group = row.group_code
      ? await one(db, "SELECT id FROM product_groups WHERE code=$1", [
          code(row.group_code),
        ])
      : null;
    assert(!row.group_code || group, `Dòng ${i + 2}: nhóm hàng chưa tồn tại.`);
    const p = await validateProduct(
      db,
      {
        ...row,
        code: c,
        group_id: row.group_code === undefined ? undefined : group?.id || null,
      },
      old,
    );
    prepared.push({
      row: i + 2,
      old: old ? { id: old.id, version: old.version } : null,
      product: p,
    });
  }
  const token = createHash("sha256")
    .update(JSON.stringify(prepared))
    .digest("hex");
  return {
    token,
    created: prepared.filter((p) => !p.old).length,
    updated: prepared.filter((p) => p.old).length,
    prepared,
  };
}
export async function catalogCommand(db, actor, input) {
  allow(actor, workers);
  const id = randomUUID();
  if (input.action === "catalog.group.create") {
    await db.query(
      "INSERT INTO product_groups(id,code,name) VALUES($1,$2,$3)",
      [id, code(input.code), text(input.name, "Tên nhóm")],
    );
    return { id };
  }
  if (input.action === "catalog.product.create")
    return saveProduct(db, await validateProduct(db, input));
  if (input.action === "catalog.product.update") {
    const old = await one(db, "SELECT * FROM products WHERE id=$1", [
      uuid(input.id),
    ]);
    assert(old, "Không tìm thấy hàng.", 404);
    assert(
      old.version === Number(input.version),
      "Hàng đã thay đổi; tải lại trước khi lưu.",
      409,
    );
    return saveProduct(db, await validateProduct(db, input, old), old);
  }
  if (input.action === "catalog.products.import") {
    const preview = await previewProducts(db, actor, input.rows);
    assert(
      input.token === preview.token,
      "Dữ liệu đã thay đổi. Xem trước file lại trước khi nhập.",
      409,
    );
    for (const row of preview.prepared)
      await saveProduct(db, row.product, row.old);
    return { id, created: preview.created, updated: preview.updated };
  }
  if (input.action === "catalog.warehouse.update") {
    allow(actor, ["admin", "manager"]);
    const w = await one(db, "SELECT * FROM warehouses WHERE id=$1", [
      uuid(input.id),
    ]);
    assert(w, "Kho không tồn tại.", 404);
    assert(w.version === Number(input.version), "Kho đã thay đổi.", 409);
    const active = input.active ?? w.active,
      kind = input.kind ?? w.kind;
    assert(
      typeof active === "boolean" && ["owned", "quarantine"].includes(kind),
      "Trạng thái kho không hợp lệ.",
    );
    if (!active || kind !== w.kind) {
      const blocked = await one(
        db,
        `SELECT 1 n WHERE EXISTS(SELECT 1 FROM balances WHERE warehouse_id=$1 AND qty>0) OR EXISTS(SELECT 1 FROM reservations WHERE warehouse_id=$1 AND remaining>0) OR EXISTS(SELECT 1 FROM stock_counts WHERE warehouse_id=$1 AND status='open') OR EXISTS(SELECT 1 FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE (l.warehouse_id=$1 OR l.to_warehouse_id=$1) AND d.status IN ('draft','submitted'))`,
        [w.id],
      );
      assert(!blocked, "Kho còn tồn hoặc nghiệp vụ chưa hoàn tất.");
    }
    await db.query(
      "UPDATE warehouses SET code=$1,name=$2,address=$3,kind=$4,active=$5,version=version+1 WHERE id=$6",
      [
        code(input.code ?? w.code),
        text(input.name ?? w.name, "Tên kho"),
        opt(input.address ?? w.address, 500),
        kind,
        active,
        w.id,
      ],
    );
    return { id: w.id };
  }
  if (input.action === "catalog.partner.update") {
    const p = await one(db, "SELECT * FROM partners WHERE id=$1", [
      uuid(input.id),
    ]);
    assert(p, "Đối tác không tồn tại.", 404);
    assert(p.version === Number(input.version), "Đối tác đã thay đổi.", 409);
    // Role is intentionally immutable here so historic AR/AP and purchase links retain their meaning.
    await db.query(
      "UPDATE partners SET code=$1,name=$2,tax_code=$3,phone=$4,address=$5,version=version+1 WHERE id=$6",
      [
        code(input.code ?? p.code),
        text(input.name ?? p.name, "Tên đối tác"),
        opt(input.tax_code ?? p.tax_code, 60),
        opt(input.phone ?? p.phone, 60),
        opt(input.address ?? p.address, 500),
        p.id,
      ],
    );
    return { id: p.id };
  }
  assert(false, "Thao tác danh mục không hợp lệ.", 404);
}
