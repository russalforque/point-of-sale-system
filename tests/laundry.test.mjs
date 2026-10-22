// Run production TypeScript against real SQLite, replacing native database and printer transports.
// No network, Android device, test framework dependency or production database is used.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
let database,
  actorId = 1,
  failAt = -1
let printerFailure = '', printerConnections = 0, printerWrites = 0
let beforeTransaction = null
const printedDocuments = []
const context = vm.createContext({
  console: { ...console, log() {} },
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  Blob,
  Date,
  setTimeout,
  clearTimeout,
})
const modules = new Map()
const bridge = {
  query: async (sql, args = []) => ({ values: database.prepare(sql).all(...args) }),
  run: async (sql, args = []) => {
    const result = database.prepare(sql).run(...args)
    return { changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) } }
  },
  execute: async (sql) => database.exec(sql),
  executeSet: async (statements) => {
    if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; hook() }
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const [index, row] of statements.entries()) {
        if (index === failAt) {
          failAt = -1
          throw new Error('Simulated interruption')
        }
        database.prepare(row.statement).run(...row.values)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  },
}
const mocks = {
  'src/database/sqlite.ts': {
    initDatabase: async () => bridge,
    querySQL: bridge.query,
    executeSQL: bridge.run,
  },
  'src/utils/session.ts': { getStoredUser: () => ({ id: String(actorId), fullName: 'Test staff' }) },
  'src/services/printer/printerService.ts': {
    ensurePrinterConnected: async () => {
      printerConnections += 1
      if (printerFailure === 'connect') throw new Error('Printer disconnected')
    },
    getPrinterService: () => ({
      printDocument: async bytes => {
        printerWrites += 1
        if (printerFailure === 'write') throw new Error('Paper out')
        printedDocuments.push(Buffer.from(bytes).toString('ascii'))
      },
    }),
  },
  '@capacitor/core': { Capacitor: { isNativePlatform: () => false } },
  '@tauri-apps/api/core': { isTauri: () => false, invoke: async () => { throw new Error('No desktop in this test') } },
  '@capacitor/filesystem': { Directory: { Cache: 'CACHE' }, Filesystem: {} },
  '@capacitor/share': { Share: {} },
}
function getModule(id) {
  if (modules.has(id)) return modules.get(id)
  let mod
  if (mocks[id]) {
    const mock = mocks[id]
    mod = new vm.SyntheticModule(
      Object.keys(mock),
      function () {
        for (const [key, value] of Object.entries(mock)) this.setExport(key, value)
      },
      { context, identifier: id },
    )
  } else {
    const source = stripTypeScriptTypes(readFileSync(join(root, id), 'utf8'))
    mod = new vm.SourceTextModule(source, { context, identifier: id })
  }
  modules.set(id, mod)
  return mod
}
async function load(id) {
  const mod = getModule(id)
  if (mod.status === 'unlinked')
    await mod.link((specifier, parent) => {
      const target = specifier.startsWith('.')
        ? resolve(root, dirname(parent.identifier), specifier)
            .slice(root.length + 1)
            .replaceAll('\\', '/') + '.ts'
        : specifier
      return getModule(target)
    })
  if (mod.status === 'linked') await mod.evaluate()
  return mod.namespace
}
const { initializeDatabase } = await load('src/database/database.ts')
const { seedDatabase } = await load('src/database/seed.ts')
const { laundryApi } = await load('src/api/laundryApi.ts')
const { businessApi } = await load('src/api/businessApi.ts')
const { laundryReportsApi, localDate } = await load('src/api/laundryReportsApi.ts')
const { settingsApi } = await load('src/api/settingsApi.ts')
const { shiftApi } = await load('src/api/shiftApi.ts')
const { priceLines, cents, paymentAmounts } = await load('src/services/laundryMath.ts')
const { buildLaundryReceipt } = await load('src/services/printer/laundryReceipt.ts')
const { autoPrintLaundryReceipt } = await load('src/services/printer/laundryPrinting.ts')
const { laundryPricingApi } = await load('src/api/laundryPricingApi.ts')
const { laundryDiscountTotals, laundryPricingKey } = await load('src/services/laundryDiscounts.ts')
const { laundryCsv, laundryReportExport } = await load('src/services/laundryExport.ts')
const { buildReportPdf } = await load('src/utils/reportExport.ts')
const { salesApi } = await load('src/api/salesApi.ts')
const { SCHEMA_VERSION } = await load('src/database/database.ts')
const { LAUNDRY_WORKFLOW_SCHEMA } = await load('src/database/laundryWorkflowMigration.ts')
const { LAUNDRY_STATUSES } = await load('src/types/laundry.ts')
const one = (sql, args = []) => database.prepare(sql).get(...args)
const run = (sql, args = []) => database.prepare(sql).run(...args)
const key = () => webcrypto.randomUUID()
const order = (extra = {}) => ({
  requestKey: key(),
  customerId: 1,
  items: [{ id: 1, quantity: 5 }],
  addons: [],
  discount: 0,
  ...extra,
})
const payment = (amount, extra = {}) => ({
  requestKey: key(),
  method: 'Cash',
  amount,
  tendered: amount,
  ...extra,
})
async function fresh(path = ':memory:', keepDefaults = false) {
  database = new DatabaseSync(path)
  database.exec('PRAGMA foreign_keys=ON')
  actorId = 1
  failAt = -1
  beforeTransaction = null
  await initializeDatabase()
  await seedDatabase()
  await businessApi.select('laundry', 'SELECT LAUNDRY')
  // Financial regression fixtures use their original explicit catalog; defaults have separate coverage.
  if (!keepDefaults) database.exec('DELETE FROM laundry_services; DELETE FROM laundry_addons;')
  run(
    "INSERT INTO customers (id,customer_code,full_name,phone,is_active,created_at) VALUES (1,'C1','Customer One','09123456789',1,?)",
    [new Date().toISOString()],
  )
  if (keepDefaults) return
  await laundryApi.saveCatalog('services', {
    name: 'Wash & Fold',
    pricing: 'kg',
    price_cents: 7000,
    is_active: 1,
  })
  await laundryApi.saveCatalog('services', {
    name: 'Comforter',
    pricing: 'piece',
    price_cents: 12000,
    is_active: 1,
  })
  await laundryApi.saveCatalog('addons', {
    name: 'Detergent',
    pricing: 'quantity',
    price_cents: 2500,
    is_active: 1,
  })
}
async function shift() {
  run(
    "INSERT INTO shifts (employee_id,employee_name,starting_cash,status,started_at) VALUES (?,'Staff',100,0,?)",
    [actorId, new Date().toISOString()],
  )
}

// Build an already-archived legacy record; cancellation is no longer an active operation.
async function legacyArchive(id, reason) {
  database.exec('DROP TRIGGER laundry_status_guard; DROP TRIGGER laundry_archive_guard;')
  run("UPDATE laundry_orders SET status='Cancelled',legacy_status='Cancelled',archived_at=updated_at WHERE id=?", [id])
  run("INSERT INTO laundry_status_history(order_id,status,reason,created_by,created_at) VALUES(?,'Cancelled',?,1,?)", [id, reason, new Date().toISOString()])
  database.exec(LAUNDRY_WORKFLOW_SCHEMA)
}
const complete = id => laundryApi.status(id, 'Completed', '', { confirmed: true })

