import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { command, progress } from "../lib/service.js";
import { readState, csv } from "../lib/read.js";
import { one, transaction } from "../lib/db.js";
import { login, createUser, sessionUser } from "../lib/auth.js";
import { date, number } from "../lib/validation.js";
import { originCheck } from "../lib/http.js";
let pg, db, admin, manager, warehouse, project;
before(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../db/001-initial.sql", import.meta.url), "utf8"),
  );
  db = {
    connect: async () => ({
      query: async (sql, params) =>
        sql.includes("pg_advisory_xact_lock")
          ? { rows: [] }
          : pg.query(sql, params),
      release() {},
    }),
  };
  for (const role of ["admin", "manager", "warehouse", "project"]) {
    const user = await createUser(pg, {
      username: role,
      name: role,
      role,
      password: "strong-test-password",
    });
    const actor = { ...user, role, active: true };
    if (role === "admin") admin = actor;
    if (role === "manager") manager = actor;
    if (role === "warehouse") warehouse = actor;
    if (role === "project") project = actor;
  }
});
after(async () => {
  await pg.close();
});
const run = (action, payload = {}, actor = admin, key = randomUUID()) =>
  command(actor, { action, ...payload }, key, db);
const get = (table, id) => one(pg, `SELECT * FROM ${table} WHERE id=$1`, [id]);
let counter = 0;
async function basics(serial = false) {
  const n = ++counter;
  const product = (
    await run("product.create", {
      code: "P" + n,
      name: "Máy " + n,
      unit: "cái",
      serial_tracked: serial,
    })
  ).id;
  const wh = (
    await run("warehouse.create", {
      code: "W" + n,
      name: "Kho " + n,
      kind: "owned",
    })
  ).id;
  const pj = (
    await run("project.create", {
      code: "PJ" + n,
      name: "Dự án " + n,
      owner_id: project.id,
    })
  ).id;
  const pk = (
    await run("package.create", {
      project_id: pj,
      code: "PK" + n,
      name: "Gói " + n,
    })
  ).id;
  const item = (
    await run("item.create", {
      package_id: pk,
      product_id: product,
      plan_qty: "20",
      sale_price: "300",
    })
  ).id;
  return { product, wh, pj, pk, item };
}
async function document(type, lines, actor = admin) {
  return run(
    "document.create",
    { type, code: "DOC" + ++counter, business_date: "2026-09-01", lines },
    actor,
  );
}
async function post(d, actor = admin) {
  await run("document.submit", { id: d.id, version: 1 }, actor);
  return run("document.post", { id: d.id, version: 2 }, actor);
}
const line = (ctx, qty, price = "100", extra = {}) => ({
  product_id: ctx.product,
  warehouse_id: ctx.wh,
  qty,
  price,
  ...extra,
});
test("receive → reserve → dispatch → partial handover → return; project progress and valuation reconcile", async () => {
  const c = await basics();
  await post(await document("receipt", [line(c, "20")]));
  await run("reservation.create", {
    project_item_id: c.item,
    warehouse_id: c.wh,
    qty: "10",
  });
  const d = await document("dispatch", [
    line(c, "10", "0", { project_item_id: c.item }),
  ]);
  await post(d);
  const source = await one(
    pg,
    "SELECT * FROM document_lines WHERE document_id=$1",
    [d.id],
  );
  await run("handover.create", {
    line_id: source.id,
    qty: "8",
    recipient: "Khách A",
  });
  let p = await progress(pg, c.item);
  assert.equal(p.handed, "8.000");
  assert.equal(p.in_transit, "2.000");
  assert.equal(p.shortage, "10.000");
  const returned = await document("return_customer", [
    line(c, "2", "0", { project_item_id: c.item, source_line_id: source.id }),
  ]);
  await post(returned);
  p = await progress(pg, c.item);
  assert.equal(p.handed, "6.000");
  assert.equal(p.in_transit, "2.000");
  assert.equal(p.shortage, "12.000");
  const val = await one(pg, "SELECT * FROM valuations WHERE product_id=$1", [
    c.product,
  ]);
  assert.equal(val.qty, "12.000");
  assert.equal(val.value, "1200.000000");
  const sums = await one(
    pg,
    "SELECT SUM(qty) qty,SUM(value) value FROM movements WHERE product_id=$1",
    [c.product],
  );
  assert.equal(sums.qty, val.qty);
  assert.equal(sums.value, val.value);
});
test("unchanged posted receipt cannot recalculate average cost 150 to 175", async () => {
  const c = await basics();
  await post(await document("receipt", [line(c, "10", "100")]));
  const d = await document("receipt", [line(c, "10", "200")]);
  await post(d);
  await assert.rejects(
    () => run("document.post", { id: d.id, version: 3 }),
    /Chỉ ghi sổ/,
  );
  const v = await one(pg, "SELECT * FROM valuations WHERE product_id=$1", [
    c.product,
  ]);
  assert.equal(Number(v.value) / Number(v.qty), 150);
  const l = await one(
    pg,
    "SELECT id FROM document_lines WHERE document_id=$1",
    [d.id],
  );
  await assert.rejects(
    () => pg.query("UPDATE document_lines SET price=300 WHERE id=$1", [l.id]),
    /immutable/,
  );
});
test("purchase receipt atomically replaces ordered allocation with reserved stock", async () => {
  const c = await basics();
  const supplier = (
    await run("partner.create", {
      code: "SUP" + ++counter,
      name: "NCC",
      kind: "supplier",
    })
  ).id;
  const po = await run("purchase.create", {
    code: "PO" + ++counter,
    supplier_id: supplier,
    lines: [
      {
        product_id: c.product,
        project_item_id: c.item,
        qty: "20",
        price: "100",
      },
    ],
  });
  await run("purchase.submit", { id: po.id });
  await run("purchase.approve", { id: po.id });
  const pl = await one(pg, "SELECT * FROM purchase_lines WHERE order_id=$1", [
    po.id,
  ]);
  await post(
    await document("receipt", [
      line(c, "15", "100", {
        purchase_line_id: pl.id,
        project_item_id: c.item,
      }),
    ]),
  );
  const p = await progress(pg, c.item);
  assert.equal(p.ordered, "5.000");
  assert.equal(p.reserved, "15.000");
  assert.equal(p.shortage, "0.000");
  const invalid = await document("receipt", [
    line(c, "6", "100", { purchase_line_id: pl.id, project_item_id: c.item }),
  ]);
  await run("document.submit", { id: invalid.id, version: 1 });
  await assert.rejects(
    () => run("document.post", { id: invalid.id, version: 2 }),
    /vượt lượng/,
  );
  assert.equal((await get("purchase_lines", pl.id)).received_qty, "15.000");
});
test("idempotency, insufficient availability and complete rollback across multiple lines", async () => {
  const c = await basics();
  const key = randomUUID(),
    payload = { project_item_id: c.item, warehouse_id: c.wh, qty: "4" };
  await post(await document("receipt", [line(c, "5")]));
  const first = await run("reservation.create", payload, admin, key);
  assert.deepEqual(await run("reservation.create", payload, admin, key), first);
  await assert.rejects(
    () => run("reservation.create", { ...payload, qty: "3" }, admin, key),
    /nội dung khác/,
  );
  await assert.rejects(
    () => run("reservation.create", { ...payload, qty: "2" }),
    /khả dụng/,
  );
  const d = await document("dispatch", [line(c, "1"), line(c, "2")]);
  await run("document.submit", { id: d.id, version: 1 });
  await assert.rejects(
    () => run("document.post", { id: d.id, version: 2 }),
    /khả dụng/,
  );
  assert.equal(
    (await one(pg, "SELECT qty FROM balances WHERE product_id=$1", [c.product]))
      .qty,
    "5.000",
  );
  assert.equal(
    (
      await one(
        pg,
        "SELECT COUNT(*) n FROM movements m JOIN document_lines l ON l.id=m.line_id WHERE l.document_id=$1",
        [d.id],
      )
    ).n,
    0,
  );
});
test("serials require original source, cannot be received twice, and must be handed over before return", async () => {
  const c = await basics(true);
  await post(
    await document("receipt", [
      line(c, "2", "100", { serials: ["S-A", "S-B"] }),
    ]),
  );
  const duplicate = await document("receipt", [
    line(c, "1", "100", { serials: ["S-A"] }),
  ]);
  await run("document.submit", { id: duplicate.id, version: 1 });
  await assert.rejects(
    () => run("document.post", { id: duplicate.id, version: 2 }),
    /đã có lịch sử/,
  );
  await run("reservation.create", {
    project_item_id: c.item,
    warehouse_id: c.wh,
    qty: "2",
  });
  const d = await document("dispatch", [
    line(c, "2", "0", { project_item_id: c.item, serials: ["S-A", "S-B"] }),
  ]);
  await post(d);
  const l = await one(pg, "SELECT * FROM document_lines WHERE document_id=$1", [
    d.id,
  ]);
  await run("handover.create", {
    line_id: l.id,
    qty: "1",
    recipient: "Khách",
    serials: ["S-A"],
  });
  const wrong = await document("return_customer", [
    line(c, "1", "0", {
      project_item_id: c.item,
      source_line_id: l.id,
      serials: ["S-B"],
    }),
  ]);
  await run("document.submit", { id: wrong.id, version: 1 });
  await assert.rejects(
    () => run("document.post", { id: wrong.id, version: 2 }),
    /chưa được bàn giao/,
  );
  await post(
    await document("return_customer", [
      line(c, "1", "0", {
        project_item_id: c.item,
        source_line_id: l.id,
        serials: ["S-A"],
      }),
    ]),
  );
  assert.equal(
    (
      await one(
        pg,
        "SELECT warehouse_id FROM serials WHERE product_id=$1 AND serial=$2",
        [c.product, "S-A"],
      )
    ).warehouse_id,
    c.wh,
  );
});
test("transfer conserves quantity and value; received-again customer stock uses original outbound cost", async () => {
  const c = await basics();
  await post(await document("receipt", [line(c, "10", "100")]));
  const out = await document("dispatch", [line(c, "2")]);
  await post(out);
  const ol = await one(
    pg,
    "SELECT * FROM document_lines WHERE document_id=$1",
    [out.id],
  );
  await run("handover.create", {
    line_id: ol.id,
    qty: "2",
    recipient: "Khách",
  });
  await post(await document("receipt", [line(c, "10", "200")]));
  const ret = await document("return_customer", [
    line(c, "2", "0", { source_line_id: ol.id }),
  ]);
  await post(ret);
  assert.equal(
    (
      await one(
        pg,
        "SELECT cost_value FROM document_lines WHERE document_id=$1",
        [ret.id],
      )
    ).cost_value,
    "200.000000",
  );
  const wh = (
    await run("warehouse.create", {
      code: "DEST" + ++counter,
      name: "Kho nhận",
      kind: "owned",
    })
  ).id;
  const before = await one(
    pg,
    "SELECT qty,value FROM valuations WHERE product_id=$1",
    [c.product],
  );
  await post(
    await document("transfer", [line(c, "3", "0", { to_warehouse_id: wh })]),
  );
  assert.deepEqual(
    await one(pg, "SELECT qty,value FROM valuations WHERE product_id=$1", [
      c.product,
    ]),
    before,
  );
});
test("server enforces roles, project scope and financial field redaction", async () => {
  const c = await basics();
  await assert.rejects(
    () => run("document.create", {}, project),
    /không có quyền/,
  );
  await assert.rejects(
    () => run("user.create", {}, warehouse),
    /không có quyền/,
  );
  const own = await readState(project, db);
  assert(own.projects.some((p) => p.id === c.pj));
  assert(own.lines.every((l) => !("cost_value" in l) && !("price" in l)));
  assert.equal(own.valuations.length, 0);
  assert.equal(own.audit.length, 0);
  const foreign = (
    await run("project.create", { code: "OTHER" + ++counter, name: "Other" })
  ).id;
  await assert.rejects(
    () =>
      run(
        "package.create",
        { code: "NOPE", name: "Nope", project_id: foreign },
        project,
      ),
    /ngoài phạm vi/,
  );
  assert(
    !(await readState(project, db)).projects.some((p) => p.id === foreign),
  );
  const doc = await document("receipt", [line(c, "1")], manager);
  await run("document.submit", { id: doc.id, version: 1 }, manager);
  await assert.rejects(
    () => run("document.post", { id: doc.id, version: 2 }, manager),
    /không tự duyệt/,
  );
});
test("plan revision protects committed quantities and version", async () => {
  const c = await basics();
  await post(await document("receipt", [line(c, "8")]));
  await run("reservation.create", {
    project_item_id: c.item,
    warehouse_id: c.wh,
    qty: "8",
  });
  await assert.rejects(
    () =>
      run("item.revise", {
        id: c.item,
        plan_qty: "5",
        reason: "Test",
        version: 1,
      }),
    /thấp hơn/,
  );
  await run("item.revise", {
    id: c.item,
    plan_qty: "9",
    reason: "Phụ lục",
    version: 1,
  });
  await assert.rejects(
    () =>
      run("item.revise", {
        id: c.item,
        plan_qty: "10",
        reason: "Phụ lục",
        version: 1,
      }),
    /đã thay đổi/,
  );
});
test("authentication, persistent failed-attempt limit, cookie session, and no password in audit", async () => {
  await assert.rejects(
    () => login({ username: "admin", password: "wrong" }, db),
    /không đúng/,
  );
  const r = await login(
    { username: "admin", password: "strong-test-password" },
    db,
  );
  assert.equal(
    (
      await sessionUser(
        pg,
        new Request("http://localhost", {
          headers: { cookie: "hpt_session=" + r.token },
        }),
      )
    ).id,
    admin.id,
  );
  await assert.rejects(
    () => sessionUser(pg, new Request("http://localhost")),
    /đăng nhập/,
  );
  for (let i = 0; i < 8; i++)
    await assert.rejects(
      () => login({ username: "absent", password: "wrong" }, db),
      /không đúng/,
    );
  await assert.rejects(
    () => login({ username: "absent", password: "wrong" }, db),
    (e) => e.status === 429,
  );
  await run("user.create", {
    username: "new-user",
    name: "New",
    role: "viewer",
    password: "another-strong-pass",
  });
  const a = await one(
    pg,
    "SELECT details FROM audit_logs WHERE action='user.create' ORDER BY created_at DESC LIMIT 1",
  );
  assert(!("password" in a.details));
});
test("validation rejects invalid dates and nonfinite/fractional excess; CSV exports 502 rows and escapes formulas", () => {
  assert.throws(() => date("2026-02-30"));
  assert.throws(() => number("Infinity"));
  assert.throws(() => number("0.0001"));
  assert.throws(() => number("-1"));
  const report = csv(
    Array.from({ length: 502 }, (_, i) => ({
      name: i === 0 ? "=1+1" : "Item " + i,
    })),
    [["name", "Tên"]],
  );
  assert.equal(report.split("\r\n").length, 503);
  assert(report.includes("'=1+1"));
  process.env.APP_ORIGIN = "http://localhost:3000";
  assert.throws(() =>
    originCheck(
      new Request("http://localhost:3000/api", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  );
  originCheck(
    new Request("http://localhost:3000/api", {
      headers: { origin: "http://localhost:3000" },
    }),
  );
});
test("stock count locks postings, applies the difference once, and reopens warehouse", async () => {
  const c = await basics();
  await post(await document("receipt", [line(c, "10")]));
  const count = await run("count.create", {
    warehouse_id: c.wh,
    product_ids: [c.product],
  });
  const blocked = await document("dispatch", [line(c, "1")]);
  await run("document.submit", { id: blocked.id, version: 1 });
  await assert.rejects(
    () => run("document.post", { id: blocked.id, version: 2 }),
    /kiểm kê/,
  );
  const cl = await one(pg, "SELECT * FROM count_lines WHERE count_id=$1", [
    count.id,
  ]);
  const payload = {
    id: count.id,
    lines: [{ id: cl.id, counted_qty: "8", price: "100" }],
  };
  await run("count.post", payload);
  await assert.rejects(() => run("count.post", payload), /đã đóng/);
  assert.equal(
    (await one(pg, "SELECT qty FROM balances WHERE product_id=$1", [c.product]))
      .qty,
    "8.000",
  );
  assert.equal((await get("stock_counts", count.id)).status, "posted");
  const state = await readState(admin, db);
  assert(state.report.length > 0);
  assert(state.counts.some((r) => r.id === count.id));
});
test("HTTP routes reject unauthenticated and cross-origin mutations and serve authenticated state", async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.APP_ORIGIN = "http://localhost:3000";
  const client = { query: (...args) => pg.query(...args) };
  globalThis.hptPool = { ...db, ...client };
  const { GET } = await import("../app/api/state/route.js");
  const { POST } = await import("../app/api/commands/route.js");
  assert.equal(
    (await GET(new Request("http://localhost:3000/api/state"))).status,
    401,
  );
  const token = (
    await login({ username: "admin", password: "strong-test-password" }, db)
  ).token;
  const req = new Request("http://localhost:3000/api/state", {
    headers: { cookie: "hpt_session=" + token },
  });
  // Route pool adapter must ignore advisory locks like the single-connection business adapter.
  const response = await GET(req);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, "admin");
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/commands", {
          method: "POST",
          headers: {
            origin: "https://elsewhere.example",
            "content-type": "application/json",
            cookie: "hpt_session=" + token,
          },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  delete globalThis.hptPool;
});
test("closed period prevents posting and ledger audit are append-only", async () => {
  const c = await basics();
  const d = await document("receipt", [line(c, "1")]);
  await run("document.submit", { id: d.id, version: 1 });
  await run("period.close", { date: "2026-09-01" });
  await assert.rejects(
    () => run("document.post", { id: d.id, version: 2 }),
    /Kỳ đã khóa/,
  );
  await assert.rejects(() => pg.query("DELETE FROM audit_logs"), /Append-only/);
});
