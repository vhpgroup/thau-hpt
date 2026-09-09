import { migrate } from "../lib/migrations.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { command } from "../lib/service.js";
import { createUser } from "../lib/auth.js";
// A disposable isolated schema; never drop or modify the database's public schema.
const schema = "hpt_test_" + randomUUID().replaceAll("-", "");
if (!process.env.TEST_DATABASE_URL)
  throw Error(
    "Set TEST_DATABASE_URL to run real PostgreSQL concurrency tests.",
  );
const setup = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
await setup.query(`CREATE SCHEMA ${schema}`);
const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 8,
});
await migrate(pool);
const admin = {
  ...(await createUser(pool, {
    username: "admin",
    name: "Test",
    role: "admin",
    password: "isolated-test-password",
  })),
  role: "admin",
  active: true,
};
let n = 0;
const run = (action, payload, key = randomUUID()) =>
  command(admin, { action, ...payload }, key, pool);
test("concurrent settlement requests cannot spend the same payment twice", async () => {
  const partner = (
    await run("partner.create", {
      code: "FIN",
      name: "Khách công nợ",
      kind: "customer",
    })
  ).id;
  async function posted(type, code) {
    const result = await run(`finance.${type}.create`, {
      code,
      side: "ar",
      partner_id: partner,
      business_date: "2026-09-01",
      due_date: "2026-09-01",
      amount: "100",
      method: "bank",
      note: "Concurrency test",
    });
    await run(`finance.${type}.submit`, { id: result.id, version: 1 });
    await run(`finance.${type}.post`, { id: result.id, version: 2 });
    return result;
  }
  const payment = await posted("payment", "CASH"),
    a = await posted("debt", "INV-A"),
    b = await posted("debt", "INV-B");
  const allocate = (d) =>
    run("finance.allocate", {
      payment_id: payment.id,
      debt_id: d.id,
      amount: "80",
      business_date: "2026-09-01",
    });
  const r = await Promise.allSettled([allocate(a), allocate(b)]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT SUM(amount) amount FROM settlements WHERE payment_id=$1",
        [payment.id],
      )
    ).rows[0].amount,
    "80.00",
  );
  const key = randomUUID(),
    payload = {
      payment_id: payment.id,
      debt_id: a.id,
      amount: "20",
      business_date: "2026-09-01",
    };
  const [x, y] = await Promise.all([
    run("finance.allocate", payload, key),
    run("finance.allocate", payload, key),
  ]);
  assert.equal(x.id, y.id);
  assert.equal(
    (
      await pool.query(
        "SELECT SUM(amount) amount FROM settlements WHERE payment_id=$1",
        [payment.id],
      )
    ).rows[0].amount,
    "100.00",
  );
});
after(async () => {
  await pool.end();
  await setup.query(`DROP SCHEMA ${schema} CASCADE`);
  await setup.end();
});
test("two concurrent postings cannot consume the same remaining units", async () => {
  const p = (await run("product.create", { code: "P", name: "P", unit: "cái" }))
      .id,
    w = (await run("warehouse.create", { code: "W", name: "W", kind: "owned" }))
      .id;
  async function draft(type, qty) {
    const d = await run("document.create", {
      code: "D" + ++n,
      type,
      business_date: "2026-09-01",
      lines: [{ product_id: p, warehouse_id: w, qty, price: "100" }],
    });
    await run("document.submit", { id: d.id, version: 1 });
    return d;
  }
  await run("document.post", {
    id: (await draft("receipt", "5")).id,
    version: 2,
  });
  const a = await draft("dispatch", "4"),
    b = await draft("dispatch", "4");
  const result = await Promise.allSettled([
    run("document.post", { id: a.id, version: 2 }),
    run("document.post", { id: b.id, version: 2 }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await pool.query("SELECT qty FROM balances WHERE product_id=$1", [p]))
      .rows[0].qty,
    "1.000",
  );
});
test("concurrent duplicate idempotency key creates only one product", async () => {
  const key = randomUUID(),
    data = { code: "ONCE", name: "Once", unit: "cái" };
  const [a, b] = await Promise.all([
    run("product.create", data, key),
    run("product.create", data, key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (await pool.query("SELECT COUNT(*) n FROM products WHERE code='ONCE'"))
      .rows[0].n,
    "1",
  );
});
