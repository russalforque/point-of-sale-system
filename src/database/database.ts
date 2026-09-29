import { initDatabase } from './sqlite'

/**
 * Version of the schema below, stamped into every .sellix backup. Bump it whenever the schema
 * changes: this app then refuses backups from a newer schema, while older backups are brought
 * up to date by initializeDatabase() after a restore.
 */
export const SCHEMA_VERSION = 3

export async function initializeDatabase(): Promise<void> {
  const db = await initDatabase()

  // On a device whose database already existed before shift linking was added,
  // `CREATE TABLE IF NOT EXISTS sales` below is a no-op and never adds this column.
  // The schema script is one transaction, so the later `CREATE INDEX idx_sales_shift`
  // referencing a missing column would otherwise fail and roll back everything in it -
  // including the brand new `shifts` table. Add the column explicitly first; this is a
  // no-op (caught and ignored) once it already exists, and also a no-op on a fresh
  // install where `sales` doesn't exist yet (the CREATE TABLE below handles that case).
  try {
    await db.execute(`ALTER TABLE sales ADD COLUMN shift_id INTEGER;`)
  } catch {
    // Already has the column, or the table doesn't exist yet - both fine.
  }

  // Same story for order types (schema v2). Kept in its own try so an existing
  // shift_id column above can't skip it. Older sales stay NULL (no order type recorded).
  try {
    await db.execute(`ALTER TABLE sales ADD COLUMN order_type INTEGER;`)
  } catch {
    // Already has the column, or the table doesn't exist yet - both fine.
  }

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

  console.log('=== SQLITE DATABASE SCHEMA CREATED ===')
}

type Connection = Awaited<ReturnType<typeof initDatabase>>

/** ALTER TABLE ... ADD COLUMN that is a no-op once the column exists. */
async function addColumn(db: Connection, table: string, definition: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${definition};`)
  } catch {
    // Column already exists.
  }
}

/**
 * Schema v3: held orders, split payments, returns/refunds, voids, cash drawer movements,
 * stock counts, stock receiving and the audit log. Purely additive - existing tables and
 * rows are never rebuilt or rewritten, so it is safe to run on every start.
 *
 * Note: the native plugin splits scripts on ";\n" and strips "--" to the end of each line,
 * so this SQL carries no comments and each trigger stays on a single line.
 */
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