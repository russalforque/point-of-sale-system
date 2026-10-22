import { initDatabase } from './sqlite'
import { UNITS } from '../services/units'
import { LAUNDRY_SCHEMA } from './laundryMigration'
import { LAUNDRY_PRICING_SCHEMA } from './laundryPricingMigration'
import { LAUNDRY_WORKFLOW_SCHEMA } from './laundryWorkflowMigration'

/**
 * Version of the schema below, stamped into every .sellix backup. Bump it whenever the schema
 * changes: this app then refuses backups from a newer schema, while older backups are brought
 * up to date by initializeDatabase() after a restore.
 */
export const SCHEMA_VERSION = 11

export async function initializeDatabase(): Promise<void> {
  const db = await initDatabase()
  await db.execute('CREATE TABLE IF NOT EXISTS sellix_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);')
  const latest = (await db.query('SELECT MAX(version) AS version FROM sellix_schema')).values?.[0]?.version ?? 0
  if (latest > SCHEMA_VERSION) throw new Error('This database requires a newer Sellix version. Existing records have been retained.')

  // On a device whose database already existed before shift linking was added,
  // `CREATE TABLE IF NOT EXISTS sales` below is a no-op and never adds this column.
  // The schema script is one transaction, so the later `CREATE INDEX idx_sales_shift`
  // referencing a missing column would otherwise fail and roll back everything in it -
  // including the brand new `shifts` table. Add the column explicitly first; this is a
  // no-op after column introspection once it exists, and also a no-op on a fresh
  // install where `sales` doesn't exist yet (the CREATE TABLE below handles that case).
  await addColumn(db, 'sales', 'shift_id INTEGER')

  // Same story for order types (schema v2). Each column is checked independently.
  // Older sales stay NULL (no order type recorded).
  await addColumn(db, 'sales', 'order_type INTEGER')

  await db.execute(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY,
      supplier_code TEXT NOT NULL,
      company_name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      customer_code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      loyalty_points INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER NOT NULL,
      supplier_id INTEGER,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      image_url TEXT,

      FOREIGN KEY (category_id)
        REFERENCES categories(id),

      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      invoice_number TEXT NOT NULL,
      customer_id INTEGER,
      cashier_id TEXT NOT NULL,
      shift_id INTEGER,
      subtotal REAL NOT NULL,
      discount REAL NOT NULL,
      tax REAL NOT NULL,
      total REAL NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      order_type INTEGER,

      FOREIGN KEY (customer_id)
        REFERENCES customers(id),

      FOREIGN KEY (shift_id)
        REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,

      FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL UNIQUE,
      method INTEGER NOT NULL,
      amount REAL NOT NULL,
      amount_received REAL,
      change_amount REAL,
      reference TEXT,

      FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      type INTEGER NOT NULL,
      quantity_change INTEGER NOT NULL,
      quantity_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,

      FOREIGN KEY (product_id)
        REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY,
      store_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      currency TEXT NOT NULL DEFAULT 'PHP',
      currency_symbol TEXT NOT NULL DEFAULT '₱',
      tax_rate REAL NOT NULL DEFAULT 0,
      receipt_footer TEXT NOT NULL DEFAULT '',
      show_logo_on_receipt INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      employee_name TEXT NOT NULL,
      starting_cash REAL NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      cash_sales REAL,
      non_cash_sales REAL,
      expected_cash REAL,
      actual_cash REAL,
      difference REAL,

      FOREIGN KEY (employee_id)
        REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_category
      ON products(category_id);

    CREATE INDEX IF NOT EXISTS idx_products_supplier
      ON products(supplier_id);

    CREATE INDEX IF NOT EXISTS idx_products_sku
      ON products(sku);

    CREATE INDEX IF NOT EXISTS idx_sales_customer
      ON sales(customer_id);

    CREATE INDEX IF NOT EXISTS idx_sales_created_at
      ON sales(created_at);

    CREATE INDEX IF NOT EXISTS idx_sale_items_sale
      ON sale_items(sale_id);

    CREATE INDEX IF NOT EXISTS idx_sale_items_product
      ON sale_items(product_id);

    CREATE INDEX IF NOT EXISTS idx_inventory_product
      ON inventory_transactions(product_id);

    CREATE INDEX IF NOT EXISTS idx_inventory_created_at
      ON inventory_transactions(created_at);

    CREATE INDEX IF NOT EXISTS idx_sales_shift
      ON sales(shift_id);

    CREATE INDEX IF NOT EXISTS idx_shifts_employee
      ON shifts(employee_id);

    CREATE INDEX IF NOT EXISTS idx_shifts_status
      ON shifts(status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_active_per_employee
      ON shifts(employee_id)
      WHERE status = 0;
  `)

  await migrateToV3(db)
  await migrateToV4(db)
  await migrateToV5(db)
  await migrateToV6(db)
  await migrateToV7(db)
  await migrateToV8(db)
  await addColumn(db, 'laundry_orders', 'discounts_version INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'laundry_services', 'removed_at TEXT')
  await addColumn(db, 'laundry_addons', 'removed_at TEXT')
  await addColumn(db, 'laundry_order_items', "category TEXT NOT NULL DEFAULT ''")
  await addColumn(db, 'laundry_order_addons', "category TEXT NOT NULL DEFAULT ''")
  await db.execute(LAUNDRY_PRICING_SCHEMA)
  await addColumn(db, 'laundry_configuration', 'allow_unpaid_completion INTEGER NOT NULL DEFAULT 0 CHECK(allow_unpaid_completion IN (0,1))')
  await addColumn(db, 'laundry_orders', 'status_version INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'laundry_orders', 'archived_at TEXT')
  await addColumn(db, 'laundry_orders', 'legacy_status TEXT')
  await addColumn(db, 'laundry_status_history', 'from_status TEXT')
  await addColumn(db, 'laundry_status_history', "event_type TEXT NOT NULL DEFAULT 'status'")
  await addColumn(db, 'laundry_status_history', 'event_key TEXT')
  await addColumn(db, 'laundry_status_history', 'status_version INTEGER')
  await addColumn(db, 'laundry_status_history', 'completion_confirmed INTEGER NOT NULL DEFAULT 0')
  await db.execute(LAUNDRY_WORKFLOW_SCHEMA)
  await addColumn(db, 'sales', 'notes TEXT')
  await addColumn(db, 'held_orders', 'notes TEXT')
  await db.execute(`
    CREATE TABLE IF NOT EXISTS checkout_requests (
      request_id TEXT PRIMARY KEY,
      actor_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      invoice_number TEXT NOT NULL UNIQUE,
      sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS checkout_requests_no_update BEFORE UPDATE ON checkout_requests BEGIN SELECT RAISE(ABORT, 'Checkout retry records are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS checkout_requests_no_delete BEFORE DELETE ON checkout_requests BEGIN SELECT RAISE(ABORT, 'Checkout retry records are immutable.'); END;
    INSERT OR IGNORE INTO sellix_schema(version, applied_at) VALUES (9, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `)

  console.log('=== SQLITE DATABASE SCHEMA CREATED ===')
}

type Connection = Awaited<ReturnType<typeof initDatabase>>

/** Categories are additive; never rebuild catalog tables referenced by saved orders. */
async function migrateToV8(db: Connection): Promise<void> {
  for (const table of ['laundry_services', 'laundry_addons']) {
    const columns = await db.query(`PRAGMA table_info(${table})`)
    if (!(columns.values ?? []).some(row => row.name === 'category')) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN category TEXT NOT NULL DEFAULT '';`)
    }
  }
}

async function migrateToV7(db: Connection): Promise<void> {
  // Introspect instead of swallowing an ALTER failure: disk/write failures must stop startup.
  const columns = await db.query('PRAGMA table_info(store_settings)')
  const names = new Set((columns.values ?? []).map(row => row.name))
  if (!names.has('business_type')) await db.execute("ALTER TABLE store_settings ADD COLUMN business_type TEXT NOT NULL DEFAULT 'retail' CHECK(business_type IN ('retail','laundry'));")
  if (!names.has('business_setup_complete')) await db.execute('ALTER TABLE store_settings ADD COLUMN business_setup_complete INTEGER NOT NULL DEFAULT 1 CHECK(business_setup_complete IN (0,1));')
  await db.execute(LAUNDRY_SCHEMA)
}

/** ALTER TABLE ... ADD COLUMN that is a no-op once the column exists. */
async function addColumn(db: Connection, table: string, definition: string): Promise<void> {
  const columns = (await db.query(`PRAGMA table_info(${table})`)).values ?? []
  if (!columns.length || columns.some(column => column.name === definition.split(' ')[0])) return
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${definition};`)
}

/**
 * Schema v3: held orders, split payments, returns/refunds, voids, cash drawer movements,
 * stock counts, stock receiving and the audit log. Purely additive - existing tables and
 * rows are never rebuilt or rewritten, so it is safe to run on every start.
 *
 * Note: the native plugin splits scripts on ";\n" and strips "--" to the end of each line,
 * so this SQL carries no comments and each trigger stays on a single line.
 */
/**
 * Schema v4: barcodes and units on products (bulk import / barcode entry). A barcode is
 * optional, but two products can never share one; SKU uniqueness is enforced by productApi
 * because older databases may already contain duplicate SKUs.
 */
async function migrateToV4(db: Connection): Promise<void> {
  await addColumn(db, 'products', 'barcode TEXT')
  await addColumn(db, 'products', 'unit TEXT')
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
    CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
    CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(company_name);
  `)
}

/**
 * Schema v5: cost of goods on every sale line, discount authorization, loyalty, customer credit
 * (charge accounts), expenses and purchase orders. Additive only, like v3/v4.
 */
async function migrateToV5(db: Connection): Promise<void> {
  // Cost at the moment of sale, so profit reports don't move when a cost price is edited later.
  await addColumn(db, 'sale_items', 'unit_cost REAL')

  await addColumn(db, 'sales', 'discount_type TEXT')
  await addColumn(db, 'sales', 'discount_reference TEXT')
  await addColumn(db, 'sales', 'discount_approved_by TEXT')
  await addColumn(db, 'sales', 'loyalty_discount REAL NOT NULL DEFAULT 0')
  await addColumn(db, 'sales', 'points_earned INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'sales', 'points_redeemed INTEGER NOT NULL DEFAULT 0')

  await addColumn(db, 'store_settings', 'max_discount_percent REAL NOT NULL DEFAULT 10')
  await addColumn(db, 'store_settings', 'senior_discount_percent REAL NOT NULL DEFAULT 20')
  await addColumn(db, 'store_settings', 'loyalty_enabled INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'store_settings', 'loyalty_amount_per_point REAL NOT NULL DEFAULT 100')
  await addColumn(db, 'store_settings', 'loyalty_point_value REAL NOT NULL DEFAULT 1')
  await addColumn(db, 'store_settings', 'credit_enabled INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'store_settings', 'credit_default_days INTEGER NOT NULL DEFAULT 30')

  await addColumn(db, 'customers', 'credit_limit REAL NOT NULL DEFAULT 0')
  await addColumn(db, 'customers', 'credit_balance REAL NOT NULL DEFAULT 0')
  await addColumn(db, 'customers', 'notes TEXT')

  await addColumn(db, 'stock_receipts', 'purchase_order_id INTEGER')

  // A held cart keeps its kind of discount (a Senior/PWD discount resumes as one).
  await addColumn(db, 'held_orders', 'discount_type TEXT')
  await addColumn(db, 'held_orders', 'discount_reference TEXT')

  await db.execute(`
    CREATE TABLE IF NOT EXISTS customer_credit_entries (
      id INTEGER PRIMARY KEY,
      entry_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL,
      type INTEGER NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      sale_id INTEGER,
      method INTEGER,
      reference TEXT,
      due_date TEXT,
      notes TEXT,
      shift_id INTEGER,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY,
      expense_number TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      reference TEXT,
      expense_date TEXT NOT NULL,
      paid_from_drawer INTEGER NOT NULL DEFAULT 0,
      shift_id INTEGER,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      voided_at TEXT,
      voided_by TEXT,
      void_reason TEXT,
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      expected_date TEXT,
      notes TEXT,
      total_cost REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ordered_at TEXT,
      closed_at TEXT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY,
      purchase_order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity_ordered INTEGER NOT NULL,
      quantity_received INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_credit_entries_customer ON customer_credit_entries(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_credit_entries_sale ON customer_credit_entries(sale_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
    CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_receipts_po ON stock_receipts(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_stock_receipts_supplier ON stock_receipts(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_stock_receipt_items_product ON stock_receipt_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_sales_status_created ON sales(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at);
    CREATE INDEX IF NOT EXISTS idx_refund_items_product ON refund_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_product_created ON inventory_transactions(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(full_name);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
  `)

  // Lines sold before v5 get the product's current cost: the best figure still available.
  await db.execute(`
    UPDATE sale_items SET unit_cost = COALESCE((SELECT cost_price FROM products WHERE products.id = sale_items.product_id), 0)
    WHERE unit_cost IS NULL;
  `)

  // Stock can never be pushed below zero by any write path (a sale racing a stock count, a bug).
  // Raising an already-negative figure (fixing old data) is still allowed.
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS products_stock_not_negative BEFORE UPDATE OF stock_quantity ON products WHEN NEW.stock_quantity < 0 AND NEW.stock_quantity < OLD.stock_quantity BEGIN SELECT RAISE(ABORT, 'Not enough stock for this change.'); END;`,
  )

  // Invoice numbers identify a sale everywhere (receipts, returns, sub-selects in salesApi).
  // Fail visibly on duplicates or storage errors; never delete or renumber business records.
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_unique ON sales(invoice_number);`)
}

/**
 * Schema v6: ingredient/recipe inventory for cafés and food businesses, plus modifiers.
 *
 * - products.inventory_mode says how a product uses stock. Every existing product becomes
 *   'direct' (the column default), so retail stores keep working exactly as before.
 * - inventory_items are the things the business stocks (beans, milk, cups). Quantities are
 *   INTEGER thousandths of the item's base unit (g, ml or pc) - see services/units.ts.
 * - stock_movements is their append-only ledger; on_hand is only ever changed together with a
 *   movement row, inside one transaction.
 * Additive only, like v3-v5: no existing table is rebuilt or rewritten.
 */
async function migrateToV6(db: Connection): Promise<void> {
  await addColumn(db, 'products', `inventory_mode TEXT NOT NULL DEFAULT 'direct' CHECK (inventory_mode IN ('direct', 'recipe', 'batch', 'none'))`)
  await addColumn(db, 'products', 'batch_yield INTEGER')

  await addColumn(db, 'store_settings', 'allow_negative_stock INTEGER NOT NULL DEFAULT 0')
  await addColumn(db, 'store_settings', 'food_service_enabled INTEGER NOT NULL DEFAULT 0')

  // How the line was stocked when sold (NULL = before v6, i.e. direct), and the options chosen.
  await addColumn(db, 'sale_items', 'stock_mode TEXT')
  await addColumn(db, 'sale_items', 'modifiers_json TEXT')
  // Two lines of the same product (different options) are returned separately.
  await addColumn(db, 'refund_items', 'sale_item_id INTEGER')
  await addColumn(db, 'stock_counts', `scope TEXT NOT NULL DEFAULT 'products'`)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS units_of_measure (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dimension TEXT NOT NULL CHECK (dimension IN ('mass', 'volume', 'count')),
      factor INTEGER,
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      base_unit TEXT NOT NULL CHECK (base_unit IN ('g', 'ml', 'pc')),
      on_hand INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
      unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
      cost_unit TEXT NOT NULL,
      cost_per_base REAL NOT NULL DEFAULT 0 CHECK (cost_per_base >= 0),
      purchase_unit TEXT,
      supplier_id INTEGER,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (base_unit) REFERENCES units_of_measure(code),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_unit_conversions (
      id INTEGER PRIMARY KEY,
      inventory_item_id INTEGER NOT NULL,
      unit_code TEXT NOT NULL,
      base_quantity INTEGER NOT NULL CHECK (base_quantity > 0),
      UNIQUE (inventory_item_id, unit_code),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_code) REFERENCES units_of_measure(code)
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_code TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE (product_id, inventory_item_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
      FOREIGN KEY (unit_code) REFERENCES units_of_measure(code)
    );

    CREATE TABLE IF NOT EXISTS modifier_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      selection TEXT NOT NULL DEFAULT 'single' CHECK (selection IN ('single', 'multiple')),
      is_required INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS modifiers (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price_delta REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
    );

    CREATE TABLE IF NOT EXISTS modifier_inventory_effects (
      id INTEGER PRIMARY KEY,
      modifier_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('add', 'remove', 'replace', 'scale')),
      inventory_item_id INTEGER,
      replacement_item_id INTEGER,
      quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
      unit_code TEXT,
      scale_percent INTEGER CHECK (scale_percent IS NULL OR scale_percent >= 0),
      FOREIGN KEY (modifier_id) REFERENCES modifiers(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
      FOREIGN KEY (replacement_item_id) REFERENCES inventory_items(id)
    );

    CREATE TABLE IF NOT EXISTS product_modifier_groups (
      product_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, group_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES modifier_groups(id)
    );

    CREATE TABLE IF NOT EXISTS sale_item_modifiers (
      id INTEGER PRIMARY KEY,
      sale_item_id INTEGER NOT NULL,
      modifier_id INTEGER,
      group_name TEXT NOT NULL,
      name TEXT NOT NULL,
      price_delta REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE,
      FOREIGN KEY (modifier_id) REFERENCES modifiers(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY,
      inventory_item_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('opening', 'stock_in', 'stock_out', 'sale', 'void', 'production', 'count', 'waste', 'damaged', 'expired', 'spoilage', 'correction', 'other')),
      quantity INTEGER NOT NULL,
      previous_quantity INTEGER NOT NULL,
      new_quantity INTEGER NOT NULL,
      unit_cost REAL,
      reference_type TEXT,
      reference_id TEXT,
      reason TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL,
      CHECK (new_quantity = previous_quantity + quantity),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
    );

    CREATE TABLE IF NOT EXISTS production_batches (
      id INTEGER PRIMARY KEY,
      batch_number TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL,
      batches INTEGER NOT NULL CHECK (batches > 0),
      servings INTEGER NOT NULL CHECK (servings > 0),
      ingredient_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_count_ingredient_lines (
      id INTEGER PRIMARY KEY,
      count_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      expected_quantity INTEGER NOT NULL,
      counted_quantity INTEGER NOT NULL,
      variance INTEGER NOT NULL,
      FOREIGN KEY (count_id) REFERENCES stock_counts(id),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_inventory_mode ON products(inventory_mode);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(is_active, name);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier ON inventory_items(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_items_product ON recipe_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_items_item ON recipe_items(inventory_item_id);
    CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers(group_id);
    CREATE INDEX IF NOT EXISTS idx_modifier_effects_modifier ON modifier_inventory_effects(modifier_id);
    CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_group ON product_modifier_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_sale_item_modifiers_item ON sale_item_modifiers(sale_item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created ON stock_movements(inventory_item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_production_batches_product ON production_batches(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_count_ingredient_lines_count ON stock_count_ingredient_lines(count_id);
    CREATE INDEX IF NOT EXISTS idx_refund_items_sale_item ON refund_items(sale_item_id);
  `)

  for (const [index, unit] of UNITS.entries()) {
    await db.run(`INSERT OR IGNORE INTO units_of_measure (code, name, dimension, factor, sort) VALUES (?, ?, ?, ?, ?)`, [
      unit.code,
      unit.name,
      unit.dimension,
      unit.factor,
      index,
    ])
  }

  // The stock ledger is append-only, like the audit log: corrections are new movements.
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS stock_movements_read_only_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Stock movements cannot be changed.'); END;`,
  )
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS stock_movements_read_only_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Stock movements cannot be deleted.'); END;`,
  )

  // Stock may only go below zero when the store chose "allow and warn" in Settings. Replaces the
  // v5 products trigger (same rule, plus the setting); one script so it is never missing.
  await db.execute(
    `DROP TRIGGER IF EXISTS products_stock_not_negative;\nCREATE TRIGGER products_stock_not_negative BEFORE UPDATE OF stock_quantity ON products WHEN NEW.stock_quantity < 0 AND NEW.stock_quantity < OLD.stock_quantity AND COALESCE((SELECT allow_negative_stock FROM store_settings WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'Not enough stock for this change.'); END;`,
  )
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS inventory_items_not_negative BEFORE UPDATE OF on_hand ON inventory_items WHEN NEW.on_hand < 0 AND NEW.on_hand < OLD.on_hand AND COALESCE((SELECT allow_negative_stock FROM store_settings WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'Not enough stock for this change.'); END;`,
  )
}

async function migrateToV3(db: Connection): Promise<void> {
  await addColumn(db, 'sales', 'voided_at TEXT')
  await addColumn(db, 'sales', 'voided_by TEXT')
  await addColumn(db, 'sales', 'void_reason TEXT')
  await addColumn(db, 'sales', 'void_approved_by TEXT')

  await addColumn(db, 'shifts', 'cash_refunds REAL')
  await addColumn(db, 'shifts', 'cash_in REAL')
  await addColumn(db, 'shifts', 'cash_out REAL')
  await addColumn(db, 'shifts', 'closed_by TEXT')

  await addColumn(db, 'suppliers', 'notes TEXT')
  await addColumn(db, 'users', 'pin_hash TEXT')

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      method INTEGER NOT NULL,
      amount REAL NOT NULL,
      reference TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS held_orders (
      id INTEGER PRIMARY KEY,
      label TEXT,
      customer_id INTEGER,
      customer_name TEXT,
      order_type INTEGER NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      total REAL NOT NULL,
      cashier_id INTEGER,
      cashier_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY,
      refund_number TEXT NOT NULL UNIQUE,
      sale_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method INTEGER NOT NULL,
      reason TEXT NOT NULL,
      restocked INTEGER NOT NULL DEFAULT 1,
      shift_id INTEGER,
      processed_by TEXT NOT NULL,
      approved_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS refund_items (
      id INTEGER PRIMARY KEY,
      refund_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (refund_id) REFERENCES refunds(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY,
      shift_id INTEGER NOT NULL,
      type INTEGER NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS stock_counts (
      id INTEGER PRIMARY KEY,
      count_number TEXT NOT NULL UNIQUE,
      notes TEXT,
      items_counted INTEGER NOT NULL,
      items_adjusted INTEGER NOT NULL,
      net_change INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_count_items (
      id INTEGER PRIMARY KEY,
      count_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      system_quantity INTEGER NOT NULL,
      counted_quantity INTEGER NOT NULL,
      difference INTEGER NOT NULL,
      FOREIGN KEY (count_id) REFERENCES stock_counts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_receipts (
      id INTEGER PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER,
      reference TEXT,
      received_date TEXT NOT NULL,
      notes TEXT,
      total_cost REAL NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS stock_receipt_items (
      id INTEGER PRIMARY KEY,
      receipt_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY,
      user_id TEXT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_sale ON refunds(sale_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_shift ON refunds(shift_id);
    CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items(refund_id);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements(shift_id);
    CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(count_id);
    CREATE INDEX IF NOT EXISTS idx_stock_receipt_items_receipt ON stock_receipt_items(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_number);
  `)

  // Every sale recorded before split payments has exactly one tender in `payments`;
  // copy it across once so sale_payments is the single source of tender lines.
  await db.execute(`
    INSERT INTO sale_payments (sale_id, method, amount, reference)
    SELECT p.sale_id, p.method, p.amount, p.reference
    FROM payments p
    WHERE NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = p.sale_id);
  `)

  // The audit trail is append-only for everyone, enforced by the database itself.
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS audit_logs_read_only_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit log entries cannot be changed.'); END;`,
  )
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS audit_logs_read_only_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit log entries cannot be deleted.'); END;`,
  )
}
