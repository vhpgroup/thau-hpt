CREATE TABLE product_groups(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL);
ALTER TABLE products ADD COLUMN group_id uuid REFERENCES product_groups(id);
ALTER TABLE products ADD COLUMN barcode text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN min_stock numeric(18,3) NOT NULL DEFAULT 0 CHECK(min_stock>=0);
ALTER TABLE products ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE partners ADD COLUMN tax_code text NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','manager','warehouse','project','viewer','accountant'));
CREATE TABLE debt_documents (
 id uuid PRIMARY KEY,code text NOT NULL UNIQUE,side text NOT NULL CHECK(side IN ('ar','ap')),
 kind text NOT NULL DEFAULT 'charge' CHECK(kind IN ('charge','credit')),
 partner_id uuid NOT NULL REFERENCES partners(id),project_id uuid REFERENCES projects(id),package_id uuid REFERENCES packages(id),purchase_order_id uuid REFERENCES purchase_orders(id),
 source_document_id uuid REFERENCES documents(id),source_debt_id uuid REFERENCES debt_documents(id),
 reference text NOT NULL DEFAULT '',note text NOT NULL DEFAULT '',business_date date NOT NULL,due_date date NOT NULL,
 amount numeric(24,2) NOT NULL CHECK(amount>0),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','posted','cancelled')),
 created_by uuid NOT NULL REFERENCES users(id),posted_by uuid REFERENCES users(id),posted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 CHECK((kind='credit')=(source_debt_id IS NOT NULL)),CHECK(due_date>=business_date)
);
CREATE UNIQUE INDEX debt_reference_unique ON debt_documents(side,partner_id,lower(reference)) WHERE kind='charge' AND reference<>'' AND status<>'cancelled';
CREATE TABLE cash_payments (
 id uuid PRIMARY KEY,code text NOT NULL UNIQUE,side text NOT NULL CHECK(side IN ('ar','ap')),partner_id uuid NOT NULL REFERENCES partners(id),
 business_date date NOT NULL,amount numeric(24,2) NOT NULL CHECK(amount>0),method text NOT NULL CHECK(method IN ('bank','cash')),reference text NOT NULL DEFAULT '',note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','posted','cancelled','void')),
 created_by uuid NOT NULL REFERENCES users(id),posted_by uuid REFERENCES users(id),posted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 void_date date,void_reason text,voided_by uuid REFERENCES users(id)
);
CREATE TABLE settlements (
 id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES cash_payments(id),debt_id uuid NOT NULL REFERENCES debt_documents(id),amount numeric(24,2) NOT NULL CHECK(amount<>0),
 business_date date NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reverses_id uuid UNIQUE REFERENCES settlements(id),
 CHECK((amount<0)=(reverses_id IS NOT NULL))
);
CREATE INDEX debts_partner_date ON debt_documents(partner_id,side,business_date);
CREATE INDEX cash_partner_date ON cash_payments(partner_id,side,business_date);
CREATE INDEX settlements_debt ON settlements(debt_id,business_date);
CREATE INDEX settlements_payment ON settlements(payment_id,business_date);
CREATE TRIGGER immutable_settlements BEFORE UPDATE OR DELETE ON settlements FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION protect_finance_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='posted' THEN RAISE EXCEPTION 'Posted finance document is immutable'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Finance documents cannot be deleted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_debt BEFORE UPDATE OR DELETE ON debt_documents FOR EACH ROW EXECUTE FUNCTION protect_finance_document();
CREATE FUNCTION protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payments cannot be deleted'; END IF;
 IF OLD.status='void' THEN RAISE EXCEPTION 'Voided payment is immutable'; END IF;
 IF OLD.status='posted' AND (NEW.status<>'void' OR (to_jsonb(NEW)-'status'-'void_date'-'void_reason'-'voided_by'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'void_date'-'void_reason'-'voided_by'-'version')) THEN RAISE EXCEPTION 'Posted payment is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_cash BEFORE UPDATE OR DELETE ON cash_payments FOR EACH ROW EXECUTE FUNCTION protect_payment();