test('v8 migration is additive, preserves existing retail settings/data, and can run twice', async () => {
  database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys=ON')
  const source = readFileSync(join(root, 'src/database/database.ts'), 'utf8')
  const legacy = source.match(/CREATE TABLE IF NOT EXISTS store_settings \([\s\S]*?\n    \);/)[0]
  database.exec(legacy)
  run("INSERT INTO store_settings (id,store_name) VALUES (1,'Existing Retail')")
  await initializeDatabase()
  await seedDatabase()
  assert.equal(one('SELECT business_type FROM store_settings').business_type, 'retail')
  assert.equal(one('SELECT business_setup_complete FROM store_settings').business_setup_complete, 1)
  run(
    "INSERT INTO sales(id,invoice_number,cashier_id,subtotal,discount,tax,total,status,created_at) VALUES (77,'LEGACY-77','1',99,0,0,99,0,'2025-01-01')",
  )
  await initializeDatabase()
  assert.equal(one('SELECT total FROM sales WHERE id=77').total, 99)
  assert.equal((await settingsApi.get()).storeName, 'Existing Retail')
  assert.equal(SCHEMA_VERSION, 11)
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})
test('v7 catalog upgrade adds categories without changing saved orders or prices', async () => {
  await fresh()
  const id = await laundryApi.create(order())
  // v7 did not have the v10 guards that reference catalog categories.
  database.exec('DROP TRIGGER laundry_service_price_guard; DROP TRIGGER laundry_addon_price_guard; ALTER TABLE laundry_services DROP COLUMN category; ALTER TABLE laundry_addons DROP COLUMN category;')
  await initializeDatabase()
  assert.equal((await laundryApi.catalog('services'))[0].category, '')
  await laundryApi.saveCatalog('services', { id: 1, name: 'Wash & Fold', category: ' Everyday ', pricing: 'kg', price_cents: 8000, is_active: 1 })
  await initializeDatabase()
  assert.equal(one('SELECT category FROM laundry_services WHERE id=1').category, 'Everyday')
  assert.equal((await laundryApi.detail(id)).total_cents, 35000)
  await assert.rejects(() => laundryApi.saveCatalog('services', { name: 'Invalid', category: 'x'.repeat(61), pricing: 'kg', price_cents: 100, is_active: 1 }))
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok')
  database.close()
})

test('customer summary includes every order across history pages and excludes cancelled balances', async () => {
  await fresh()
  await shift()
  const ids = []
  for (let index = 0; index < 35; index++) ids.push(await laundryApi.create(order()))
  await legacyArchive(ids[0], 'Customer changed plans')
  await laundryApi.pay(ids[1], payment(100))
  assert.equal((await laundryApi.list({ customerId: 1 })).orders.length, 30)
  const summary = await laundryApi.customerSummary(1)
  assert.equal(summary.total, 34)
  assert.equal(summary.active, 34)
  assert.equal(summary.outstanding, 34 * 35000 - 10000)
  const empty = await laundryApi.customerSummary(999)
  assert.equal(empty.total, 0)
  assert.equal(empty.outstanding, 0)
  run("INSERT INTO customers (id,customer_code,full_name,phone,is_active,created_at) VALUES (2,'C2','Customer Two','09123456780',1,?)", [new Date().toISOString()])
  const partial = await laundryApi.create(order({ customerId: 2 }))
  await laundryApi.pay(partial, payment(50))
  const completed = await laundryApi.create(order({ customerId: 2 }))
  await laundryApi.pay(completed, payment(350))
  await laundryApi.status(completed, 'Ready for Pickup')
  await complete(completed)
  const directory = await laundryApi.customerSummaries([1, 2, 999, 1])
  assert.deepEqual(directory[1], summary)
  assert.deepEqual({ ...directory[2] }, { total: 2, active: 1, outstanding: 30000 })
  assert.deepEqual({ ...directory[999] }, { total: 0, active: 0, outstanding: 0 })
  assert.equal(Object.keys(await laundryApi.customerSummaries([])).length, 0)
  await assert.rejects(() => laundryApi.customerSummaries([1, NaN]), /valid customers/)
  await assert.rejects(() => laundryApi.customerSummaries(Array.from({ length: 101 }, (_, index) => index + 1)), /100/)
  database.close()
})

