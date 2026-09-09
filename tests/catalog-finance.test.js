import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrations.js";
import { createUser } from "../lib/auth.js";
import { command } from "../lib/service.js";
import { financeState } from "../lib/finance.js";
import { previewProducts } from "../lib/catalog.js";
import { workbook, parseProducts, productColumns } from "../lib/excel.js";
import { one } from "../lib/db.js";
let pg,
  db,
  admin,
  accountant,
  warehouse,
  n = 0;
before(async () => {
  pg = new PGlite();
  await migrate(pg);
  db = {
    connect: async () => ({
      query: (sql, params) =>
        sql.includes("pg_advisory_xact_lock")
          ? Promise.resolve({ rows: [] })
          : pg.query(sql, params),
      release() {},
    }),
  };
  for (const role of ["admin", "accountant", "warehouse"]) {
    const a = {
      ...(await createUser(pg, {
        username: role,
        name: role,
        role,
        password: "safe-test-password",
      })),
      active: true,
      role,
    };
    if (role === "admin") admin = a;
    if (role === "accountant") accountant = a;
    if (role === "warehouse") warehouse = a;
  }
});
after(async () => pg.close());
const run = (action, data = {}, actor = admin, key = randomUUID()) =>
  command(actor, { action, ...data }, key, db);
const partner = async () =>
  (
    await run("partner.create", {
      code: "PT" + ++n,
      name: "Đối tác " + n,
      kind: "both",
    })
  ).id;
async function debt(pid, side = "ar", amount = "1000", extras = {}) {
  return run("finance.debt.create", {
    code: "DEBT" + ++n,
    side,
    partner_id: pid,
    kind: "charge",
    business_date: "2026-08-01",
    due_date: "2026-08-15",
    amount,
    note: "Căn cứ chứng từ",
    ...extras,
  });
}
async function payment(pid, side = "ar", amount = "1000", extras = {}) {
  return run("finance.payment.create", {
    code: "PAY" + ++n,
    side,
    partner_id: pid,
    business_date: "2026-08-01",
    amount,
    method: "bank",
    note: "Chuyển khoản",
    ...extras,
  });
}
async function post(type, d, actor = admin) {
  await run(`finance.${type}.submit`, { id: d.id, version: 1 }, actor);
  await run(`finance.${type}.post`, { id: d.id, version: 2 }, actor);
  return d;
}
async function report(pid, asof = "2026-09-08") {
  const r = await financeState(pg, admin, asof);
  return { ...r, summary: r.balances.find((b) => b.partner_id === pid) };
}
const allocate = (p, d, amount, day = "2026-08-02") =>
  run("finance.allocate", {
    payment_id: p.id,
    debt_id: d.id,
    amount,
    business_date: day,
  });
