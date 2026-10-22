// Production TS + real scratch SQLite. Native transports are explicit test doubles;
// these tests do not claim to exercise Windows drivers or physical printers/drawers.
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { webcrypto } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'sellix-platform-'))
let db, failAt = -1, failRead = false, failMigration = false, actorId = 1, printer
const storage = new Map()
const context = vm.createContext({
  console: { ...console, log() {}, info() {}, error() {} }, crypto: webcrypto,
  TextEncoder, TextDecoder, Uint8Array, Blob, Date, setTimeout, clearTimeout, window: {},
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: key => storage.delete(key) },
})
const bridge = {
  query: async (sql, args = []) => {
    if (failRead && /^SELECT id FROM sales WHERE invoice_number/.test(sql)) { failRead = false; throw new Error('Interrupted result delivery') }
    return { values: db.prepare(sql).all(...args) }
  },
  run: async (sql, args = []) => {
    const result = db.prepare(sql).run(...args)
    return { changes: { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) } }
  },
  execute: async sql => {
    if (failMigration && sql.startsWith('ALTER TABLE sales ADD COLUMN notes')) throw new Error('Disk is full')
    db.exec(sql)
    return {}
  },
  executeSet: async statements => {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const [index, entry] of statements.entries()) {
        if (index === failAt) { failAt = -1; throw new Error('Interrupted sale') }
        db.prepare(entry.statement).run(...entry.values)
      }
      db.exec('COMMIT')
      return {}
    } catch (error) { db.exec('ROLLBACK'); throw error }
  },
  isTransactionActive: async () => ({ result: false }),
}
const mocks = {
  'src/database/sqlite.ts': { initDatabase: async () => bridge, querySQL: bridge.query, executeSQL: bridge.run },
  'src/utils/session.ts': { getStoredUser: () => ({ id: String(actorId), fullName: 'Register Admin' }) },
  '@capacitor/core': { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } },
  '@tauri-apps/api/core': {
    isTauri: () => Boolean(context.window.__TAURI_INTERNALS__),
    invoke: (command, args) => context.window.__TAURI_INTERNALS__.invoke(command, args),
  },
  'src/services/printer/index.ts': {
    ensurePrinterConnected: async () => { if (printer.getStatus() !== 'connected') await printer.connect({ id: 'Thermal', name: 'Thermal', type: 'windows' }) },
    getPrinterService: () => printer,
  },
}
const modules = new Map()
function getModule(id) {
  if (modules.has(id)) return modules.get(id)
  const mock = mocks[id]
  const module = mock ? new vm.SyntheticModule(Object.keys(mock), function () {
    for (const [key, value] of Object.entries(mock)) this.setExport(key, value)
  }, { context, identifier: id }) : new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(join(root, id), 'utf8')), { context, identifier: id })
  modules.set(id, module)
  return module
}
async function load(id) {
  const module = getModule(id)
  if (module.status === 'unlinked') await module.link((specifier, parent) => {
    if (!specifier.startsWith('.')) return getModule(specifier)
    const path = resolve(root, dirname(parent.identifier), specifier)
    const file = existsSync(`${path}.ts`) ? `${path}.ts` : join(path, 'index.ts')
    return getModule(file.slice(root.length + 1).replaceAll('\\', '/'))
  })
  if (module.status === 'linked') await module.evaluate()
  return module.namespace
}
const { initializeDatabase } = await load('src/database/database.ts')
const { salesApi } = await load('src/api/salesApi.ts')
const { productApi } = await load('src/api/productApi.ts')
const { categoryApi } = await load('src/api/categoryApi.ts')
const { settingsApi } = await load('src/api/settingsApi.ts')
const { heldOrdersApi } = await load('src/api/heldOrdersApi.ts')
const { adjustmentsApi } = await load('src/api/adjustmentsApi.ts')
const { openCashDrawer } = await load('src/services/drawer.ts')
const { WindowsPrinterService } = await load('src/services/printer/windowsPrinter.ts')
const { buildReceipt } = await load('src/services/printer/receiptFormatter.ts')
const { hashPassword, verifyPassword, sha256 } = await load('src/utils/hash.ts')
const { authApi } = await load('src/api/authApi.ts')
const { userApi } = await load('src/api/userApi.ts')
const { seedDatabase } = await load('src/database/seed.ts')
const { getPrinterConfig, savePrinterConfig } = await load('src/utils/printerConfig.ts')
const { buildDrawerKickCommand } = await load('src/services/printer/cashDrawer.ts')
const { desktopDatabase } = await load('src/database/desktop.ts')
const one = (sql, args = []) => db.prepare(sql).get(...args)
const run = (sql, args = []) => db.prepare(sql).run(...args)
const key = () => webcrypto.randomUUID()
const payload = extra => ({ requestId: key(), discount: 0, orderType: 0, paymentMethod: 0, amountReceived: 250, items: [{ productId: 1, quantity: 2 }], ...extra })

