import { rows, one, transaction } from "./db.js";
import { progress } from "./service.js";
import { D, FINANCE } from "./validation.js";
export async function readState(actor, database) {
  return transaction(async (db) => {
    const scoped = actor.role === "project",
      financial = FINANCE.includes(actor.role);
    const projects = await rows(
      db,
      `SELECT * FROM projects ${scoped ? "WHERE owner_id=$1" : ""} ORDER BY created_at DESC`,
      scoped ? [actor.id] : [],
    );
    const projectIds = new Set(projects.map((p) => p.id));
    const packages = (
      await rows(db, "SELECT * FROM packages ORDER BY code")
    ).filter((p) => projectIds.has(p.project_id));
    const packageIds = new Set(packages.map((p) => p.id));
    const items = (
      await rows(db, "SELECT * FROM project_items ORDER BY name")
    ).filter((i) => packageIds.has(i.package_id));
    const itemIds = new Set(items.map((i) => i.id));
    const plan = [];
    for (const i of items) plan.push(await progress(db, i.id));
    const reservations = (
      await rows(
        db,
        "SELECT * FROM reservations WHERE remaining>0 ORDER BY created_at DESC",
      )
    ).filter((r) => !scoped || itemIds.has(r.project_item_id));
    const lines = (
      await rows(db, "SELECT * FROM document_lines ORDER BY id")
    ).filter((l) => !scoped || itemIds.has(l.project_item_id));
    const docIds = new Set(lines.map((l) => l.document_id));
    const documents = (
      await rows(db, "SELECT * FROM documents ORDER BY created_at DESC")
    ).filter((d) => !scoped || docIds.has(d.id));
    const stocks = await rows(
      db,
      `SELECT b.*,p.code,p.name,p.unit,w.name warehouse_name,
   COALESCE((SELECT SUM(r.remaining) FROM reservations r WHERE r.product_id=b.product_id AND r.warehouse_id=b.warehouse_id),0) reserved
   FROM balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id ORDER BY p.code,w.code`,
    );
    stocks.forEach(
      (s) => (s.available = D(s.qty).minus(s.reserved).toFixed(3)),
    );
    const valuations = financial
      ? await rows(
          db,
          `SELECT v.*,p.code,p.name,p.unit,CASE WHEN v.qty>0 THEN v.value/v.qty ELSE 0 END average_cost FROM valuations v JOIN products p ON p.id=v.product_id ORDER BY p.code`,
        )
      : [];
    const po = scoped
      ? []
      : await rows(
          db,
          "SELECT * FROM purchase_orders ORDER BY created_at DESC",
        );
    const purchaseLines = scoped
      ? []
      : await rows(db, "SELECT * FROM purchase_lines ORDER BY id");
    const handovers = (
      await rows(db, "SELECT * FROM handovers ORDER BY created_at DESC")
    ).filter((h) => lines.some((l) => l.id === h.line_id));
    if (!financial) {
      for (const l of lines) {
        delete l.price;
        delete l.cost_value;
      }
      for (const l of purchaseLines) delete l.price;
    }
    const report = financial
      ? await rows(
          db,
          `SELECT i.id,i.name,i.sale_price,COALESCE(SUM(l.handed_qty-l.returned_qty),0) handed,
    COALESCE(SUM((l.handed_qty-l.returned_qty)*i.sale_price),0) revenue,
    COALESCE(SUM((l.handed_qty-l.returned_qty)*l.cost_value/l.qty),0) cost
    FROM project_items i LEFT JOIN (document_lines l JOIN documents d ON d.id=l.document_id AND d.status='posted' AND d.type='dispatch') ON l.project_item_id=i.id
    GROUP BY i.id ORDER BY i.name`,
        )
      : [];
    report.forEach((r) => (r.profit = D(r.revenue).minus(r.cost).toFixed(2)));
    const audit = financial
      ? await rows(
          db,
          `SELECT a.*,u.name actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100`,
        )
      : [];
    const movements = await rows(
      db,
      `SELECT m.*,d.code document_code,d.type,d.business_date FROM movements m JOIN document_lines l ON l.id=m.line_id JOIN documents d ON d.id=l.document_id ORDER BY m.created_at DESC`,
    );
    if (!financial) movements.forEach((m) => delete m.value);
    const counts = scoped
      ? []
      : await rows(db, "SELECT * FROM stock_counts ORDER BY created_at DESC");
    const countLines = scoped
      ? []
      : await rows(db, "SELECT * FROM count_lines ORDER BY id");
    return {
      user: actor,
      products: await rows(db, "SELECT * FROM products ORDER BY code"),
      groups: await rows(db, "SELECT * FROM product_groups ORDER BY code"),
      warehouses: await rows(db, "SELECT * FROM warehouses ORDER BY code"),
      partners: await rows(db, "SELECT * FROM partners ORDER BY name"),
      users:
        actor.role === "admin"
          ? await rows(
              db,
              "SELECT id,username,name,role,active FROM users ORDER BY name",
            )
          : [],
      projects,
      packages,
      items: plan,
      reservations,
      documents,
      lines,
      stocks,
      valuations,
      purchases: po,
      purchaseLines,
      handovers,
      report,
      audit,
      counts,
      countLines,
      movements: scoped
        ? movements.filter((m) => lines.some((l) => l.id === m.line_id))
        : movements,
      serials: scoped
        ? []
        : await rows(db, "SELECT * FROM serials ORDER BY serial"),
      settings: await one(db, "SELECT * FROM settings WHERE id=1"),
    };
  }, database);
}
export function csv(data, columns) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      columns.map((c) => cell(c[1])).join(","),
      ...data.map((r) => columns.map((c) => cell(r[c[0]])).join(",")),
    ].join("\r\n")
  );
}
