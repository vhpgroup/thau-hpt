CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','manager','warehouse','project','viewer')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE login_attempts (username text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, reset_at timestamptz NOT NULL);
CREATE TABLE settings (id integer PRIMARY KEY CHECK(id=1), closed_through date);
INSERT INTO settings(id) VALUES(1);
CREATE TABLE products (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, unit text NOT NULL, model text NOT NULL DEFAULT '', maker text NOT NULL DEFAULT '', serial_tracked boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true);
CREATE TABLE warehouses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL DEFAULT 'owned' CHECK(kind IN ('owned','quarantine')), active boolean NOT NULL DEFAULT true);
CREATE TABLE partners (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('customer','supplier','both')));
CREATE TABLE projects (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, customer_id uuid REFERENCES partners(id), owner_id uuid NOT NULL REFERENCES users(id), deadline date, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE packages (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), code text NOT NULL UNIQUE, name text NOT NULL, deadline date);
CREATE TABLE project_items (id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES packages(id), product_id uuid NOT NULL REFERENCES products(id), name text NOT NULL, plan_qty numeric(18,3) NOT NULL CHECK(plan_qty>0), sale_price numeric(24,6) NOT NULL CHECK(sale_price>=0), version integer NOT NULL DEFAULT 1);
CREATE TABLE purchase_orders (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, supplier_id uuid NOT NULL REFERENCES partners(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','closed','cancelled')), created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id), expected_date date, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE purchase_lines (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES purchase_orders(id), product_id uuid NOT NULL REFERENCES products(id), project_item_id uuid REFERENCES project_items(id), qty numeric(18,3) NOT NULL CHECK(qty>0), price numeric(24,6) NOT NULL CHECK(price>=0), received_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK(received_qty>=0 AND received_qty<=qty));
CREATE TABLE reservations (id uuid PRIMARY KEY, project_item_id uuid NOT NULL REFERENCES project_items(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), product_id uuid NOT NULL REFERENCES products(id), remaining numeric(18,3) NOT NULL CHECK(remaining>=0), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE documents (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, type text NOT NULL CHECK(type IN ('receipt','dispatch','transfer','return_customer','return_supplier','adjust_up','adjust_down')), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','posted','cancelled')), business_date date NOT NULL, note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id), posted_by uuid REFERENCES users(id), posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1);
CREATE TABLE document_lines (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id), product_id uuid NOT NULL REFERENCES products(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), to_warehouse_id uuid REFERENCES warehouses(id), project_item_id uuid REFERENCES project_items(id), purchase_line_id uuid REFERENCES purchase_lines(id), source_line_id uuid REFERENCES document_lines(id), qty numeric(18,3) NOT NULL CHECK(qty>0), price numeric(24,6) NOT NULL CHECK(price>=0), cost_value numeric(30,6), handed_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK(handed_qty>=0 AND handed_qty<=qty), returned_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK(returned_qty>=0 AND returned_qty<=qty), serials jsonb NOT NULL DEFAULT '[]', CHECK(to_warehouse_id IS NULL OR to_warehouse_id<>warehouse_id));
CREATE TABLE balances (warehouse_id uuid REFERENCES warehouses(id), product_id uuid REFERENCES products(id), qty numeric(18,3) NOT NULL DEFAULT 0 CHECK(qty>=0), PRIMARY KEY(warehouse_id,product_id));
CREATE TABLE valuations (product_id uuid PRIMARY KEY REFERENCES products(id), qty numeric(18,3) NOT NULL DEFAULT 0 CHECK(qty>=0), value numeric(30,6) NOT NULL DEFAULT 0 CHECK(value>=0), last_date date);
CREATE TABLE movements (id uuid PRIMARY KEY, line_id uuid NOT NULL REFERENCES document_lines(id), product_id uuid NOT NULL REFERENCES products(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), qty numeric(18,3) NOT NULL, value numeric(30,6) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(line_id,warehouse_id));
CREATE TABLE serials (product_id uuid REFERENCES products(id), serial text NOT NULL, warehouse_id uuid REFERENCES warehouses(id), last_line_id uuid NOT NULL REFERENCES document_lines(id), PRIMARY KEY(product_id,serial));
CREATE TABLE handovers (id uuid PRIMARY KEY, line_id uuid NOT NULL REFERENCES document_lines(id), qty numeric(18,3) NOT NULL CHECK(qty>0), recipient text NOT NULL, serials jsonb NOT NULL DEFAULT '[]', created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stock_counts (id uuid PRIMARY KEY, warehouse_id uuid NOT NULL REFERENCES warehouses(id), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','posted','cancelled')), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
CREATE UNIQUE INDEX one_open_count ON stock_counts(warehouse_id) WHERE status='open';
CREATE TABLE count_lines (id uuid PRIMARY KEY, count_id uuid NOT NULL REFERENCES stock_counts(id), product_id uuid NOT NULL REFERENCES products(id), system_qty numeric(18,3) NOT NULL, counted_qty numeric(18,3), serials jsonb NOT NULL DEFAULT '[]', counted_serials jsonb, UNIQUE(count_id,product_id));
CREATE TABLE audit_logs (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency (actor_id uuid REFERENCES users(id), key text NOT NULL, hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,key));
CREATE INDEX movements_stock_idx ON movements(product_id,warehouse_id);
CREATE INDEX documents_status_idx ON documents(status,business_date);
CREATE INDEX lines_document_idx ON document_lines(document_id);
CREATE INDEX lines_item_idx ON document_lines(project_item_id);
CREATE INDEX projects_owner_idx ON projects(owner_id);
CREATE INDEX reservations_item_idx ON reservations(project_item_id);
CREATE INDEX reservations_stock_idx ON reservations(product_id,warehouse_id);
CREATE INDEX purchase_lines_item_idx ON purchase_lines(project_item_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only ledger'; END $$;
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION protect_posted_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM documents WHERE id=OLD.document_id AND status='posted') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted line is immutable'; END IF;
  IF (to_jsonb(NEW)-'handed_qty'-'returned_qty') IS DISTINCT FROM (to_jsonb(OLD)-'handed_qty'-'returned_qty') THEN RAISE EXCEPTION 'Posted line is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_line BEFORE UPDATE OR DELETE ON document_lines FOR EACH ROW EXECUTE FUNCTION protect_posted_line();
CREATE FUNCTION protect_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='posted' THEN RAISE EXCEPTION 'Posted document is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_document BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION protect_posted_document();