async function fresh(path = ':memory:') {
  db?.close()
  db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON')
  actorId = 1; failAt = -1; failRead = false; failMigration = false
  await initializeDatabase()
  run("INSERT INTO users(id,email,full_name,password_hash,role,is_active) VALUES(1,'owner@store.local','Register Admin','unused','admin',1)")
  await seedDatabase() // Must not resurrect a default manager on an established database.
  run('UPDATE store_settings SET tax_rate=0.12, business_setup_complete=1')
  await categoryApi.create({ name: 'Meals', isActive: true })
  await productApi.create({ sku: 'CHICKEN', name: 'Chicken Meal', categoryId: 1, costPrice: 40, sellingPrice: 100, stockQuantity: 10, reorderLevel: 2, isActive: true })
  printer = new WindowsPrinterService()
  context.window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    if (command === 'printers') return args.name ? null : [{ id: 'Thermal', name: 'Thermal', type: 'windows' }]
    if (command === 'print_raw') return 1
    throw new Error(`Unexpected command ${command}`)
  } }
}
after(() => { db?.close(); rmSync(temporary, { recursive: true, force: true }) })

test('product create/edit and v9 migration preserve records, stock and plugin version', async () => {
  await fresh()
  const product = await productApi.get(1)
  await productApi.update(1, { sku: product.sku, name: 'Chicken & Rice', categoryId: 1, costPrice: 40, sellingPrice: 110, stockQuantity: 10, reorderLevel: 2, isActive: true })
  await initializeDatabase()
  await initializeDatabase()
  assert.equal((await productApi.get(1)).name, 'Chicken & Rice')
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 10)
  assert.equal(one('SELECT MAX(version) AS v FROM sellix_schema').v, 11)
  assert.equal(one('PRAGMA user_version').user_version, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM users').n, 1)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('cash checkout, discount, history, notes and 58/80mm receipts agree', async () => {
  await fresh()
  const sale = await salesApi.create(payload({ discount: 20, notes: 'No gravy; pack separately' }))
  assert.equal(sale.subtotal, 200)
  assert.equal(sale.tax, 21.6)
  assert.equal(sale.total, 201.6)
  assert.equal(sale.change, 48.4)
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 8)
  assert.equal((await salesApi.get(sale.id)).notes, 'No gravy; pack separately')
  assert.equal((await salesApi.list({ page: 1, pageSize: 20 })).items.length, 1)
  const settings = await settingsApi.get()
  for (const width of [58, 80]) {
    const receipt = buildReceipt(sale, settings, width)
    const text = receipt.preview.map(line => line.text).join('\n')
    assert.match(text, /No gravy/)
    assert.match(text, /Chicken Meal/)
    assert.match(text, /Discount/)
    assert.match(text, /201.60/)
    assert.ok(receipt.bytes.length > 100)
  }
})

test('duplicate concurrent requests commit exactly one sale and survive a closed/reopened database', async () => {
  const path = join(temporary, 'persistent.db')
  await fresh(path)
  const input = payload()
  const sales = await Promise.all([salesApi.create(input), salesApi.create(input), salesApi.create(input)])
  assert.equal(new Set(sales.map(sale => sale.id)).size, 1)
  assert.equal(one('SELECT COUNT(*) AS n FROM sales').n, 1)
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 8)
  db.close(); db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON')
  await initializeDatabase()
  assert.equal((await salesApi.create(input)).id, sales[0].id)
  await assert.rejects(salesApi.create({ ...input, discount: 10 }), /different details/)
  assert.equal(one('SELECT COUNT(*) AS n FROM payments').n, 1)
})