test('fresh install requires business selection; admin confirmation and closed shifts protect changes', async () => {
  database = new DatabaseSync(':memory:')
  await initializeDatabase()
  await seedDatabase()
  assert.equal((await settingsApi.get()).businessSetupComplete, false)
  await assert.rejects(() => businessApi.select('laundry', 'yes'), /confirmation/)
  actorId = 3
  await assert.rejects(() => businessApi.select('laundry', 'SELECT LAUNDRY'), /admin/)
  actorId = 1
  await shift()
  await assert.rejects(() => businessApi.select('laundry', 'SELECT LAUNDRY'), /Close all shifts/)
  run('UPDATE shifts SET status=1')
  await businessApi.select('laundry', 'SELECT LAUNDRY')
  assert.equal((await settingsApi.get()).businessType, 'laundry')
  database.close()
})
test('retail checkout still posts stock, tax, cash change, receipt data and shift totals after v7', async () => {
  await fresh()
  await businessApi.select('retail', 'SELECT RETAIL')
  await shift()
  run("INSERT INTO categories(id,name) VALUES (1,'Retail')")
  const now = new Date().toISOString()
  run(
    "INSERT INTO products(id,sku,name,category_id,cost_price,selling_price,stock_quantity,reorder_level,created_at,updated_at) VALUES (1,'SKU1','Retail item',1,50,100,10,1,?,?)",
    [now, now],
  )
  const sale = await salesApi.create({
    requestId: key(),
    discount: 0,
    orderType: 0,
    paymentMethod: 0,
    amountReceived: 250,
    items: [{ productId: 1, quantity: 2 }],
  })
  assert.equal(sale.total, 224)
  assert.equal(sale.tax, 24)
  assert.equal(one('SELECT change_amount FROM payments WHERE sale_id=?', [sale.id]).change_amount, 26)
  assert.equal(one('SELECT stock_quantity FROM products WHERE id=1').stock_quantity, 8)
  assert.equal((await shiftApi.summary()).summary.cashSales, 224)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 0)
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})
test('quantities, decimal money, line rounding, full/partial payments and cash change validate', () => {
  assert.equal(cents(0.29), 29)
  assert.throws(() => cents(1.001))
  assert.throws(() => cents(Infinity))
  assert.throws(() => cents(-1))
  const catalog = [
    { id: 1, name: 'Wash', pricing: 'kg', price_cents: 333, is_active: 1 },
    { id: 2, name: 'Fixed', pricing: 'fixed', price_cents: 500, is_active: 1 },
    { id: 3, name: 'Load', pricing: 'load', price_cents: 100, is_active: 1 },
  ]
  assert.equal(priceLines([{ id: 1, quantity: 1.25 }], catalog)[0].total_cents, 416)
  for (const quantity of [0, -1, NaN, Infinity, 1.0001])
    assert.throws(() => priceLines([{ id: 1, quantity }], catalog))
  assert.throws(() => priceLines([{ id: 3, quantity: 1.5 }], catalog))
  assert.throws(() => priceLines([{ id: 2, quantity: 2 }], catalog))
  assert.throws(() =>
    priceLines(
      [
        { id: 1, quantity: 1 },
        { id: 1, quantity: 1 },
      ],
      catalog,
    ),
  )
  assert.equal(paymentAmounts(150, 200, 'Cash', 35000).change, 5000)
  assert.throws(() => paymentAmounts(351, 351, 'Cash', 35000))
  assert.throws(() => paymentAmounts(0, 0, 'Cash', 0))
  assert.throws(() => paymentAmounts(150, 200, 'GCash', 35000))
})
test('350 order, 150 initial cash, 200 later Maya: balances, histories, shifts and reports agree', async () => {
  await fresh()
  await shift()
  const input = order({ payment: payment(150, { tendered: 200 }) })
  const id = await laundryApi.create(input)
  assert.equal((await laundryApi.detail(id)).total_cents, 35000)
  assert.equal((await laundryApi.detail(id)).paid_cents, 15000)
  const later = payment(200, { method: 'Maya', reference: 'manual-reference' })
  await laundryApi.pay(id, later)
  await laundryApi.pay(id, later)
  const detail = await laundryApi.detail(id)
  assert.equal(detail.paid_cents, 35000)
  assert.equal(detail.payments.length, 2)
  assert.equal(detail.history[0].status, 'Received')
  const report = await laundryReportsApi.report(localDate(), localDate())
  assert.equal(
    report.collections.reduce((n, p) => n + p.amount_cents, 0),
    35000,
  )
  assert.equal(report.outstanding, 0)
  const summary = (await shiftApi.summary()).summary
  assert.equal(summary.cashSales, 150)
  assert.equal(summary.nonCashSales, 200)
  assert.equal(summary.expectedCash, 250)
  assert.equal(await laundryApi.create(input), id)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 1)
  await assert.rejects(() => laundryApi.pay(id, payment(1)), /remaining balance/)
  database.close()
})
test('duplicate concurrent taps and changed payload retries never create duplicate orders/payments', async () => {
  await fresh()
  await shift()
  const input = order(),
    ids = await Promise.all([laundryApi.create(input), laundryApi.create(input)])
  assert.equal(ids[0], ids[1])
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 1)
  await assert.rejects(() => laundryApi.create({ ...input, discount: 10 }), /different details/)
  const pay = payment(150)
  await Promise.all([laundryApi.pay(ids[0], pay), laundryApi.pay(ids[0], pay)])
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_payments').n, 1)
  await assert.rejects(
    () => laundryApi.pay(ids[0], { ...pay, amount: 100, tendered: 100 }),
    /different details/,
  )
  const outcomes = await Promise.allSettled([
    laundryApi.pay(ids[0], payment(150)),
    laundryApi.pay(ids[0], payment(150)),
  ])
  assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1)
  assert.equal((await laundryApi.detail(ids[0])).paid_cents, 30000)
  database.close()
})
test('interrupted order/payment transactions roll back every row, then retry succeeds', async () => {
  await fresh()
  await shift()
  const input = order({ payment: payment(150) })
  failAt = 4
  await assert.rejects(() => laundryApi.create(input), /interruption/)
  for (const table of ['laundry_orders', 'laundry_order_items', 'laundry_payments', 'laundry_status_history'])
    assert.equal(one(`SELECT COUNT(*) AS n FROM ${table}`).n, 0)
  const id = await laundryApi.create(input),
    pay = payment(200)
  failAt = 1
  await assert.rejects(() => laundryApi.pay(id, pay), /interruption/)
  assert.equal((await laundryApi.detail(id)).paid_cents, 15000)
  await laundryApi.pay(id, pay)
  assert.equal((await laundryApi.detail(id)).paid_cents, 35000)
  database.close()
})
test('three statuses require sequential progress, pickup confirmation and authorized documented corrections', async () => {
  await fresh()
  assert.deepEqual(Array.from(LAUNDRY_STATUSES), ['Received', 'Ready for Pickup', 'Completed'])
  const id = await laundryApi.create(order())
  assert.equal((await laundryApi.detail(id)).status, 'Received')
  assert.equal((await laundryApi.detail(id)).status_version, 0)
  await assert.rejects(() => laundryApi.status(id, 'Completed'), /Follow Received/)
  for (const status of ['Washing', 'Drying', 'For Folding', 'Cancelled'])
    await assert.rejects(() => laundryApi.status(id, status), /Use Received/)
  await laundryApi.status(id, 'Ready for Pickup')
  await assert.rejects(() => laundryApi.status(id, 'Received'), /authorized correction/)
  await assert.rejects(() => laundryApi.status(id, 'Completed'), /Confirm/)
  await assert.rejects(() => complete(id), /payment in full/)
  await shift()
  await laundryApi.pay(id, payment(350))
  await complete(id)
  assert.equal((await laundryApi.detail(id)).history.length, 3)
  await assert.rejects(() => laundryApi.status(id, 'Received', 'Wrong order'), /authorized correction/)
  actorId = 3
  await assert.rejects(() => laundryApi.status(id, 'Received', 'Wrong order', { correction: true }), /permission/)
  actorId = 2
  await assert.rejects(() => laundryApi.status(id, 'Received', '', { correction: true }), /reason/)
  await assert.rejects(() => laundryApi.status(id, 'Received', 'Wrong order', { correction: true, expectedVersion: 1 }), /changed/)
  await laundryApi.status(id, 'Received', 'Pickup selected for the wrong order', { correction: true, expectedVersion: 2 })
  let detail = await laundryApi.detail(id)
  assert.equal(detail.status_version, 3)
  assert.equal(detail.history.at(-1).event_type, 'correction')
  assert.equal(detail.history.at(-1).from_status, 'Completed')
  assert.equal(detail.history.at(-1).created_by, 2)
  assert.equal(detail.paid_cents, 35000)
  await assert.rejects(() => laundryApi.status(id, 'Completed', 'Actual pickup confirmed', { correction: true }), /Confirm/)
  await laundryApi.status(id, 'Completed', 'Actual pickup confirmed', { correction: true, confirmed: true })
  detail = await laundryApi.detail(id)
  assert.equal(detail.history.length, 5)
  assert.equal(detail.status_version, 4)
  actorId = 1
  await laundryApi.saveCatalog('services', {
    id: 1,
    name: 'Free wash',
    pricing: 'kg',
    price_cents: 0,
    is_active: 1,
  })
  const zero = await laundryApi.create(order())
  await laundryApi.status(zero, 'Ready for Pickup')
  await complete(zero)
  assert.equal((await laundryApi.detail(zero)).paid_cents, 0)
  database.close()
})
test('legacy workflow migration retains snapshots, original history and collections, and archives cancellations once', async () => {
  await fresh(); await shift()
  const legacy = ['Washing', 'Drying', 'For Folding', 'Ready for Pickup', 'Completed', 'Cancelled']
  const ids = []
  for (const status of legacy) ids.push(await laundryApi.create(order({ payment: payment(100), notes: status })))
  const linesBefore = JSON.stringify(database.prepare('SELECT * FROM laundry_order_items').all())
  const paymentsBefore = JSON.stringify(database.prepare('SELECT * FROM laundry_payments').all())
  const discountsBefore = JSON.stringify(database.prepare('SELECT * FROM laundry_order_discounts').all())
  database.exec('DROP TRIGGER laundry_status_guard; DELETE FROM sellix_schema WHERE version=11;')
  for (const [index, status] of legacy.entries()) {
    run('UPDATE laundry_orders SET status=? WHERE id=?', [status, ids[index]])
    run('INSERT INTO laundry_status_history(order_id,status,created_by,created_at) VALUES(?,?,1,?)', [ids[index], status, new Date().toISOString()])
  }
  await initializeDatabase()
  assert.equal(JSON.stringify(database.prepare('SELECT * FROM laundry_order_items').all()), linesBefore)
  assert.equal(JSON.stringify(database.prepare('SELECT * FROM laundry_payments').all()), paymentsBefore)
  assert.equal(JSON.stringify(database.prepare('SELECT * FROM laundry_order_discounts').all()), discountsBefore)
  for (const [index, status] of legacy.entries()) {
    const detail = await laundryApi.detail(ids[index])
    assert.equal(detail.status, index < 3 ? 'Received' : status)
    assert.ok(detail.history.some(row => row.status === status), 'original status is retained')
    assert.equal(detail.total_cents, 35000)
    assert.equal(detail.paid_cents, 10000)
    if (index < 3 || status === 'Cancelled') {
      assert.equal(detail.legacy_status, status)
      assert.equal(detail.history.at(-1).event_type, 'migration')
      assert.equal(detail.history.at(-1).from_status, status)
      assert.equal(detail.history.at(-1).staff, 'System migration')
    }
  }
  const archive = ids.at(-1)
  assert.equal((await laundryApi.list()).count, 5)
  assert.equal((await laundryApi.list({ archived: true })).orders[0].id, archive)
  await assert.rejects(() => laundryApi.status(archive, 'Received', 'Restore order', { correction: true }), /read-only/)
  await assert.rejects(() => laundryApi.pay(archive, payment(1)), /archived/)
  const dashboard = await laundryReportsApi.dashboard()
  assert.deepEqual({ ...dashboard.states }, { Received: 3, 'Ready for Pickup': 1, Completed: 1 })
  assert.equal(dashboard.outstanding, 125000)
  const report = await laundryReportsApi.report(localDate(), localDate())
  assert.equal(report.collections.length, 6, 'historical financial collections remain visible')
  assert.equal(report.orders.reduce((n, row) => n + row.count, 0), 5)
  assert.equal(report.services.reduce((n, row) => n + row.net_value, 0), 175000)
  const historyCount = one('SELECT COUNT(*) AS n FROM laundry_status_history').n
  await initializeDatabase(); await initializeDatabase()
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_status_history').n, historyCount)
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})

