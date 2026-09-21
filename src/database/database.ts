import { initDatabase } from './sqlite'

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

  console.log('=== SQLITE DATABASE SCHEMA CREATED ===')
}