test('interrupted transactions roll back sale, payment, request, audit and inventory; retry succeeds', async () => {
  await fresh()
  const input = payload()
  failAt = 3
  await assert.rejects(salesApi.create(input), /could not be confirmed/)
  assert.equal(one('SELECT COUNT(*) AS n FROM sales').n, 0)
  assert.equal(one('SELECT COUNT(*) AS n FROM checkout_requests').n, 0)
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 10)
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='sale'").n, 0)
  assert.equal((await salesApi.create(input)).status, 'Completed')
  const second = payload()
  failRead = true
  await assert.rejects(salesApi.create(second), /Sale saved/)
  const recovered = await salesApi.create(second)
  assert.equal(recovered.status, 'Completed')
  assert.equal(one('SELECT COUNT(*) AS n FROM sales').n, 2)
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 6)
})

test('underpayment, missing retry IDs and inactive users never commit; migration errors are visible', async () => {
  await fresh()
  await assert.rejects(salesApi.create(payload({ amountReceived: 1 })))
  await assert.rejects(salesApi.create(payload({ requestId: undefined })), /request ID/)
  run('UPDATE users SET is_active=0 WHERE id=1')
  await assert.rejects(salesApi.create(payload()), /no longer active/)
  assert.equal(one('SELECT COUNT(*) AS n FROM sales').n, 0)
  db.exec('ALTER TABLE sales DROP COLUMN notes')
  failMigration = true
  await assert.rejects(initializeDatabase(), /Disk is full/)
  failMigration = false
  await initializeDatabase()
  db.exec('INSERT INTO sellix_schema VALUES(100,\'future\')')
  await assert.rejects(initializeDatabase(), /newer Sellix version/)
})

test('printer failure leaves the sale committed; drawer commands require permission and are audited', async () => {
  await fresh()
  const sale = await salesApi.create(payload())
  context.window.__TAURI_INTERNALS__.invoke = async command => { if (command === 'printers') return null; throw new Error('Printer disconnected') }
  await printer.connect({ id: 'Thermal', name: 'Thermal', type: 'windows' })
  await assert.rejects(printer.printReceipt(sale, await settingsApi.get(), { paperWidth: 58, autoCut: false }), /disconnected/)
  assert.equal(printer.getStatus(), 'disconnected')
  assert.equal(one('SELECT status FROM sales').status, 1)
  await assert.rejects(openCashDrawer(), /disconnected/)
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='drawer'").n, 2)
  run("UPDATE users SET role='unknown' WHERE id=1")
  await assert.rejects(openCashDrawer(), /permission/)
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='drawer'").n, 2)
})

test('held restaurant orders retain notes and leave stock untouched', async () => {
  await fresh()
  await heldOrdersApi.hold({ customerId: null, customerName: null, orderType: 1, discount: 0, lines: [{ productId: 1, name: 'Chicken Meal', quantity: 2, unitPrice: 100 }], subtotal: 200, total: 224, notes: 'Sauce separate' })
  assert.equal((await heldOrdersApi.list())[0].notes, 'Sauce separate')
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 10)
})

test('refunds and voids preserve history, restore stock and require an active authorized approver', async () => {
  await fresh()
  const first = await salesApi.create(payload())
  const input = { saleId: first.id, items: [{ saleItemId: first.items[0].id, productId: 1, quantity: 1 }], reason: 'Customer return', method: 0, restock: true, approvedBy: { id: 1, fullName: 'Register Admin' } }
  const refund = await adjustmentsApi.refund(input)
  assert.equal(refund.amount, 112)
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 9)
  assert.equal((await salesApi.get(first.id)).refundStatus, 'Partial')
  const second = await salesApi.create(payload())
  await adjustmentsApi.void({ saleId: second.id, reason: 'Wrong order entered', approvedBy: input.approvedBy })
  assert.equal((await salesApi.get(second.id)).status, 'Voided')
  assert.equal(one('SELECT stock_quantity FROM products').stock_quantity, 9)
  assert.equal(one('SELECT COUNT(*) AS n FROM sales').n, 2)
  run("UPDATE users SET role='cashier' WHERE id=1")
  await assert.rejects(adjustmentsApi.refund(input), /approval/)
})