test('status transactions roll back interruptions and duplicate taps produce one revision and audit entry', async () => {
  await fresh()
  const id = await laundryApi.create(order())
  failAt = 1
  await assert.rejects(() => laundryApi.status(id, 'Ready for Pickup'), /interruption/)
  assert.equal((await laundryApi.detail(id)).history.length, 1)
  assert.equal((await laundryApi.detail(id)).status_version, 0)
  beforeTransaction = () => run('UPDATE users SET is_active=0 WHERE id=1')
  await assert.rejects(() => laundryApi.status(id, 'Ready for Pickup'), /authorized history/)
  run('UPDATE users SET is_active=1 WHERE id=1')
  assert.equal((await laundryApi.detail(id)).history.length, 1)
  await Promise.all([laundryApi.status(id, 'Ready for Pickup'), laundryApi.status(id, 'Ready for Pickup')])
  await laundryApi.status(id, 'Ready for Pickup')
  const detail = await laundryApi.detail(id)
  assert.equal(detail.history.length, 2)
  assert.equal(detail.status_version, 1)
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='laundry_status'").n, 1)
  assert.throws(() => run("UPDATE laundry_orders SET status='Received',status_version=status_version+1 WHERE id=?", [id]), /authorized history/)
  for (const status of ['Washing', 'Drying', 'For Folding', 'Cancelled'])
    assert.throws(() => run('UPDATE laundry_orders SET status=?,status_version=status_version+1 WHERE id=?', [status, id]), /Use Received/)
  assert.throws(() => run('UPDATE laundry_orders SET status_version=99 WHERE id=?', [id]), /revision/)
  assert.throws(() => run("UPDATE laundry_orders SET archived_at='2026-01-01' WHERE id=?", [id]), /read-only/)
  for (const status of ['Washing', 'Drying', 'For Folding', 'Ready for Pickup', 'Completed', 'Cancelled'])
    assert.throws(() => run(`INSERT INTO laundry_orders(order_number,request_key,request_payload,customer_id,customer_name,customer_phone,subtotal_cents,discount_cents,total_cents,status,created_by,created_at,updated_at) SELECT ?,?,'fixture',customer_id,customer_name,customer_phone,subtotal_cents,discount_cents,total_cents,?,created_by,created_at,updated_at FROM laundry_orders WHERE id=?`, [key(), key(), status, id]), /must start as Received/)
  database.close()
})

test('unpaid completion follows shop policy, persists offline, and allows later collection without changing pickup status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sellix-workflow-')), path = join(dir, 'workflow.db')
  try {
    await fresh(path)
    const id = await laundryApi.create(order())
    actorId = 3
    await laundryApi.status(id, 'Ready for Pickup')
    await assert.rejects(() => complete(id), /payment in full/)
    await assert.rejects(async () => laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), allow_unpaid_completion: 1 }), /admin/)
    actorId = 1
    await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), allow_unpaid_completion: 1 })
    actorId = 3
    beforeTransaction = () => run('UPDATE laundry_configuration SET allow_unpaid_completion=0,revision=revision+1 WHERE id=1')
    await assert.rejects(() => complete(id), /payment in full/)
    assert.equal((await laundryApi.detail(id)).history.length, 2, 'policy changes at commit roll back history too')
    actorId = 1
    await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), allow_unpaid_completion: 1 })
    actorId = 3
    await complete(id)
    assert.equal((await laundryApi.detail(id)).paid_cents, 0)
    assert.equal((await laundryApi.customerSummary(1)).active, 0)
    assert.equal((await laundryPricingApi.context(1)).visits, 0, 'paid-visit rule is independent of pickup')
    database.close()
    database = new DatabaseSync(path); database.exec('PRAGMA foreign_keys=ON')
    await initializeDatabase()
    assert.equal((await laundryApi.detail(id)).status, 'Completed')
    assert.equal((await laundryApi.detail(id)).history.at(-1).completion_confirmed, 1)
    assert.equal((await laundryPricingApi.rules()).allow_unpaid_completion, 1)
    actorId = 1
    const report = await laundryReportsApi.report(localDate(), localDate())
    assert.equal(report.outstanding, 35000); assert.equal(report.balances.length, 1)
    await assert.rejects(() => businessApi.select('retail', 'SELECT RETAIL'), /balances/)
    await shift(); await laundryApi.pay(id, payment(150)); await laundryApi.pay(id, payment(200))
    const detail = await laundryApi.detail(id)
    assert.equal(detail.status, 'Completed'); assert.equal(detail.status_version, 2)
    assert.equal(detail.paid_cents, 35000); assert.equal(detail.payments.length, 2)
    assert.equal((await laundryPricingApi.context(1)).visits, 1)
    assert.equal((await laundryReportsApi.dashboard()).outstanding, 0)
    assert.equal((await laundryReportsApi.report(localDate(), localDate())).collections.length, 2)
    database.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('catalog snapshots, permissions, required customers and open-shift payment guards', async () => {
  await fresh()
  const id = await laundryApi.create(order())
  await laundryApi.saveCatalog('services', {
    id: 1,
    name: 'New price',
    pricing: 'kg',
    price_cents: 9999,
    is_active: 1,
  })
  assert.equal((await laundryApi.detail(id)).total_cents, 35000)
  assert.equal((await laundryApi.detail(id)).items[0].name, 'Wash & Fold')
  await assert.rejects(() => laundryApi.create(order({ customerId: 999 })), /customer/)
  run("UPDATE customers SET full_name='   ' WHERE id=1")
  await assert.rejects(() => laundryApi.create(order()), /name/)
  run("UPDATE customers SET full_name='Customer One',is_active=0 WHERE id=1")
  await assert.rejects(() => laundryApi.create(order()), /active customer/)
  run('UPDATE customers SET is_active=1 WHERE id=1')
  await assert.rejects(() => laundryApi.pay(id, payment(1)), /shift/i)
  actorId = 3
  await assert.rejects(
    () =>
      laundryApi.saveCatalog('services', { name: 'Invalid', pricing: 'kg', price_cents: 100, is_active: 1 }),
    /manager/,
  )
  await assert.rejects(() => laundryApi.create(order({ discount: 100 })), /discount/)
  run('UPDATE users SET is_active=0 WHERE id=3')
  await assert.rejects(() => laundryApi.create(order()), /active/)
  database.close()
})
test('shift APIs revalidate active accounts, protect employee details and enforce history permissions', async () => {
  await fresh()
  const adminShift = await shiftApi.start({ startingCash: 100 })
  actorId = 3
  const cashierShift = await shiftApi.start({ startingCash: 0 })
  assert.equal(cashierShift.startingCash, 0)
  assert.equal((await shiftApi.get(cashierShift.id)).employeeId, 3)
  assert.equal((await shiftApi.movements(cashierShift.id)).length, 0)
  await assert.rejects(() => shiftApi.history({}), /permission/i)
  await assert.rejects(() => shiftApi.get(adminShift.id), /permission/i)
  await assert.rejects(() => shiftApi.movements(adminShift.id), /permission/i)
  await assert.rejects(() => shiftApi.addCashMovement({ type: 'invalid', amount: 10, reason: 'Invalid movement' }), /cash in or cash out/i)
  await shiftApi.addCashMovement({ type: 'in', amount: 50, reason: 'Float top-up' })
  assert.equal((await shiftApi.summary()).summary.expectedCash, 50)
  run('UPDATE users SET is_active=0 WHERE id=3')
  const auditCount = one('SELECT COUNT(*) AS n FROM audit_logs').n
  for (const operation of [
    () => shiftApi.start({ startingCash: 100 }),
    () => shiftApi.getActive(),
    () => shiftApi.get(cashierShift.id),
    () => shiftApi.movements(cashierShift.id),
    () => shiftApi.addCashMovement({ type: 'out', amount: 10, reason: 'Bank deposit' }),
    () => shiftApi.end({ actualCash: 50 }),
    () => shiftApi.history({}),
  ]) await assert.rejects(operation, /active/i)
  assert.equal(one('SELECT COUNT(*) AS n FROM audit_logs').n, auditCount)
  assert.equal(one('SELECT status FROM shifts WHERE id=?', [cashierShift.id]).status, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM cash_movements').n, 1)
  actorId = 2
  assert.equal((await shiftApi.get(adminShift.id)).id, adminShift.id)
  assert.equal((await shiftApi.history({})).totalCount, 2)
  assert.equal((await shiftApi.movements(cashierShift.id)).length, 1)
  database.close()
})

test('shift history cash-result filters cover all pages, exclude open shifts and retain stable ordering', async () => {
  await fresh()
  const at = new Date().toISOString()
  for (let index = 0; index < 24; index++) {
    const difference = [-10, 20, 0, null][index % 4]
    run(`INSERT INTO shifts(employee_id,employee_name,starting_cash,status,started_at,ended_at,cash_sales,non_cash_sales,expected_cash,actual_cash,difference)
      VALUES(1,?,100,1,?,?,50,25,150,?,?)`, [index < 12 ? 'Avery Lane' : 'Blair Santos', at, at, difference === null ? null : 150 + difference, difference])
  }
  await shift()
  for (const [cashResult, matches] of [['short', value => value < 0], ['over', value => value > 0], ['balanced', value => value === 0], ['uncounted', value => value === null]]) {
    const first = await shiftApi.history({ cashResult, pageSize: 2, page: 1 })
    const second = await shiftApi.history({ cashResult, pageSize: 2, page: 2 })
    assert.equal(first.totalCount, 6)
    assert.equal(first.totalPages, 3)
    assert.equal(first.items.length, 2)
    assert.ok([...first.items, ...second.items].every(row => row.status === 'Closed' && matches(row.difference)))
    assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 4)
    assert.ok(first.items[1].id > second.items[0].id, 'equal start timestamps use descending IDs across pages')
  }
  assert.equal((await shiftApi.history({ employeeName: 'Avery', cashResult: 'short' })).totalCount, 3)
  assert.equal((await shiftApi.history({ status: 'open' })).totalCount, 1)
  assert.equal((await shiftApi.history({ status: 'open', cashResult: 'uncounted' })).totalCount, 0)
  database.close()
})