test("AR partial payments preserve outstanding, unapplied advances and aging", async () => {
  const pid = await partner(),
    d = await post("debt", await debt(pid)),
    p = await post("payment", await payment(pid, "ar", "1200"));
  await allocate(p, d, "300");
  const r = await report(pid);
  assert.equal(r.summary.remaining, "700.00");
  assert.equal(r.summary.advance, "900.00");
  assert.equal(r.summary.net, "-200.00");
  assert.equal(r.summary.overdue, "700.00");
  assert.equal(r.summary.due_1_30, "700.00");
  await allocate(p, d, "700");
  const r2 = await report(pid);
  assert.equal(r2.summary.remaining, "0.00");
  assert.equal(r2.summary.advance, "200.00");
  await assert.rejects(() => allocate(p, d, "1"), /vượt/);
});
test("AP advance can fund multiple payable documents without reducing AR", async () => {
  const pid = await partner(),
    p = await post("payment", await payment(pid, "ap", "1500"));
  let r = await report(pid);
  assert.equal(r.summary.advance, "1500.00");
  const d1 = await post("debt", await debt(pid, "ap", "800")),
    d2 = await post("debt", await debt(pid, "ap", "900"));
  await allocate(p, d1, "800");
  await allocate(p, d2, "700");
  r = await report(pid);
  assert.equal(r.summary.remaining, "200.00");
  assert.equal(r.summary.advance, "0.00");
  assert.equal(r.summary.side, "ap");
});
test("allocations reject cross-partner, cross-side, drafts and excessive amounts", async () => {
  const a = await partner(),
    b = await partner();
  const da = await post("debt", await debt(a)),
    dbt = await post("debt", await debt(b)),
    ap = await post("debt", await debt(a, "ap"));
  const p = await post("payment", await payment(a, "ar", "200"));
  await assert.rejects(() => allocate(p, dbt, "10"), /khác đối tác/);
  await assert.rejects(() => allocate(p, ap, "10"), /khác đối tác/);
  await assert.rejects(() => allocate(p, da, "201"), /vượt/);
  const draft = await payment(a);
  await assert.rejects(() => allocate(draft, da, "1"), /đã ghi sổ/);
});
test("allocation reversal is append-only, idempotent and must precede payment void", async () => {
  const pid = await partner(),
    d = await post("debt", await debt(pid)),
    p = await post("payment", await payment(pid, "ar", "500")),
    a = await allocate(p, d, "400");
  await assert.rejects(
    () =>
      run("finance.payment.void", {
        id: p.id,
        version: 3,
        business_date: "2026-08-03",
        reason: "Nhập nhầm",
      }),
    /hoàn tác/,
  );
  const key = randomUUID(),
    payload = { id: a.id, business_date: "2026-08-03", reason: "Sửa phân bổ" };
  const first = await run("finance.allocation.reverse", payload, admin, key);
  assert.deepEqual(
    await run("finance.allocation.reverse", payload, admin, key),
    first,
  );
  await assert.rejects(
    () => run("finance.allocation.reverse", payload),
    /đã hoàn tác/,
  );
  await run("finance.payment.void", {
    id: p.id,
    version: 3,
    business_date: "2026-08-04",
    reason: "Nhập nhầm",
  });
  const past = await report(pid, "2026-08-02");
  assert.equal(past.summary.remaining, "600.00");
  assert.equal(past.summary.advance, "100.00");
  const current = await report(pid);
  assert.equal(current.summary.remaining, "1000.00");
  assert.equal(current.summary.advance, "0.00");
  assert.equal(current.summary.net, "1000.00");
  await assert.rejects(
    () => pg.query("DELETE FROM settlements WHERE id=$1", [a.id]),
    /Append-only/,
  );
});
test("credit note cannot exceed unpaid debt and does not edit original amount", async () => {
  const pid = await partner(),
    d = await post("debt", await debt(pid)),
    p = await post("payment", await payment(pid, "ar", "400"));
  await allocate(p, d, "400");
  const credit = await debt(pid, "ar", "600", {
    kind: "credit",
    source_debt_id: d.id,
    business_date: "2026-08-03",
    due_date: "2026-08-03",
  });
  await post("debt", credit);
  const r = await report(pid);
  assert.equal(r.summary.remaining, "0.00");
  assert.equal(r.summary.credited, "600.00");
  assert.equal(
    (await one(pg, "SELECT amount FROM debt_documents WHERE id=$1", [d.id]))
      .amount,
    "1000.00",
  );
  const tooMuch = await debt(pid, "ar", "1", {
    kind: "credit",
    source_debt_id: d.id,
    business_date: "2026-08-03",
    due_date: "2026-08-03",
  });
  await run("finance.debt.submit", { id: tooMuch.id, version: 1 });
  await assert.rejects(
    () => run("finance.debt.post", { id: tooMuch.id, version: 2 }),
    /Giảm vượt/,
  );
  await assert.rejects(
    () => pg.query("UPDATE debt_documents SET amount=2 WHERE id=$1", [d.id]),
    /immutable/,
  );
});
test("financial role, maker-checker and immutable posted values", async () => {
  const pid = await partner();
  await assert.rejects(() => debt(pid, "ar", "-1"), /Số phải/);
  await assert.rejects(
    () => run("finance.payment.create", {}, warehouse),
    /không có quyền/,
  );
  await assert.rejects(() => financeState(pg, warehouse), /không có quyền/);
  const d = await run(
    "finance.debt.create",
    {
      code: "ACCOUNT" + ++n,
      side: "ar",
      partner_id: pid,
      business_date: "2026-08-01",
      due_date: "2026-08-01",
      amount: "100",
      note: "Kế toán lập",
    },
    accountant,
  );
  await run("finance.debt.submit", { id: d.id, version: 1 }, accountant);
  await assert.rejects(
    () => run("finance.debt.post", { id: d.id, version: 2 }, accountant),
    /không tự duyệt/,
  );
  await run("finance.debt.post", { id: d.id, version: 2 }, admin);
  await assert.rejects(
    () =>
      run(
        "catalog.product.create",
        { code: "NO", name: "No", unit: "cái" },
        accountant,
      ),
    /không có quyền/,
  );
});
test("historical report uses effective dates and correctly ages all four buckets", async () => {
  const pid = await partner();
  for (const [i, due] of [
    "2026-08-30",
    "2026-07-30",
    "2026-06-30",
    "2026-05-30",
  ].entries())
    await post(
      "debt",
      await debt(pid, "ar", String((i + 1) * 100), {
        business_date: "2026-05-01",
        due_date: due,
      }),
    );
  const r = await report(pid);
  assert.equal(r.summary.due_1_30, "100.00");
  assert.equal(r.summary.due_31_60, "200.00");
  assert.equal(r.summary.due_61_90, "300.00");
  assert.equal(r.summary.due_over_90, "400.00");
  assert.equal(
    r.events.filter((e) => e.partner_id === pid).at(-1).balance,
    "1000.00",
  );
  assert(!(await report(pid, "2026-04-30")).summary);
});
test("stock events never automatically create debt and references cannot duplicate", async () => {
  const pid = await partner(),
    reference = "INV-" + ++n;
  await debt(pid, "ar", "100", { reference });
  await assert.rejects(() => debt(pid, "ar", "100", { reference }));
  const product = (
    await run("product.create", { code: "SRC" + ++n, name: "Máy", unit: "cái" })
  ).id;
  const before = (await one(pg, "SELECT COUNT(*) n FROM debt_documents")).n;
  await run("project.create", {
    code: "NOPAY" + ++n,
    name: "Dự án",
    customer_id: pid,
  });
  assert.equal(
    (await one(pg, "SELECT COUNT(*) n FROM debt_documents")).n,
    before,
  );
});
test("catalog creates groups and metadata, protects versions and permits reactivation", async () => {
  const g = await run("catalog.group.create", {
      code: "G" + ++n,
      name: "Máy văn phòng",
    }),
    p = await run("catalog.product.create", {
      code: "ITEM" + ++n,
      name: "Máy scan",
      unit: "cái",
      group_id: g.id,
      min_stock: "3",
      barcode: "123",
      description: "Mô tả",
    });
  await run("catalog.product.update", {
    id: p.id,
    version: 1,
    name: "Máy scan mới",
    active: false,
  });
  let row = await one(pg, "SELECT * FROM products WHERE id=$1", [p.id]);
  assert.equal(row.active, false);
  assert.equal(row.version, 2);
  assert.equal(row.min_stock, "3.000");
  await assert.rejects(
    () =>
      run("catalog.product.update", { id: p.id, version: 1, name: "Stale" }),
    /đã thay đổi/,
  );
  await run("catalog.product.update", { id: p.id, version: 2, active: true });
  const w = await run("warehouse.create", {
    code: "CATW" + ++n,
    name: "Kho",
    kind: "owned",
  });
  const d = await run("document.create", {
    code: "CATDOC" + ++n,
    type: "receipt",
    business_date: "2026-08-01",
    lines: [{ product_id: p.id, warehouse_id: w.id, qty: "1", price: "10" }],
  });
  await assert.rejects(
    () => run("catalog.product.update", { id: p.id, version: 3, unit: "bộ" }),
    /đã được sử dụng/,
  );
  await assert.rejects(
    () =>
      run("catalog.product.update", {
        id: p.id,
        version: 3,
        serial_tracked: true,
      }),
    /đã được sử dụng/,
  );
  await assert.rejects(
    () =>
      run("catalog.product.update", { id: p.id, version: 3, active: false }),
    /chưa hoàn tất/,
  );
  await assert.rejects(
    () =>
      run("catalog.warehouse.update", { id: w.id, version: 1, active: false }),
    /chưa hoàn tất/,
  );
});
test("Excel roundtrip, preview/commit matching, stale import rollback, and duplicate code rejection", async () => {
  const source = [
    {
      code: "EXCEL" + ++n,
      name: "Máy scan",
      unit: "cái",
      serial_tracked: false,
      active: true,
      min_stock: "2",
    },
  ];
  const bytes = await workbook([
      { name: "Hàng hóa", columns: productColumns, data: source },
    ]),
    parsed = await parseProducts(bytes);
  assert.equal(parsed[0].name, source[0].name);
  assert.equal(parsed[0].active, true);
  const preview = await previewProducts(pg, admin, parsed);
  assert.equal(preview.created, 1);
  await run("catalog.products.import", { rows: parsed, token: preview.token });
  const next = await previewProducts(pg, admin, parsed);
  assert.equal(next.updated, 1);
  const row = await one(pg, "SELECT * FROM products WHERE code=$1", [
    source[0].code,
  ]);
  await run("catalog.product.update", {
    id: row.id,
    version: 1,
    name: "Đã sửa",
  });
  await assert.rejects(
    () => run("catalog.products.import", { rows: parsed, token: next.token }),
    /đã thay đổi/,
  );
  assert.equal(
    (await one(pg, "SELECT name FROM products WHERE id=$1", [row.id])).name,
    "Đã sửa",
  );
  await assert.rejects(
    () => previewProducts(pg, admin, [...parsed, ...parsed]),
    /lặp trong file/,
  );
});
test("upgrade preserves original records and migration runner is repeatable", async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(
      await readFile(new URL("../db/001-initial.sql", import.meta.url), "utf8"),
    );
    await isolated.query("INSERT INTO schema_migrations(version) VALUES(1)");
    const id = randomUUID();
    await isolated.query(
      "INSERT INTO products(id,code,name,unit) VALUES($1,'OLD','Dữ liệu cũ','cái')",
      [id],
    );
    await migrate(isolated);
    await migrate(isolated);
    const p = await one(isolated, "SELECT * FROM products WHERE id=$1", [id]);
    assert.equal(p.name, "Dữ liệu cũ");
    assert.equal(p.min_stock, "0.000");
    assert.equal(p.version, 1);
  } finally {
    await isolated.close();
  }
});
test("period closing and chronological posting prevent backdated debt changes", async () => {
  const pid = await partner();
  await post(
    "debt",
    await debt(pid, "ar", "100", {
      business_date: "2026-08-10",
      due_date: "2026-08-10",
    }),
  );
  const old = await payment(pid, "ar", "10", { business_date: "2026-08-01" });
  await run("finance.payment.submit", { id: old.id, version: 1 });
  await assert.rejects(
    () => run("finance.payment.post", { id: old.id, version: 2 }),
    /Không ghi lùi/,
  );
  await run("period.close", { date: "2026-08-15" });
  const closed = await payment(await partner(), "ar", "1");
  await run("finance.payment.submit", { id: closed.id, version: 1 });
  await assert.rejects(
    () => run("finance.payment.post", { id: closed.id, version: 2 }),
    /Kỳ đã khóa/,
  );
});
