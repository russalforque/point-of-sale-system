/** One SQLite database represents one shop; retail and laundry keep separate catalogs. */
export const QUALIFIED_LAUNDRY_VISITS = `SELECT COUNT(*) AS visits FROM laundry_orders v JOIN laundry_configuration c ON c.id=1
 WHERE v.customer_id=? AND (v.status='Completed' OR (c.visit_status='Ready for Pickup' AND v.status='Ready for Pickup'))
 AND (c.visit_require_paid=0 OR COALESCE((SELECT SUM(p.amount_cents) FROM laundry_payments p WHERE p.order_id=v.id),0)=v.total_cents)
 AND (CASE c.visit_basis WHEN 'total' THEN v.total_cents ELSE v.subtotal_cents END)>=c.visit_minimum_cents`

export const LAUNDRY_PRICING_SCHEMA = `
CREATE TABLE IF NOT EXISTS laundry_configuration (
 id INTEGER PRIMARY KEY CHECK(id=1), defaults_version INTEGER NOT NULL DEFAULT 0,
 allow_stacking INTEGER NOT NULL DEFAULT 0 CHECK(allow_stacking IN (0,1)),
 visit_status TEXT NOT NULL DEFAULT 'Completed' CHECK(visit_status IN ('Completed','Ready for Pickup')),
 visit_require_paid INTEGER NOT NULL DEFAULT 1 CHECK(visit_require_paid IN (0,1)),
 visit_minimum_cents INTEGER NOT NULL DEFAULT 1 CHECK(visit_minimum_cents BETWEEN 0 AND 100000000),
 visit_basis TEXT NOT NULL DEFAULT 'subtotal' CHECK(visit_basis IN ('subtotal','total')),
 revision INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO laundry_configuration(id) VALUES(1);
CREATE TABLE IF NOT EXISTS laundry_discounts (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')), value INTEGER NOT NULL CHECK(typeof(value)='integer' AND value>=0 AND value<=CASE kind WHEN 'percent' THEN 10000 ELSE 100000000 END),
 scope TEXT NOT NULL DEFAULT 'order' CHECK(scope IN ('order','services','addons','categories')),
 categories_json TEXT NOT NULL DEFAULT '[]', visit_number INTEGER NOT NULL DEFAULT 0 CHECK(visit_number BETWEEN 0 AND 1000000),
 repeat_every INTEGER NOT NULL DEFAULT 0 CHECK(repeat_every BETWEEN 0 AND 1000000), weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
 stackable INTEGER NOT NULL DEFAULT 1 CHECK(stackable IN (0,1)), is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, eligibility_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS laundry_order_discounts (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES laundry_orders(id), discount_id INTEGER REFERENCES laundry_discounts(id),
 name TEXT NOT NULL, kind TEXT NOT NULL, value INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>=0),
 visit_number INTEGER, rule_json TEXT NOT NULL, configuration_revision INTEGER NOT NULL, discount_revision INTEGER,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laundry_order_discounts_order ON laundry_order_discounts(order_id);
CREATE TRIGGER IF NOT EXISTS laundry_service_price_guard BEFORE INSERT ON laundry_order_items WHEN (SELECT discounts_version FROM laundry_orders WHERE id=NEW.order_id)=1 AND NOT EXISTS(SELECT 1 FROM laundry_services WHERE id=NEW.service_id AND is_active=1 AND removed_at IS NULL AND name=NEW.name AND pricing=NEW.pricing AND price_cents=NEW.price_cents AND category=NEW.category) BEGIN SELECT RAISE(ABORT,'Service prices changed. Return to Review and refresh prices.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_addon_price_guard BEFORE INSERT ON laundry_order_addons WHEN (SELECT discounts_version FROM laundry_orders WHERE id=NEW.order_id)=1 AND NOT EXISTS(SELECT 1 FROM laundry_addons WHERE id=NEW.addon_id AND is_active=1 AND removed_at IS NULL AND name=NEW.name AND pricing=NEW.pricing AND price_cents=NEW.price_cents AND category=NEW.category) BEGIN SELECT RAISE(ABORT,'Add-on prices changed. Return to Review and refresh prices.'); END;
CREATE TABLE IF NOT EXISTS laundry_line_discounts (
 order_id INTEGER NOT NULL REFERENCES laundry_orders(id), kind INTEGER NOT NULL CHECK(kind IN (0,1)), catalog_id INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>=0), PRIMARY KEY(order_id,kind,catalog_id)
);
CREATE TABLE IF NOT EXISTS laundry_visit_redemptions (
 customer_id INTEGER NOT NULL REFERENCES customers(id), discount_id INTEGER NOT NULL REFERENCES laundry_discounts(id),
 visit_number INTEGER NOT NULL, order_id INTEGER NOT NULL REFERENCES laundry_orders(id),
 PRIMARY KEY(customer_id,discount_id,visit_number), UNIQUE(order_id,discount_id)
);
CREATE TRIGGER IF NOT EXISTS laundry_discount_snapshot_guard BEFORE INSERT ON laundry_order_discounts WHEN NEW.discount_id IS NOT NULL BEGIN SELECT CASE WHEN NEW.configuration_revision!=(SELECT revision FROM laundry_configuration WHERE id=1) OR NOT EXISTS(SELECT 1 FROM laundry_discounts WHERE id=NEW.discount_id AND revision=NEW.discount_revision AND is_active=1 AND removed=0) THEN RAISE(ABORT,'Discount rules changed. Refresh the order before saving.') WHEN NEW.visit_number IS NOT NULL AND NEW.visit_number!=1+(${QUALIFIED_LAUNDRY_VISITS.replace('v.customer_id=?', 'v.customer_id=(SELECT customer_id FROM laundry_orders WHERE id=NEW.order_id)')}) THEN RAISE(ABORT,'Customer visits changed. Refresh discounts before saving.') END; END;
CREATE TRIGGER IF NOT EXISTS laundry_visit_reservation_guard BEFORE INSERT ON laundry_visit_redemptions WHEN EXISTS(SELECT 1 FROM laundry_visit_redemptions WHERE customer_id=NEW.customer_id AND visit_number=NEW.visit_number AND order_id!=NEW.order_id) BEGIN SELECT RAISE(ABORT,'This visit reward is reserved or already used. Refresh discounts.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_visit_no_update BEFORE UPDATE ON laundry_visit_redemptions BEGIN SELECT RAISE(ABORT,'Visit redemptions cannot be edited.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_visit_delete_guard BEFORE DELETE ON laundry_visit_redemptions WHEN (SELECT status FROM laundry_orders WHERE id=OLD.order_id)!='Cancelled' BEGIN SELECT RAISE(ABORT,'Only cancelled orders release visit rewards.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_visit_release AFTER UPDATE OF status ON laundry_orders WHEN NEW.status='Cancelled' BEGIN DELETE FROM laundry_visit_redemptions WHERE order_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS laundry_discount_no_update BEFORE UPDATE ON laundry_order_discounts BEGIN SELECT RAISE(ABORT,'Applied discounts are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_discount_no_delete BEFORE DELETE ON laundry_order_discounts BEGIN SELECT RAISE(ABORT,'Applied discounts cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_line_discount_no_update BEFORE UPDATE ON laundry_line_discounts BEGIN SELECT RAISE(ABORT,'Applied discounts are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_line_discount_no_delete BEFORE DELETE ON laundry_line_discounts BEGIN SELECT RAISE(ABORT,'Applied discounts cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_pricing_version_guard BEFORE UPDATE OF discounts_version ON laundry_orders WHEN NEW.discounts_version!=OLD.discounts_version BEGIN SELECT RAISE(ABORT,'Posted pricing is immutable.'); END;
INSERT OR IGNORE INTO sellix_schema(version,applied_at) VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`