test('drawer timing conversion preserves existing Android pulses and uses ESC/POS 2ms units', () => {
  storage.set('sellix.printer.config', JSON.stringify({ drawerOnMs: 25, drawerOffMs: 250, drawerPin: 1 }))
  const config = getPrinterConfig()
  assert.equal(config.drawerOnMs, 50)
  assert.equal(config.drawerOffMs, 500)
  assert.deepEqual(Array.from(buildDrawerKickCommand(config)), [27, 112, 1, 25, 250])
  savePrinterConfig(config)
  assert.equal(getPrinterConfig().drawerOffMs, 500)
  storage.clear()
})

test('desktop SQLite adapter sends parameterized values and one transaction per statement set', async () => {
  const calls = []
  context.window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    calls.push({ command, args })
    return args.operation === 'query' ? { values: [{ n: 1 }] } : { changes: { changes: 1, lastId: 7 } }
  } }
  await desktopDatabase.open()
  await desktopDatabase.run('INSERT INTO products(name) VALUES (?)', ["Chicken's meal"])
  const result = await desktopDatabase.query('SELECT ? AS n', [1])
  await desktopDatabase.executeSet([{ statement: 'UPDATE products SET name=?', values: ['Meal'] }])
  await desktopDatabase.close()
  assert.equal(result.values[0].n, 1)
  assert.equal(calls[1].args.values[0], "Chicken's meal")
  assert.equal(calls[3].args.operation, 'set')
  assert.equal(calls[3].args.transaction, true)
  assert.equal(calls.length, 5)
})

test('credentials use random salts, reject wrong passwords, and upgrade legacy login hashes on desktop', async () => {
  await fresh()
  const first = await hashPassword('CorrectHorse9!')
  const second = await hashPassword('CorrectHorse9!')
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('CorrectHorse9!', first), true)
  assert.equal(await verifyPassword('wrong', first), false)
  assert.equal(await verifyPassword('anything', 'pbkdf2-sha256$999999999$invalid$invalid'), false)
  run('UPDATE users SET password_hash=? WHERE id=1', [await sha256('LegacyPassword9!')])
  const result = await authApi.login('owner@store.local', 'LegacyPassword9!')
  assert.equal(result.user.id, '1')
  assert.match(one('SELECT password_hash FROM users').password_hash, /^pbkdf2-sha256\$/)
  await assert.rejects(authApi.login('admin@sellix.local', 'Admin123!'), /Invalid email/)
})

test('salted manager PINs retain uniqueness, verify approvals and reject partial user creation', async () => {
  await fresh()
  const manager = await userApi.create({ email: 'manager@store.local', fullName: 'Manager', role: 'manager', isActive: true, password: 'ManagerPassword9!', pin: '3456' })
  assert.equal((await authApi.verifyApproval('3456', 'sales.refund')).id, manager.id)
  await assert.rejects(userApi.create({ email: 'second@store.local', fullName: 'Second', role: 'manager', isActive: true, password: 'AnotherPassword9!', pin: '3456' }), /already uses this PIN/)
  assert.equal(one('SELECT COUNT(*) AS n FROM users').n, 2)
  await assert.rejects(userApi.create({ email: 'short@store.local', fullName: 'Short', role: 'cashier', isActive: true, password: '1234' }), /8 characters/)
  run('UPDATE users SET password_hash=? WHERE id=1', [await hashPassword('CurrentPassword9!')])
  await authApi.changePassword('CurrentPassword9!', 'NewPassword9!')
  assert.equal(await verifyPassword('NewPassword9!', one('SELECT password_hash FROM users WHERE id=1').password_hash), true)
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_logs WHERE description='Changed sign-in password'").n, 1)
  const concurrent = await Promise.allSettled(['first', 'second'].map(name => userApi.create({ email: `${name}@store.local`, fullName: name, role: 'manager', isActive: true, password: 'StrongPassword9!', pin: '9876' })))
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(one('SELECT COUNT(*) AS n FROM users').n, 3)
})
