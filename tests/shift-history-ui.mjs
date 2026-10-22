// Optional browser regression test. Start: node --experimental-vm-modules tests/ui-preview.mjs
// Uses only the acceptance preview's scratch database. Set SELLIX_BROWSER_PATH if Chrome is elsewhere.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright-core')
const browser = await chromium.launch({ headless: true, ...(process.env.SELLIX_BROWSER_PATH ? { executablePath: process.env.SELLIX_BROWSER_PATH } : { channel: 'chrome' }) })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
const page = await context.newPage()
page.setDefaultTimeout(8000)
page.setDefaultNavigationTimeout(60000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = 'http://127.0.0.1:5174'
async function db(method, ...args) {
  const response = await page.request.post(base + '/__sellix_test_db', { data: { method, args } })
  assert.ok(response.ok(), 'acceptance SQLite bridge: ' + await response.text())
  return response.json()
}
const settled = () => page.waitForFunction(() => document.querySelector('.sh-list-content')?.getAttribute('aria-busy') === 'false')
try {
  // Refuse to modify anything except a fresh acceptance database.
  assert.equal((await db('query', 'SELECT COUNT(*) AS n FROM shifts')).values[0].n, 0, 'start a fresh ui-preview process')
  await db('run', "UPDATE store_settings SET business_type='laundry',business_setup_complete=1")
  const now = Date.now()
  for (let index = 0; index < 24; index++) {
    const cash = index === 0 ? 987654321.99 : 1250
    const expected = Math.round((500 + cash - 50 + 100 - 75) * 100) / 100
    const difference = index === 0 ? -123456789.99 : [-35, 20, 0, null][index % 4]
    await db('run', `INSERT INTO shifts(employee_id,employee_name,starting_cash,status,started_at,ended_at,cash_sales,non_cash_sales,expected_cash,actual_cash,difference,cash_refunds,cash_in,cash_out,closed_by)
      VALUES(1,?,500,1,?,?,?,?,?,?,?,50,100,75,'Store Admin')`, [index === 0 ? 'Harper Verylongemployeenamewithoutspaces Alexandria Santos' : index % 2 ? 'Avery Lane' : 'Blair Santos', new Date(now - (index + 2) * 3600000).toISOString(), new Date(now - (index + 1) * 3600000).toISOString(), cash, index === 0 ? 123456789.01 : 750, expected, difference === null ? null : Math.round((expected + difference) * 100) / 100, difference])
  }
  for (let id = 1; id <= 3; id++) await db('run', "INSERT INTO shifts(employee_id,employee_name,starting_cash,status,started_at) VALUES(?,?,500,0,?)", [id, ['','Store Admin','Store Manager','Store Cashier'][id], new Date(now - (id === 1 ? 14 : id) * 3600000).toISOString()])
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill('admin@sellix.local')
  await page.getByLabel('Password', { exact: true }).fill('Admin123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.goto(base + '/shift-history', { waitUntil: 'networkidle' })
  await settled()
  assert.equal(await page.locator('.sh-row').count(), 20)
  for (const [width, height] of [[320,740],[360,800],[390,844],[430,932],[667,375],[844,390],[800,1280],[1280,800],[1440,900]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.shift-history-page *')].filter(e => getComputedStyle(e).display !== 'none' && e.clientWidth > 0 && !e.closest('thead,.sr-only') && e.scrollWidth > e.clientWidth + 1).map(e => e.className))
    assert.deepEqual(clipped, [], `${width}: no clipped names, amounts or controls`)
    assert.ok(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth + 1))
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const detailsButton = page.getByRole('button', { name: /^View shift #1 for/ })
  await detailsButton.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /123,456,789.99/)
  for (const [width, height] of [[320,500],[667,375],[844,390],[1280,800]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--app-height')) === innerHeight)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const done = await dialog.getByRole('button', { name: 'Done', exact: true }).boundingBox()
    assert.ok(done.y >= 0 && done.y + done.height <= height + 1, `${width}×${height}: dialog action stays visible`)
    assert.ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1))
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.ok(await detailsButton.evaluate(e => e === document.activeElement), 'dialog restores keyboard focus')
  await page.getByRole('combobox', { name: 'Cash result', exact: true }).selectOption('short')
  await page.waitForFunction(() => document.querySelectorAll('.sh-row').length === 6)
  assert.equal(await page.getByRole('group', { name: 'Shift status' }).getByRole('button', { name: 'Closed', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.getByRole('combobox', { name: 'Cash result', exact: true }).inputValue(), 'short')
  await page.getByRole('group', { name: 'Shift status' }).getByRole('button', { name: 'Open', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sh-row').length === 3)
  assert.equal(await page.getByRole('combobox', { name: 'Cash result', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sh-row').length === 20)
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sh-row').length === 7)
  assert.ok(await page.locator('.sh-list').evaluate(e => e === document.activeElement))
  await page.getByRole('searchbox', { name: 'Search shifts by employee' }).fill('Blair')
  await page.waitForFunction(() => document.querySelectorAll('.sh-row').length === 11)
  const fault = { active: true }
  await page.route('**/__sellix_test_db', async route => {
    const request = route.request().postDataJSON()
    if (fault.active && request.method === 'query' && request.args[0].includes('COUNT(*) AS count FROM shifts') && !request.args[0].includes('status = ?')) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Acceptance transport failure' }) })
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Refresh shift history' }).click()
  await page.getByRole('alert').filter({ hasText: 'last loaded shifts' }).waitFor()
  assert.equal(await page.locator('.sh-row').count(), 11)
  fault.active = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await settled()
  fault.active = true
  await page.getByRole('searchbox', { name: 'Search shifts by employee' }).fill('No matching employee')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.sh-row').count(), 0, 'failed filters never display old results')
  fault.active = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByText('No shifts match these filters', { exact: true }).waitFor()
  await page.unroute('**/__sellix_test_db')
  assert.deepEqual(errors, [])
  console.log('PASS: nine viewports, large values, long names, dialogs and focus, filters, rotation, pagination, refresh failures and recovery.')
} finally {
  await browser.close()
}