test('laundry orders accept name-only customers and retain a nullable phone snapshot', async () => {
  await fresh()
  run('UPDATE customers SET phone=NULL WHERE id=1')
  const id = await laundryApi.create(order())
  const detail = await laundryApi.detail(id)
  assert.equal(detail.customer_name, 'Customer One')
  assert.equal(detail.customer_phone, null)
  assert.equal(detail.total_cents, 35000)
  await shift()
  await laundryApi.pay(id, payment(350))
  await laundryApi.status(id, 'Ready for Pickup')
  await complete(id)
  assert.equal((await laundryApi.detail(id)).status, 'Completed')
  database.close()
})

test('SQL rejects ledger edits/deletes, invalid quantities, cancellation bypass and foreign keys', async () => {
  await fresh()
  await shift()
  const id = await laundryApi.create(order({ payment: payment(150) }))
  for (const sql of [
    `DELETE FROM laundry_orders WHERE id=${id}`,
    'DELETE FROM laundry_payments',
    'UPDATE laundry_payments SET amount_cents=1',
    'DELETE FROM laundry_order_items',
    'UPDATE laundry_order_items SET total_cents=1',
    'DELETE FROM laundry_status_history',
    `UPDATE laundry_orders SET total_cents=1 WHERE id=${id}`,
    `UPDATE laundry_orders SET status='Cancelled' WHERE id=${id}`,
  ])
    assert.throws(() => database.exec(sql))
  assert.throws(
    () =>
      run(
        "INSERT INTO laundry_order_items(order_id,service_id,name,pricing,quantity_milli,price_cents,total_cents) VALUES (999,1,'x','kg',1000,100,100)",
      ),
    /FOREIGN KEY/,
  )
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})
test('service/add-on discount allocations reconcile exactly and collection dates differ from order dates', async () => {
  await fresh()
  await shift()
  const id = await laundryApi.create(
    order({
      items: [
        { id: 1, quantity: 1.111 },
        { id: 2, quantity: 1 },
      ],
      addons: [{ id: 1, quantity: 2 }],
      discount: 3.33,
      payment: payment(1),
    }),
  )
  const report = await laundryReportsApi.report(localDate(), localDate())
  assert.equal(
    report.services.reduce((n, row) => n + row.net_value, 0),
    (await laundryApi.detail(id)).total_cents,
  )
  assert.equal(
    report.collections.reduce((n, row) => n + row.amount_cents, 0),
    100,
  )
  assert.equal(report.services.length, 3)
  // Move the payment timestamp only in a test fixture by using a new payment dated tomorrow.
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  run(
    "INSERT INTO laundry_payments(order_id,request_key,request_payload,method,amount_cents,tendered_cents,shift_id,created_by,created_at) VALUES (?,?,?,'Cash',100,100,1,1,?)",
    [id, key(), 'fixture', tomorrow.toISOString()],
  )
  assert.equal((await laundryReportsApi.report(localDate(), localDate())).collections.length, 1)
  assert.equal(
    (await laundryReportsApi.report(localDate(tomorrow), localDate(tomorrow))).collections.length,
    1,
  )
  assert.equal((await laundryReportsApi.report(localDate(tomorrow), localDate(tomorrow))).orders.length, 0)
  database.close()
})
test('business switching retains records, blocks unresolved laundry, and supports reopening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sellix-laundry-')),
    path = join(dir, 'acceptance.db')
  try {
    await fresh(path)
    const id = await laundryApi.create(order())
    await assert.rejects(() => businessApi.select('retail', 'SELECT RETAIL'), /outstanding/)
    database.close()
    database = new DatabaseSync(path)
    database.exec('PRAGMA foreign_keys=ON')
    await initializeDatabase()
    assert.equal((await laundryApi.detail(id)).total_cents, 35000)
    await legacyArchive(id, 'Customer request')
    await businessApi.select('retail', 'SELECT RETAIL')
    assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 1)
    await assert.rejects(() => laundryApi.create(order()), /Select Laundry/)
    database.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('compact 58/80mm receipt/tag format, manual wallet labels, CSV escaping and PDF bytes', async () => {
  await fresh()
  await shift()
  const id = await laundryApi.create(order({ payment: payment(150, { method: 'GCash' }) }))
  const detail = await laundryApi.detail(id),
    settings = await settingsApi.get()
  const config = { paperWidth: 58, autoCut: false }
  for (const width of [58, 80]) {
    const receipt = buildLaundryReceipt(detail, settings, { ...config, paperWidth: width })
    assert.match(receipt.text, /BALANCE/)
    assert.match(receipt.text, /200.00/)
    assert.match(receipt.text, /unverified/)
    assert.doesNotMatch(receipt.text, /Subtotal|Discount|Status:|Contact:|Tendered|LAUNDRY ORDER/)
    assert.ok(receipt.preview.every(row => !row.tall), 'customer receipt uses normal-height text')
    assert.ok(receipt.preview.every((row) => row.text.length <= (width === 58 ? 32 : 48)))
    const tag = buildLaundryReceipt(detail, settings, { ...config, paperWidth: width }, true)
    assert.match(tag.text, /LAUNDRY TAG/)
    assert.match(tag.text, /offline\s+lookup/)
    assert.doesNotMatch(tag.text, /BALANCE/)
  }
  const report = await laundryReportsApi.report(localDate(), localDate())
  const csv = laundryCsv(report, settings, '2026-01-01', '2026-12-31')
  assert.match(csv, /150.00/)
  assert.match(csv, /Manual \/ unverified/)
  const poison = {
    ...report,
    balances: [{ order_number: '=HYPERLINK("bad")', customer_name: '@SUM(A1)', balance: 100 }],
  }
  assert.match(laundryCsv(poison, settings, 'a', 'b'), /'=HYPERLINK/)
  const pdf = buildReportPdf(laundryReportExport(report, settings, localDate(), localDate()))
  assert.equal(Buffer.from(pdf).subarray(0, 8).toString(), '%PDF-1.4')
  assert.match(Buffer.from(pdf).toString('latin1'), /Laundry report/)
  database.close()
})

test('compact receipts retain essential amounts, pickup, long names and latest payment without printing the ledger', async () => {
  await fresh()
  await shift()
  const settings = {
    ...await settingsApi.get(), storeName: 'Quick Wash', phone: '09000000000',
    address: 'Unneeded address', email: 'unneeded@example.com',
    receiptFooter: 'Thank you for choosing us!\r\n\r\nBring this receipt for pickup.', showLogoOnReceipt: true,
  }
  const unpaidId = await laundryApi.create(order({ notes: 'Internal notes '.repeat(40) }))
  const unpaid = await laundryApi.detail(unpaidId)
  const paidId = await laundryApi.create(order({
    addons: [{ id: 1, quantity: 1 }], discount: 25,
    payment: payment(350, { tendered: 400 }),
  }))
  const paid = await laundryApi.detail(paidId)
  const longName = 'Special wash with extra care for delicate white garments and bedding'
  const history = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, method: 'GCash', amount_cents: 750, tendered_cents: 750,
    reference: `transfer-${index}`, created_at: unpaid.created_at, staff: 'Staff',
  }))
  for (const paperWidth of [58, 80]) {
    const config = { paperWidth, autoCut: false }
    const receipt = buildLaundryReceipt(unpaid, settings, config)
    assert.match(receipt.text, /Order:.*\nCustomer: Customer One/)
    assert.match(receipt.text, /5kg Wash & Fold\s+350\.00/)
    assert.match(receipt.text, /TOTAL\s+\S+ 350\.00/)
    assert.match(receipt.text, /Paid\s+\S+ 0\.00/)
    assert.match(receipt.text, /BALANCE\s+\S+ 350\.00/)
    assert.doesNotMatch(receipt.text, /Unneeded|unneeded@|Internal notes/)
    assert.match(receipt.text, /QTY \/ SERVICE\s+AMOUNT/)
    assert.ok(receipt.preview.find(row => row.text.startsWith('Order:')).bold)
    assert.equal(receipt.preview.find(row => row.text.startsWith('Order:')).align, 'center')
    assert.ok(receipt.preview.find(row => row.text.startsWith('TOTAL')).bold)
    assert.match(receipt.text, /Thank you for choosing us!\nBring this receipt for pickup\./)
    const footer = receipt.preview.filter(row => row.text.trim()).slice(-2)
    assert.ok(footer.every(row => row.align === 'center' && !row.tall))
    assert.ok(receipt.preview.length <= 21, 'one-service receipt stays within 21 lines including footer and tear-bar feed')
    assert.equal(receipt.columns, paperWidth === 58 ? 32 : 48)

    const fallback = buildLaundryReceipt(unpaid, { ...settings, receiptFooter: ' \n\t ' }, config)
    assert.equal(fallback.preview.filter(row => row.text.trim()).at(-1).text, 'Thank you! Keep for pickup.')
    const longFooter = 'Please bring this receipt when collecting your laundry. Contact the store with any questions about your order.'
    const wrappedFooter = buildLaundryReceipt(unpaid, { ...settings, receiptFooter: longFooter }, config)
    assert.ok(wrappedFooter.text.replace(/\s+/g, ' ').includes(longFooter), 'configured footer is fully preserved')
    assert.ok(wrappedFooter.preview.every(row => row.text.length <= receipt.columns))
    const tag = buildLaundryReceipt(unpaid, settings, config, true)
    assert.doesNotMatch(tag.text, /Thank you for choosing us|Bring this receipt for pickup/)

    const cash = buildLaundryReceipt(paid, settings, config)
    assert.match(cash.text, /1x Detergent\s+25\.00/)
    assert.match(cash.text, /Subtotal\s+\S+ 375\.00/)
    assert.match(cash.text, /Discount\s+-\S+ 25\.00/)
    assert.match(cash.text, /Paid \(Cash\)\s+\S+ 350\.00/)
    assert.match(cash.text, /BALANCE\s+\S+ 0\.00/)
    assert.match(cash.text, /Change \(last cash\)\s+\S+ 50\.00/)

    const withHistory = buildLaundryReceipt({
      ...unpaid, paid_cents: 15000, payments: history, pickup_at: unpaid.created_at,
      items: [{ ...unpaid.items[0], name: longName }],
    }, settings, config)
    assert.ok(withHistory.text.replace(/\s+/g, ' ').includes(longName), 'long service names are never clipped')
    assert.match(withHistory.text, /Pickup:/)
    assert.match(withHistory.text, /Paid \(GCash\)\s+\S+ 150\.00/)
    assert.match(withHistory.text, /BALANCE\s+\S+ 200\.00/)
    assert.match(withHistory.text, /Ref \(GCash\): transfer-19/)
    assert.doesNotMatch(withHistory.text, /transfer-0\b|transfer-18\b/)
    assert.ok(withHistory.preview.length <= receipt.preview.length + 7, 'payment history does not grow the receipt')
    assert.ok(withHistory.preview.every(row => row.text.length <= (paperWidth === 58 ? 32 : 48)))
    const cut = buildLaundryReceipt(unpaid, settings, { ...config, autoCut: true })
    assert.deepEqual(Array.from(cut.bytes.slice(-3)), [0x1d, 0x56, 0x01])
  }
  await legacyArchive(unpaidId, 'Customer request')
  const cancelled = buildLaundryReceipt(await laundryApi.detail(unpaidId), settings, { paperWidth: 58, autoCut: false })
  assert.match(cancelled.text, /CANCELLED - NOTHING DUE/)
  assert.doesNotMatch(cancelled.text, /BALANCE/)
  database.close()
})

