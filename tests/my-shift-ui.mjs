// Optional acceptance test. Start a fresh: node --experimental-vm-modules tests/ui-preview.mjs
// Uses the preview's in-memory database only. Set SELLIX_BROWSER_PATH for a custom Chrome path.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright-core')
const browser = await chromium.launch({ headless: true, ...(process.env.SELLIX_BROWSER_PATH ? { executablePath: process.env.SELLIX_BROWSER_PATH } : { channel: 'chrome' }) })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true })
const page = await context.newPage()
page.setDefaultTimeout(10000)
page.setDefaultNavigationTimeout(60000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = 'http://127.0.0.1:5174'
const screenshots = mkdtempSync(join(tmpdir(), 'sellix-my-shift-'))
async function db(method, ...args) {
  const response = await page.request.post(base + '/__sellix_test_db', { data: { method, args } })
  assert.ok(response.ok(), await response.text())
  return response.json()
}
async function viewport(width, height) {
  await page.setViewportSize({ width, height })
  await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--app-height')) === innerHeight)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function noClipping(selector = '.my-shift-page') {
  const clipped = await page.locator(selector).evaluate(root => [root, ...root.querySelectorAll('*')].filter(e => getComputedStyle(e).display !== 'none' && e.clientWidth > 0 && !e.closest('.sr-only, details:not([open]) > :not(summary)') && e.getClientRects().length > 0 && e.scrollWidth > e.clientWidth + 1).map(e => ({ class: e.className, text: e.textContent.slice(0, 50) })))
  assert.deepEqual(clipped, [], `${selector}: no clipped content`)
}
async function drawer(expected) {
  await page.waitForFunction(value => document.querySelector('.ms-drawer-focus strong')?.textContent === value && document.querySelector('.ms-drawer')?.getAttribute('aria-busy') === 'false', expected)
}
const actions = () => page.getByRole('group', { name: 'Drawer actions', exact: true })
try {
  assert.equal((await db('query', 'SELECT COUNT(*) AS n FROM shifts')).values[0].n, 0, 'start a fresh acceptance preview')
  await db('run', "UPDATE store_settings SET business_type='laundry',business_setup_complete=1")
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill('admin@sellix.local')
  await page.getByLabel('Password', { exact: true }).fill('Admin123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.goto(base + '/shift', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Open your drawer', exact: true }).waitFor()
  await page.screenshot({ path: join(screenshots, 'start-desktop.png') })
  for (const [width,height] of [[320,740],[390,844],[667,375],[800,1280],[1280,800]]) { await viewport(width,height); await noClipping() }
  await page.getByRole('button', { name: 'Start shift', exact: true }).click()
  await page.getByText('Enter a valid starting cash amount. Use 0 for an empty drawer.', { exact: true }).waitFor()
  await page.getByRole('group', { name: 'Quick starting cash amounts' }).getByRole('button', { name: '₱500.00', exact: true }).click()
  await page.getByRole('button', { name: 'Start shift', exact: true }).dblclick()
  await drawer('₱500.00')
  assert.equal((await db('query', 'SELECT COUNT(*) AS n FROM shifts')).values[0].n, 1)
  await actions().getByRole('button', { name: 'Cash in', exact: true }).click()
  await page.getByRole('button', { name: 'Save cash in', exact: true }).click()
  await page.getByText('Enter an amount above zero.', { exact: true }).waitFor()
  await page.getByText('Enter a reason with at least 3 characters.', { exact: true }).waitFor()
  await page.getByLabel('Amount', { exact: true }).fill('200')
  await page.getByRole('button', { name: 'Float top-up', exact: true }).click()
  assert.match(await page.locator('.ms-projection').innerText(), /700.00/)
  for (const [width,height] of [[320,500],[390,500],[667,375],[844,390],[800,1280],[1280,800]]) {
    await viewport(width,height)
    const footer = await page.getByRole('button', { name: 'Save cash in', exact: true }).boundingBox()
    assert.ok(footer.y >= 0 && footer.y + footer.height <= height + 1, `${width}: movement action visible`)
    await noClipping('.ms-dialog')
    assert.equal(await page.getByLabel('Amount', { exact: true }).inputValue(), '200')
  }
  await page.getByRole('button', { name: 'Save cash in', exact: true }).dblclick()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await drawer('₱700.00')
  assert.equal((await db('query', 'SELECT COUNT(*) AS n FROM cash_movements')).values[0].n, 1)
  await actions().getByRole('button', { name: 'Cash out', exact: true }).click()
  await page.getByLabel('Amount', { exact: true }).fill('701')
  await page.getByRole('button', { name: 'Bank deposit', exact: true }).click()
  await page.getByRole('button', { name: 'Save cash out', exact: true }).click()
  await page.getByText('Cash out cannot exceed ₱700.00.', { exact: true }).waitFor()
  await page.getByLabel('Amount', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Save cash out', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await drawer('₱600.00')
  const at = new Date().toISOString()
  await db('run', "INSERT INTO laundry_orders(order_number,request_key,request_payload,customer_id,customer_name,status,subtotal_cents,discount_cents,total_cents,created_by,created_at,updated_at) VALUES('SHIFT-UI-ORDER','shift-ui-order','{}',1,'Alex Reyes','Received',35000,0,35000,1,?,?)", [at,at])
  await db('run', "INSERT INTO laundry_payments(order_id,request_key,request_payload,method,amount_cents,tendered_cents,shift_id,created_by,created_at) VALUES(1,'shift-ui-cash','{}','Cash',15000,20000,1,1,?)", [at])
  await db('run', "INSERT INTO laundry_payments(order_id,request_key,request_payload,method,amount_cents,tendered_cents,shift_id,created_by,created_at) VALUES(1,'shift-ui-maya','{}','Maya',20000,20000,1,1,?)", [at])
  await page.getByRole('button', { name: 'Refresh my shift', exact: true }).click()
  await drawer('₱750.00')
  assert.equal(await page.locator('.ms-payment-total').innerText(), '₱350.00')
  await page.screenshot({ path: join(screenshots, 'active-desktop.png') })
  for (const [width,height] of [[320,740],[360,800],[390,844],[430,932],[667,375],[844,390],[800,1280],[1280,800]]) { await viewport(width,height); await noClipping() }
  await viewport(390,844)
  await page.locator('main').first().evaluate(e => { e.scrollTop = 0 })
  await page.screenshot({ path: join(screenshots, 'active-phone.png') })
  await actions().getByRole('button', { name: 'End shift', exact: true }).click()
  await page.getByLabel('Cash you counted', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close shift', exact: true }).click()
  await page.getByText('Enter the cash you counted. Use 0 for an empty drawer.', { exact: true }).waitFor()
  await page.getByLabel('Cash you counted', { exact: true }).fill('740')
  await page.getByText('Short by ₱10.00', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Keep shift open', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await db('query', 'SELECT status FROM shifts WHERE id=1')).values[0].status, 0)
  const endButton = actions().getByRole('button', { name: 'End shift', exact: true })
  await endButton.focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Cash you counted', { exact: true }).fill('760')
  await page.getByText('Over by ₱10.00', { exact: true }).waitFor()
  await page.getByLabel('Cash you counted', { exact: true }).fill('750')
  await page.getByText('Drawer balanced', { exact: true }).waitFor()
  for (const [width,height] of [[320,500],[667,375],[844,390],[1280,800]]) {
    await viewport(width,height)
    const button = await page.getByRole('button', { name: 'Close shift', exact: true }).boundingBox()
    assert.ok(button.y >= 0 && button.y + button.height <= height + 1, `${width}: closing action visible`)
    await noClipping('.ms-dialog')
  }
  await page.getByRole('button', { name: 'Close shift', exact: true }).dblclick()
  await page.getByRole('heading', { name: 'Shift closed', exact: true }).waitFor()
  assert.equal((await db('query', 'SELECT status,difference,actual_cash FROM shifts WHERE id=1')).values[0].difference, 0)
  await page.getByRole('group', { name: 'Quick starting cash amounts' }).getByRole('button', { name: 'Empty drawer', exact: true }).click()
  await page.getByRole('button', { name: 'Start shift', exact: true }).click()
  await drawer('₱0.00')
  assert.equal(await page.locator('.ms-payment-total').innerText(), '₱0.00')
  await page.getByRole('heading', { name: 'No cash movements yet', exact: true }).waitFor()
  for (let index=0; index<11; index++) await db('run', 'INSERT INTO cash_movements(shift_id,type,amount,reason,created_by,created_at) VALUES(2,?,?,?,?,?)', [index%2?2:1,index===0?987654321.99:5,index===0?'Longcashmovementreasonwithoutspaces'.repeat(4):'Petty cash '+index,'Staff member with a long display name',at])
  await page.getByRole('button', { name: 'Refresh my shift', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.ms-log-list li').length===8 && document.querySelector('.ms-drawer').getAttribute('aria-busy')==='false')
  for (const [width,height] of [[320,740],[390,844],[667,375],[800,1280],[1280,800]]) { await viewport(width,height); await noClipping() }
  await page.getByRole('button', { name: 'Show all 11 entries', exact: true }).click()
  assert.equal(await page.locator('.ms-log-list li').count(), 11)
  await page.getByRole('group', { name: 'Cash activity filters' }).getByRole('button', { name: 'Cash out', exact: true }).click()
  assert.equal(await page.locator('.ms-log-list li').count(), 5)
  const fault={summary:true,log:false,active:false}
  await page.route('**/__sellix_test_db', async route => {
    const body=route.request().postDataJSON(),sql=body.args[0]
    if (body.method==='query' && ((fault.summary&&sql.includes('FROM sale_payments sp'))||(fault.log&&sql.includes('FROM cash_movements WHERE shift_id = ? ORDER BY'))||(fault.active&&sql.includes('employee_id = ? AND status = 0 LIMIT 1')))) await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Acceptance load failure'})})
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Refresh my shift', exact: true }).click()
  await page.getByRole('alert').filter({hasText:'last drawer totals'}).waitFor()
  assert.equal(await actions().getByRole('button',{name:'Cash out',exact:true}).isDisabled(),true)
  fault.summary=false
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('.ms-retry')&&document.querySelector('.ms-drawer').getAttribute('aria-busy')==='false')
  fault.log=true
  await page.getByRole('button',{name:'Refresh my shift',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'last loaded entries'}).waitFor()
  assert.equal(await page.locator('.ms-log-list li').count(),5)
  fault.log=false;fault.active=true
  await page.getByRole('button',{name:'Refresh my shift',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'before making changes'}).waitFor()
  assert.equal(await actions().getByRole('button',{name:'End shift',exact:true}).isDisabled(),true)
  fault.active=false
  await page.getByRole('alert').filter({hasText:'before making changes'}).getByRole('button',{name:'Retry',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('.ms-retry')&&document.querySelector('.ms-drawer').getAttribute('aria-busy')==='false')
  await page.unroute('**/__sellix_test_db')
  assert.deepEqual(errors,[])
  console.log('PASS: start/zero float, duplicate taps, cash in/out and validation, cash vs non-cash totals, closing variance, new-shift isolation, eight viewports, long cash-log entries, filters and error recovery.')
  console.log('Screenshots: '+screenshots)
} finally { await browser.close() }
