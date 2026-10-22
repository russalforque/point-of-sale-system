/** Additive v7 schema. Kept as one script for native execute() and real SQLite tests. */
export const LAUNDRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS laundry_services (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 pricing TEXT NOT NULL CHECK(pricing IN ('kg','load','piece','fixed')),
 price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents >= 0),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);
CREATE TABLE IF NOT EXISTS laundry_addons (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 pricing TEXT NOT NULL CHECK(pricing IN ('quantity','fixed')),
 price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents >= 0),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);
CREATE TABLE IF NOT EXISTS laundry_orders (
 id INTEGER PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 customer_id INTEGER NOT NULL REFERENCES customers(id), customer_name TEXT NOT NULL, customer_phone TEXT,
 status TEXT NOT NULL DEFAULT 'Received' CHECK(status IN ('Received','Washing','Drying','For Folding','Ready for Pickup','Completed','Cancelled')),
 subtotal_cents INTEGER NOT NULL CHECK(typeof(subtotal_cents) = 'integer' AND subtotal_cents >= 0),
 discount_cents INTEGER NOT NULL CHECK(typeof(discount_cents) = 'integer' AND discount_cents BETWEEN 0 AND subtotal_cents),
 total_cents INTEGER NOT NULL CHECK(typeof(total_cents) = 'integer' AND total_cents = subtotal_cents - discount_cents),
 pickup_at TEXT, notes TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES laundry_orders(id),
 service_id INTEGER NOT NULL REFERENCES laundry_services(id), name TEXT NOT NULL,
 pricing TEXT NOT NULL CHECK(pricing IN ('kg','load','piece','fixed')),
 quantity_milli INTEGER NOT NULL CHECK(typeof(quantity_milli) = 'integer' AND quantity_milli > 0 AND (pricing = 'kg' OR quantity_milli % 1000 = 0) AND (pricing != 'fixed' OR quantity_milli = 1000)),
 price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents >= 0),
 total_cents INTEGER NOT NULL CHECK(total_cents = CAST((price_cents * quantity_milli + 500) / 1000 AS INTEGER))
);
CREATE TABLE IF NOT EXISTS laundry_order_addons (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES laundry_orders(id),
 addon_id INTEGER NOT NULL REFERENCES laundry_addons(id), name TEXT NOT NULL,
 pricing TEXT NOT NULL CHECK(pricing IN ('quantity','fixed')),
 quantity_milli INTEGER NOT NULL CHECK(typeof(quantity_milli) = 'integer' AND quantity_milli > 0 AND quantity_milli % 1000 = 0 AND (pricing != 'fixed' OR quantity_milli = 1000)),
 price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents >= 0),
 total_cents INTEGER NOT NULL CHECK(total_cents = CAST((price_cents * quantity_milli + 500) / 1000 AS INTEGER))
);
CREATE TABLE IF NOT EXISTS laundry_payments (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES laundry_orders(id), request_key TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('Cash','GCash','Maya')),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
 tendered_cents INTEGER NOT NULL CHECK(typeof(tendered_cents) = 'integer' AND tendered_cents >= amount_cents AND (method = 'Cash' OR tendered_cents = amount_cents)),
 reference TEXT, shift_id INTEGER NOT NULL REFERENCES shifts(id),
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS laundry_status_history (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES laundry_orders(id),
 status TEXT NOT NULL, reason TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laundry_orders_customer ON laundry_orders(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_laundry_orders_date ON laundry_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_laundry_orders_status ON laundry_orders(status,created_at);
CREATE INDEX IF NOT EXISTS idx_laundry_items_order ON laundry_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_laundry_addons_order ON laundry_order_addons(order_id);
CREATE INDEX IF NOT EXISTS idx_laundry_payments_order ON laundry_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_laundry_payments_date ON laundry_payments(created_at,method);
CREATE INDEX IF NOT EXISTS idx_laundry_payments_shift ON laundry_payments(shift_id);
CREATE INDEX IF NOT EXISTS idx_laundry_history_order ON laundry_status_history(order_id,id);
CREATE TRIGGER IF NOT EXISTS laundry_order_mode_guard BEFORE INSERT ON laundry_orders WHEN NOT EXISTS(SELECT 1 FROM store_settings WHERE id=1 AND business_type='laundry' AND business_setup_complete=1) BEGIN SELECT RAISE(ABORT,'Select Laundry in business settings first.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_payment_guard BEFORE INSERT ON laundry_payments BEGIN SELECT CASE WHEN (SELECT status FROM laundry_orders WHERE id = NEW.order_id) = 'Cancelled' THEN RAISE(ABORT,'Cannot pay a cancelled order.') WHEN NEW.amount_cents + COALESCE((SELECT SUM(amount_cents) FROM laundry_payments WHERE order_id = NEW.order_id),0) > (SELECT total_cents FROM laundry_orders WHERE id = NEW.order_id) THEN RAISE(ABORT,'Payment exceeds remaining balance.') WHEN NOT EXISTS(SELECT 1 FROM shifts WHERE id = NEW.shift_id AND employee_id = NEW.created_by AND status = 0) THEN RAISE(ABORT,'Open your shift before collecting payment.') END; END;
CREATE TRIGGER IF NOT EXISTS laundry_order_no_delete BEFORE DELETE ON laundry_orders BEGIN SELECT RAISE(ABORT,'Laundry orders cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_order_snapshot BEFORE UPDATE ON laundry_orders WHEN NEW.order_number IS NOT OLD.order_number OR NEW.request_key IS NOT OLD.request_key OR NEW.customer_id IS NOT OLD.customer_id OR NEW.customer_name IS NOT OLD.customer_name OR NEW.customer_phone IS NOT OLD.customer_phone OR NEW.subtotal_cents IS NOT OLD.subtotal_cents OR NEW.discount_cents IS NOT OLD.discount_cents OR NEW.total_cents IS NOT OLD.total_cents OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.pickup_at IS NOT OLD.pickup_at OR NEW.notes IS NOT OLD.notes BEGIN SELECT RAISE(ABORT,'Posted order details are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_status_guard BEFORE UPDATE OF status ON laundry_orders WHEN NEW.status != OLD.status BEGIN SELECT CASE WHEN OLD.status IN ('Completed','Cancelled') THEN RAISE(ABORT,'This order is already closed.') WHEN NEW.status = 'Received' THEN RAISE(ABORT,'Cannot return an order to Received.') WHEN NEW.status = 'Cancelled' AND COALESCE((SELECT SUM(amount_cents) FROM laundry_payments WHERE order_id = OLD.id),0) > 0 THEN RAISE(ABORT,'Paid orders need a refund before cancellation.') WHEN NEW.status = 'Completed' AND (OLD.status != 'Ready for Pickup' OR COALESCE((SELECT SUM(amount_cents) FROM laundry_payments WHERE order_id = OLD.id),0) != OLD.total_cents) THEN RAISE(ABORT,'Mark ready and collect the balance before completing.') WHEN NEW.status != 'Cancelled' AND ((CASE NEW.status WHEN 'Received' THEN 0 WHEN 'Washing' THEN 1 WHEN 'Drying' THEN 2 WHEN 'For Folding' THEN 3 WHEN 'Ready for Pickup' THEN 4 WHEN 'Completed' THEN 5 END) <= (CASE OLD.status WHEN 'Received' THEN 0 WHEN 'Washing' THEN 1 WHEN 'Drying' THEN 2 WHEN 'For Folding' THEN 3 WHEN 'Ready for Pickup' THEN 4 WHEN 'Completed' THEN 5 END)) THEN RAISE(ABORT,'Status must move forward.') END; END;
CREATE TRIGGER IF NOT EXISTS laundry_payment_no_update BEFORE UPDATE ON laundry_payments BEGIN SELECT RAISE(ABORT,'Payments are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_payment_no_delete BEFORE DELETE ON laundry_payments BEGIN SELECT RAISE(ABORT,'Payments cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_item_no_update BEFORE UPDATE ON laundry_order_items BEGIN SELECT RAISE(ABORT,'Posted items are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_item_no_delete BEFORE DELETE ON laundry_order_items BEGIN SELECT RAISE(ABORT,'Posted items cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_addon_no_update BEFORE UPDATE ON laundry_order_addons BEGIN SELECT RAISE(ABORT,'Posted addons are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_addon_no_delete BEFORE DELETE ON laundry_order_addons BEGIN SELECT RAISE(ABORT,'Posted addons cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_history_no_update BEFORE UPDATE ON laundry_status_history BEGIN SELECT RAISE(ABORT,'Status history is immutable.'); END;
CREATE TRIGGER IF NOT EXISTS laundry_history_no_delete BEFORE DELETE ON laundry_status_history BEGIN SELECT RAISE(ABORT,'Status history cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS business_mode_guard BEFORE UPDATE OF business_type ON store_settings WHEN NEW.business_type != OLD.business_type BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM shifts WHERE status = 0) THEN RAISE(ABORT,'Close all shifts before changing business type.') WHEN NEW.business_type = 'retail' AND EXISTS(SELECT 1 FROM laundry_orders WHERE status NOT IN ('Completed','Cancelled')) THEN RAISE(ABORT,'Finish outstanding laundry orders before switching to Retail.') END; END;
`