test('automatic laundry receipts use committed balances for paid/pay-later orders and payments, and printer faults preserve saves', async () => {
  await fresh()
  await shift()
  printerFailure = ''; printerConnections = 0; printerWrites = 0; printedDocuments.length = 0
  const notices = [], notify = (message, tone) => notices.push({ message, tone })
  try {
    const laterId = await laundryApi.create(order())
    await autoPrintLaundryReceipt(laterId, notify)
    assert.equal(printedDocuments.length, 1)
    assert.match(printedDocuments[0], /BALANCE\s+\S+ 350\.00/)

    const paidId = await laundryApi.create(order({ payment: payment(350) }))
    await autoPrintLaundryReceipt(paidId, notify)
    assert.equal(printedDocuments.length, 2)
    assert.match(printedDocuments[1], /BALANCE\s+\S+ 0\.00/)
    assert.equal(notices.at(-1).message, 'Receipt sent to printer.')

    await laundryApi.pay(laterId, payment(150, { method: 'Maya' }))
    await autoPrintLaundryReceipt(laterId, notify, 'payment')
    assert.equal(printedDocuments.length, 3)
    assert.match(printedDocuments[2], /BALANCE\s+\S+ 200\.00/)
    assert.equal(printerConnections, 3)
    assert.equal(printerWrites, 3)

    await laundryApi.pay(laterId, payment(200))
    printerFailure = 'write'
    await assert.doesNotReject(() => autoPrintLaundryReceipt(laterId, notify, 'payment'))
    assert.equal((await laundryApi.detail(laterId)).paid_cents, 35000, 'payment remains committed after print failure')
    assert.equal(printerWrites, 4, 'failed writes are not retried automatically')
    assert.equal(notices.at(-1).message, 'Payment applied. Receipt could not print; retry from order details.')
    assert.equal(notices.at(-1).tone, 'error')

    printerFailure = 'connect'
    await assert.doesNotReject(() => autoPrintLaundryReceipt(paidId, notify))
    assert.equal(printerWrites, 4, 'connection failure never writes a document')
    assert.equal(notices.at(-1).message, 'Order saved. Receipt could not print; retry from order details.')
    assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 2)
    assert.equal(one('SELECT COUNT(*) AS n FROM laundry_payments').n, 3, 'printing does not recreate orders or payments')
  } finally {
    printerFailure = ''
    database.close()
  }
})

