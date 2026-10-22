// Acceptance-only SQLite transport. Never opens the Android POS database.
import { createServer } from 'vite'
import { DatabaseSync } from 'node:sqlite'
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
const bridge = {
  query: async (sql, values = []) => ({ values: db.prepare(sql).all(...values) }),
  run: async (sql, values = []) => {
    const r = db.prepare(sql).run(...values)
    return { changes: { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) } }
  },
  execute: async (sql) => {
    db.exec(sql)
    return {}
  },
  executeSet: async (statements) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of statements) db.prepare(row.statement).run(...row.values)
      db.exec('COMMIT')
      return {}
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
  isTransactionActive: async () => ({ result: false }),
}
const context = vm.createContext({ console, crypto: webcrypto, TextEncoder })
const modules = new Map()
function moduleFor(id) {
  if (modules.has(id)) return modules.get(id)
  const mock =
    id === 'src/database/sqlite.ts'
      ? { initDatabase: async () => bridge, querySQL: bridge.query, executeSQL: bridge.run }
      : id === 'src/services/platform.ts'
        ? { isDesktop: () => false, hasLocalDatabase: () => true, platformName: () => 'android', desktopInvoke: async () => { throw new Error('Desktop unavailable in acceptance preview') } }
        : null
  const module = mock
    ? new vm.SyntheticModule(
        Object.keys(mock),
        function () {
          for (const [key, value] of Object.entries(mock)) this.setExport(key, value)
        },
        { context, identifier: id },
      )
    : new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(resolve(root, id), 'utf8')), {
        context,
        identifier: id,
      })
  modules.set(id, module)
  return module
}
async function load(id) {
  const module = moduleFor(id)
  if (module.status === 'unlinked')
    await module.link((name, parent) =>
      moduleFor(
        resolve(root, dirname(parent.identifier), name)
          .slice(root.length + 1)
          .replaceAll('\\', '/') + '.ts',
      ),
    )
  if (module.status === 'linked') await module.evaluate()
  return module.namespace
}
await (await load('src/database/database.ts')).initializeDatabase()
await (await load('src/database/seed.ts')).seedDatabase()
// Explicit fixtures used only by this acceptance harness.
await bridge.run(
  "INSERT INTO customers(customer_code,full_name,phone,created_at) VALUES ('TEST-1','Alex Reyes','09123456789',?)",
  [new Date().toISOString()],
)
await bridge.run(
  "INSERT INTO laundry_services(name,pricing,price_cents) VALUES ('Wash, Dry & Fold','kg',7000)",
)
await bridge.run("INSERT INTO laundry_addons(name,pricing,price_cents) VALUES ('Extra rinse','fixed',2500)")

// Opt-in retail acceptance fixtures, confined to this in-memory test database.
if (process.env.SELLIX_UI_RETAIL === '1') {
  await bridge.run("UPDATE store_settings SET business_setup_complete=1, business_type='retail'")
  await bridge.run("INSERT INTO categories(id,name) VALUES(1,'Chicken Meals')")
  await bridge.run("INSERT INTO products(id,sku,name,category_id,cost_price,selling_price,stock_quantity,reorder_level,is_active,created_at,updated_at) VALUES(1,'CHICKEN','Chicken Meal',1,40,100,20,2,1,?,?)", [new Date().toISOString(), new Date().toISOString()])
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: {} },
  plugins: [
    {
      name: 'sellix-acceptance-sqlite-bridge',
      enforce: 'pre',
      load(id) {
        if (id.replaceAll('\\', '/') !== resolve(root, 'src/database/sqlite.ts').replaceAll('\\', '/')) return
        return `import {Capacitor} from '@capacitor/core';
        Capacitor.isNativePlatform=()=>true;
        async function call(method,args){const r=await fetch('/__sellix_test_db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});const body=await r.json();if(!r.ok)throw new Error(body.error);return body;}
        const db={query:(...args)=>call('query',args),run:(...args)=>call('run',args),execute:(...args)=>call('execute',args),executeSet:(...args)=>call('executeSet',args),isTransactionActive:()=>call('isTransactionActive',[])};
        export const initDatabase=async()=>db;
        export const querySQL=(...args)=>db.query(...args);
        export const executeSQL=(...args)=>db.run(...args);
        export const releaseDatabase=async()=>{};
        export const suspendForRestore=async()=>{};
        export const resumeAfterFailedRestore=()=>{};`
      },
      configureServer(vite) {
        vite.middlewares.use('/__sellix_test_db', async (request, response) => {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          try {
            const { method, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!Object.hasOwn(bridge, method)) throw new Error('Unsupported bridge call')
            const result = await bridge[method](...args)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify(result))
          } catch (error) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ error: error.message }))
          }
        })
      },
    },
  ],
})
await server.listen()
console.log('Acceptance UI: http://127.0.0.1:5174 (scratch SQLite; stop with Ctrl+C)')