test('laundry defaults contain all requested fixed prices and discounts, seed once, and preserve edits/removals', async () => {
  await fresh(':memory:', true)
  const services = await laundryApi.catalog('services'), addons = await laundryApi.catalog('addons')
  const expected = { '1-DRY': 6500, '1-FOLD': 3000, '1-WASH': 8000, 'Bedsheets / Linens': 18500, Comforter: 20000, 'Drop Off': 17500, 'Extra Detergent': 1500, 'Extra Fabcon': 1500, 'Extra Wash / Rinse / Dry': 2000, 'Rush Order': 24500, 'Self-Service': 14500 }
  assert.equal(services.length + addons.length, 11)
  for (const row of [...services, ...addons]) {
    assert.equal(row.price_cents, expected[row.name])
    assert.equal(row.pricing, 'fixed')
    assert.ok(['Core services', 'Special-item services', 'Optional add-ons'].includes(row.category))
  }
  const discounts = await laundryPricingApi.discounts()
  assert.equal(discounts.length, 4)
  assert.equal(discounts.find(row => row.name === '10th Visit').value, 10000)
  assert.equal(discounts.find(row => row.name === '5th Visit').value, 2000)
  assert.equal(discounts.find(row => row.name === 'Student').value, 3000)
  assert.equal(discounts.find(row => row.name === 'Wednesday Promo').weekday, 3)
  const dry = services.find(row => row.name === '1-DRY'), comforter = services.find(row => row.name === 'Comforter')
  await laundryApi.saveCatalog('services', { ...dry, pricing: 'load', price_cents: 9900, category: 'Owner category', is_active: 0 })
  await laundryApi.removeCatalog('services', comforter.id)
  const student = discounts.find(row => row.name === 'Student')
  await laundryPricingApi.saveDiscount({ ...student, value: 2500, is_active: 0 })
  await laundryPricingApi.removeDiscount(discounts.find(row => row.name === 'Wednesday Promo').id)
  await initializeDatabase(); await seedDatabase(); await seedDatabase()
  const saved = (await laundryApi.catalog('services', true)).find(row => row.id === dry.id)
  assert.equal(saved.price_cents, 9900); assert.equal(saved.pricing, 'load'); assert.equal(saved.category, 'Owner category'); assert.equal(saved.is_active, 0)
  assert.equal((await laundryApi.catalog('services', true)).some(row => row.id === comforter.id), false)
  assert.equal((await laundryPricingApi.discounts(true)).find(row => row.id === student.id).value, 2500)
  assert.equal((await laundryPricingApi.discounts(true)).length, 3)
  assert.equal(one('SELECT defaults_version FROM laundry_configuration').defaults_version, 1)
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})

test('default seeding rolls back interruptions, preserves preexisting named services and retail data, and never seeds retail mode', async () => {
  database = new DatabaseSync(':memory:'); database.exec('PRAGMA foreign_keys=ON'); actorId = 1
  await initializeDatabase(); await seedDatabase()
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_services').n, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_discounts').n, 0)
  run("INSERT INTO laundry_services(name,pricing,price_cents) VALUES('1-DRY','piece',1234)")
  run("INSERT INTO categories(id,name) VALUES(1,'Retail original')")
  const at = new Date().toISOString()
  run("INSERT INTO products(id,sku,name,category_id,cost_price,selling_price,stock_quantity,reorder_level,created_at,updated_at) VALUES(1,'KEEP','Retail original',1,50,100,10,1,?,?)", [at, at])
  failAt = 2
  await assert.rejects(() => businessApi.select('laundry', 'SELECT LAUNDRY'), /interruption/)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_services').n, 1)
  assert.equal(one('SELECT defaults_version FROM laundry_configuration').defaults_version, 0)
  await businessApi.select('laundry', 'SELECT LAUNDRY')
  assert.equal(one("SELECT price_cents FROM laundry_services WHERE name='1-DRY'").price_cents, 1234)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_services').n, 8)
  await businessApi.select('retail', 'SELECT RETAIL'); await businessApi.select('laundry', 'SELECT LAUNDRY')
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_services').n, 8)
  assert.equal(one('SELECT selling_price FROM products WHERE id=1').selling_price, 100)
  assert.equal(one('SELECT stock_quantity FROM products WHERE id=1').stock_quantity, 10)
  database.close()
})

test('named discounts allocate to their eligible services, preserve history, obey stacking, and reconcile payment/change/reports', async () => {
  await fresh(); await shift()
  await laundryApi.saveCatalog('services', { id: 1, name: 'Wash & Fold', pricing: 'kg', price_cents: 7000, category: 'Core', is_active: 1 })
  const student = (await laundryPricingApi.discounts()).find(row => row.name === 'Student')
  await laundryPricingApi.saveDiscount({ ...student, scope: 'addons' })
  await laundryPricingApi.saveDiscount({ ...student, id: undefined, name: 'Core half price', kind: 'percent', value: 5000, scope: 'categories', categories: ['Core'] })
  const half = (await laundryPricingApi.discounts()).find(row => row.name === 'Core half price')
  const input = order({ addons: [{ id: 1, quantity: 1 }], discountIds: [student.id, half.id], payment: payment(100, { tendered: 150 }) })
  await assert.rejects(() => laundryApi.create(input), /cannot be combined/)
  await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), allow_stacking: 1 })
  const id = await laundryApi.create(input), detail = await laundryApi.detail(id)
  assert.equal(detail.subtotal_cents, 37500); assert.equal(detail.discount_cents, 20000); assert.equal(detail.total_cents, 17500)
  assert.equal(detail.paid_cents, 10000); assert.equal(detail.total_cents - detail.paid_cents, 7500)
  assert.equal(detail.payments[0].tendered_cents - detail.payments[0].amount_cents, 5000)
  assert.equal(detail.discounts.reduce((sum, row) => sum + row.amount_cents, 0), 20000)
  const report = await laundryReportsApi.report(localDate(), localDate())
  assert.equal(report.services.find(row => row.name === 'Wash & Fold').net_value, 17500)
  assert.equal(report.services.find(row => row.name === 'Detergent').net_value, 0, 'addon discount is not allocated against services')
  await laundryPricingApi.saveDiscount({ ...half, name: 'Changed later', value: 1000, is_active: 0 })
  await laundryPricingApi.removeDiscount(student.id); await laundryApi.removeCatalog('services', 1)
  const saved = await laundryApi.detail(id)
  assert.equal(saved.discounts.find(row => row.discount_id === half.id).name, 'Core half price')
  assert.equal(saved.total_cents, 17500); assert.equal(saved.items[0].name, 'Wash & Fold')
  assert.throws(() => run('UPDATE laundry_order_discounts SET amount_cents=0 WHERE order_id=?', [id]), /immutable/)
  assert.throws(() => run('DELETE FROM laundry_order_discounts WHERE order_id=?', [id]), /cannot be deleted/)
  const receipt = buildLaundryReceipt(saved, await settingsApi.get(), { paperWidth: 58, autoCut: false })
  assert.match(receipt.text.replace(/\s+/g, ' '), /Core half price/)
  database.close()
})

test('loyalty counts qualified completed visits, reserves each reward once under concurrent checkouts, and cancellation releases it', async () => {
  await fresh(); await shift()
  for (let visit = 0; visit < 4; visit++) {
    const id = await laundryApi.create(order({ payment: payment(350) }))
    await laundryApi.status(id, 'Ready for Pickup'); await complete(id)
  }
  const received = await laundryApi.create(order()), cancelled = await laundryApi.create(order())
  await legacyArchive(cancelled, 'Not a visit')
  const context = await laundryPricingApi.context(1), fifth = context.discounts.find(row => row.name === '5th Visit')
  assert.equal(context.visits, 4, 'received and cancelled orders do not count')
  const results = await Promise.allSettled([laundryApi.create(order({ discountIds: [fifth.id] })), laundryApi.create(order({ discountIds: [fifth.id] }))])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  const reserved = results.find(row => row.status === 'fulfilled').value
  assert.equal((await laundryApi.detail(reserved)).discount_cents, 7000)
  assert.equal((await laundryPricingApi.context(1)).visits, 4)
  await assert.rejects(() => laundryApi.create(order({ discountIds: [fifth.id] })), /reserved|already used/)
  await legacyArchive(reserved, 'Changed plans')
  const fifthOrder = await laundryApi.create(order({ discountIds: [fifth.id], payment: payment(280) }))
  await laundryApi.status(fifthOrder, 'Ready for Pickup'); await complete(fifthOrder)
  assert.equal((await laundryPricingApi.context(1)).visits, 5)
  await assert.rejects(() => laundryApi.create(order({ discountIds: [fifth.id] })), /Requires qualifying visit/)
  assert.equal((await laundryApi.detail(reserved)).discounts[0].name, '5th Visit', 'cancelled discount history is retained')
  assert.equal((await laundryApi.detail(received)).status, 'Received')
  for (let visit = 5; visit < 9; visit++) {
    const id = await laundryApi.create(order({ payment: payment(350) }))
    await laundryApi.status(id, 'Ready for Pickup'); await complete(id)
  }
  const tenth = (await laundryPricingApi.discounts()).find(row => row.name === '10th Visit')
  const free = await laundryApi.create(order({ discountIds: [tenth.id] }))
  assert.equal((await laundryApi.detail(free)).total_cents, 0)
  await laundryApi.status(free, 'Ready for Pickup'); await complete(free)
  assert.equal((await laundryPricingApi.context(1)).visits, 10, 'a fully discounted service can qualify using its original subtotal')
  await laundryApi.status(free, 'Received', 'Pickup was selected on the wrong order', { correction: true })
  assert.equal((await laundryPricingApi.context(1)).visits, 9)
  await assert.rejects(() => laundryApi.create(order({ discountIds: [tenth.id] })), /reserved|already used/)
  assert.equal((await laundryApi.detail(free)).discounts[0].name, '10th Visit')
  await laundryApi.status(free, 'Ready for Pickup'); await complete(free)
  assert.equal((await laundryPricingApi.context(1)).visits, 10)
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()
})

test('visit qualification, payment requirement, minimum and repeating milestones are configurable', async () => {
  await fresh(); await shift()
  const unpaid = await laundryApi.create(order()), paid = await laundryApi.create(order({ payment: payment(350) }))
  await laundryApi.status(unpaid, 'Ready for Pickup'); await laundryApi.status(paid, 'Ready for Pickup')
  assert.equal((await laundryPricingApi.context(1)).visits, 0)
  await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), visit_status: 'Ready for Pickup' })
  assert.equal((await laundryPricingApi.context(1)).visits, 1)
  await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), visit_require_paid: 0 })
  assert.equal((await laundryPricingApi.context(1)).visits, 2)
  await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), visit_minimum_cents: 40000 })
  assert.equal((await laundryPricingApi.context(1)).visits, 0)
  await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), visit_minimum_cents: 1 })
  const fifth = (await laundryPricingApi.discounts()).find(row => row.name === '5th Visit')
  await laundryPricingApi.saveDiscount({ ...fifth, visit_number: 1, repeat_every: 2 })
  const id = await laundryApi.create(order({ discountIds: [fifth.id] }))
  assert.equal((await laundryApi.detail(id)).discount_cents, 7000, 'third visit is eligible for an every-second-visit reward starting at visit one')
  await complete(paid)
  assert.equal((await laundryPricingApi.context(1)).visits, 2, 'ready to completed still counts once')
  database.close()
})

test('discount day/scope rules, fixed caps and stacked percentages never produce negative totals or lose cents', async () => {
  await fresh()
  const context = await laundryPricingApi.context(1), promo = context.discounts.find(row => row.name === 'Wednesday Promo')
  const services = priceLines([{ id: 1, quantity: 1 }], await laundryApi.catalog('services'))
  const wednesday = new Date(2026, 9, 21, 12), thursday = new Date(2026, 9, 22, 12)
  assert.equal(laundryDiscountTotals(services, [], 0, [promo.id], context, wednesday).total, 4000)
  assert.throws(() => laundryDiscountTotals(services, [], 0, [promo.id], context, thursday), /Not available today/)
  const student = context.discounts.find(row => row.name === 'Student')
  const small = [{ ...services[0], total_cents: 500 }]
  const capped = laundryDiscountTotals(small, [], 0, [student.id], context)
  assert.equal(capped.discount, 500); assert.equal(capped.total, 0)
  assert.throws(() => laundryDiscountTotals(services, [], 1, [student.id], context), /cannot be combined/)
  const synthetic = { ...context, rules: { ...context.rules, allow_stacking: 1 }, discounts: [
    { ...student, id: 80, kind: 'percent', value: 3333 }, { ...student, id: 81, kind: 'percent', value: 10000 },
  ] }
  const lines = [1, 2, 3].map(id => ({ ...services[0], id, total_cents: 1 }))
  const all = laundryDiscountTotals(lines, [], 0, [80, 81], synthetic)
  assert.equal(all.total, 0); assert.equal(all.discount, 3)
  assert.equal(all.lineDiscounts.reduce((sum, row) => sum + row.amount_cents, 0), 3)
  assert.ok(all.lineDiscounts.every(row => row.amount_cents === 1))
  assert.throws(() => laundryDiscountTotals(services, [], 0, [80, 80], synthetic), /only once/)
  assert.throws(() => laundryDiscountTotals(services, [], 0, [80], { ...synthetic, discounts: [{ ...synthetic.discounts[0], scope: 'addons' }] }), /does not apply/)
  database.close()
})

test('discount management is permission guarded; cashiers can apply owner-defined discounts but cannot bypass manual limits', async () => {
  await fresh()
  const student = (await laundryPricingApi.discounts()).find(row => row.name === 'Student')
  await laundryPricingApi.saveDiscount({ ...student, name: 'Owner free service', id: undefined, kind: 'percent', value: 10000 })
  const free = (await laundryPricingApi.discounts()).find(row => row.name === 'Owner free service')
  actorId = 3
  await assert.rejects(() => laundryPricingApi.saveDiscount({ ...student, value: 1000 }), /manager|permission/)
  await assert.rejects(() => laundryPricingApi.removeDiscount(student.id), /manager|permission/)
  const rules = await laundryPricingApi.rules()
  await assert.rejects(() => laundryPricingApi.saveRules({ ...rules, allow_stacking: 1 }), /admin|permission/)
  await assert.rejects(() => laundryApi.create(order({ discount: 50 })), /exceeds the store limit/)
  const id = await laundryApi.create(order({ discountIds: [free.id] }))
  assert.equal((await laundryApi.detail(id)).total_cents, 0)
  database.close()
})

test('stale register quotes and price/rule changes before commit roll back without charging the customer', async () => {
  await fresh(); await shift()
  const student = (await laundryPricingApi.discounts()).find(row => row.name === 'Student')
  const context = await laundryPricingApi.context(1)
  const lines = priceLines(order().items, await laundryApi.catalog('services'))
  const input = order({ discountIds: [student.id], pricingKey: laundryPricingKey(lines, [], context, [student.id]), payment: payment(100) })
  await laundryPricingApi.saveDiscount({ ...student, value: 2000 })
  await assert.rejects(() => laundryApi.create(input), /Prices or discount eligibility changed/)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 0)
  beforeTransaction = () => run('UPDATE laundry_services SET price_cents=8000 WHERE id=1')
  await assert.rejects(() => laundryApi.create(order()), /Service prices changed/)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 0)
  beforeTransaction = () => run('UPDATE laundry_discounts SET revision=revision+1 WHERE id=?', [student.id])
  await assert.rejects(() => laundryApi.create(order({ discountIds: [student.id], payment: payment(100) })), /Discount rules changed/)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_orders').n, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_payments').n, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM laundry_order_discounts').n, 0)
  assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok')
  database.close()
})

test('offline reopening retains configured discounts, prices, rule settings and pending loyalty reservations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sellix-pricing-'))
  const path = join(directory, 'shop.sqlite')
  try {
    await fresh(path)
    const student = (await laundryPricingApi.discounts()).find(row => row.name === 'Student')
    await laundryPricingApi.saveDiscount({ ...student, value: 2500, visit_number: 1 })
    await laundryPricingApi.saveRules({ ...await laundryPricingApi.rules(), allow_stacking: 1 })
    const id = await laundryApi.create(order({ discountIds: [student.id] }))
    database.close()
    database = new DatabaseSync(path); database.exec('PRAGMA foreign_keys=ON')
    await initializeDatabase(); await seedDatabase()
    assert.equal((await laundryApi.detail(id)).discount_cents, 2500)
    assert.equal((await laundryPricingApi.discounts()).find(row => row.id === student.id).value, 2500)
    assert.equal((await laundryPricingApi.rules()).allow_stacking, 1)
    assert.equal((await laundryApi.catalog('services')).find(row => row.id === 1).price_cents, 7000)
    assert.equal(one('SELECT defaults_version FROM laundry_configuration').defaults_version, 1)
    assert.equal((await laundryPricingApi.context(1)).reservations[0].order_id, id)
    await assert.rejects(() => laundryApi.create(order({ discountIds: [student.id] })), /reserved|already used/)
    assert.equal(one('PRAGMA integrity_check').integrity_check, 'ok')
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally {
    try { database.close() } catch { /* The reopen itself may have failed. */ }
    rmSync(directory, { recursive: true, force: true })
  }
})
