// Physical acceptance only: forward the com.sellix.pos.tabletqa WebView to port 9223.
// Never point this runner at a shop's installed POS. The optional Gradle init script
// builds the separate QA application ID. All records below are disposable fixtures.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const stage = process.argv[2] || 'inspect'
const directory = resolve('android/app/build/tablet-qa')
mkdirSync(directory, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const context = browser.contexts()[0], page = context.pages()[0]
const errors = []
page.on('pageerror', error => errors.push(error.message))

async function visit(path) {
  await page.goto('http://localhost' + path, { waitUntil: 'domcontentloaded' })
}
async function inspect(label) {
  const viewport = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    visualWidth: visualViewport.width, visualHeight: visualViewport.height,
    appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height'),
    overflow: document.body.scrollWidth > innerWidth + 1,
  }))
  assert.equal(viewport.overflow, false, label + ': no horizontal overflow')
  console.log(label, JSON.stringify(viewport))
  if (process.argv.includes('--native-capture')) {
    const adb = resolve(process.env.ANDROID_HOME || resolve(process.env.LOCALAPPDATA || 'C:/Users/PC/AppData/Local', 'Android/Sdk'), 'platform-tools/adb.exe')
    const command = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 10000, windowsHide: true })
    assert.match(command(['shell', 'dumpsys', 'window']).split('\n').find(line => line.includes('mCurrentFocus')) || '', /com\.sellix\.pos\.tabletqa\//,
      'Refusing to capture another app')
    command(['shell', 'screencap', '-p', '/data/local/tmp/sellix-tablet-qa.png'])
    command(['pull', '/data/local/tmp/sellix-tablet-qa.png', resolve(directory, label + '.png')])
  } else {
    await page.screenshot({ path: resolve(directory, label + '.png'), timeout: 5000 }).catch(error => console.log('Screenshot unavailable: ' + error.message.split('\n')[0]))
  }
  writeFileSync(resolve(directory, label + '.json'), JSON.stringify(viewport, null, 2))
}
async function createCatalog(kind, name, price) {
  if (kind === 'addon') await page.getByRole('button', { name: 'Add-ons', exact: true }).click()
  await page.getByRole('button', { name: kind === 'addon' ? 'Add add-on' : 'Add service', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Category (optional)').fill(kind === 'addon' ? 'Extras' : 'Everyday')
  await page.getByLabel('Unit price').fill(price)
  await page.getByRole('button', { name: 'Save item', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}

try {
  if (stage === 'setup') {
    await page.getByLabel('Email', { exact: true }).fill('admin@sellix.local')
    await page.getByLabel('Password', { exact: true }).fill('Admin123!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: /Laundry Shop/ }).click()
    await page.getByLabel('Type SELECT LAUNDRY to confirm').fill('SELECT LAUNDRY')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
    await visit('/laundry/services')
    await createCatalog('service', 'QA Wash, Dry & Fold', '70')
    await createCatalog('addon', 'QA Extra rinse', '25')
    await visit('/shift')
    await page.getByLabel('Starting cash', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Start shift', exact: true }).click()
    await page.getByRole('button', { name: 'Start shift', exact: true }).waitFor({ state: 'hidden' })
    await visit('/laundry/new')
    await page.getByRole('button', { name: 'Add new customer', exact: true }).click()
    await page.getByLabel('Customer name', { exact: true }).fill('Tablet QA Customer')
    await page.getByLabel('Contact number', { exact: true }).fill('09900000001')
    await page.getByRole('button', { name: 'Save customer', exact: true }).click()
    await page.getByText('Selected: Tablet QA Customer', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Next: services', exact: true }).click()
    await page.getByRole('checkbox', { name: /QA Wash, Dry & Fold/ }).check()
    await page.getByLabel('Weight (kg) for QA Wash, Dry & Fold').fill('5')
    await page.locator('.lno-addon-options > summary').click()
    await page.getByRole('checkbox', { name: /QA Extra rinse/ }).check()
    await page.locator('.lno-optional-details > summary').click()
    await page.getByLabel('Order notes (optional)').fill('Tablet QA: keep whites separate')
    await page.getByRole('button', { name: 'Review order', exact: true }).click()
    await page.getByLabel('Discount amount').fill('25')
    await inspect('device-order-initial')
  } else if (stage === 'rotation') {
    assert.equal(await page.getByLabel('Weight (kg) for QA Wash, Dry & Fold').inputValue(), '5')
    assert.equal(await page.getByLabel('Order notes (optional)').inputValue(), 'Tablet QA: keep whites separate')
    assert.equal(await page.getByLabel('Discount amount').inputValue(), '25')
    await inspect(process.argv[3] || 'device-order-rotated')
  } else if (stage === 'save') {
    await page.getByRole('button', { name: 'Next: payment', exact: true }).click()
    await page.getByRole('radio', { name: 'Cash', exact: true }).check()
    await page.getByLabel('Payment amount', { exact: true }).fill('150')
    await page.getByLabel('Cash received', { exact: true }).fill('200')
    await page.getByRole('button', { name: 'Save order', exact: true }).click()
    await page.waitForURL(/\/laundry\/orders\/\d+$/)
    await page.getByRole('heading', { name: 'Tablet QA Customer', exact: true }).waitFor()
    await inspect('device-partial-payment')
  } else if (stage === 'audit') {
    const label = process.argv[3] || 'device'
    for (const path of ['/dashboard', '/laundry/new', '/laundry/orders', '/laundry/orders/1', '/laundry/services', '/reports', '/customers/1']) {
      await visit(path)
      await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'))
      if (path === '/customers/1') await page.getByRole('heading', { name: 'Laundry activity' }).waitFor()
      else if (path === '/dashboard') await page.getByRole('heading', { name: 'Recent orders', exact: true }).waitFor()
      else if (path === '/laundry/new') await page.getByRole('heading', { name: 'Choose a customer', exact: true }).waitFor()
      else if (path === '/laundry/orders') await page.locator('a.laundry-order-row').first().waitFor()
      else if (path === '/laundry/orders/1') await page.getByRole('heading', { name: 'Tablet QA Customer', exact: true }).waitFor()
      else if (path === '/reports') await page.getByRole('heading', { name: 'Collected payments', exact: true }).waitFor()
      else await page.getByText('QA Wash, Dry & Fold', { exact: true }).waitFor()
      for (const screen of await page.locator('.laundry-screen').all()) {
        assert.ok(await screen.evaluate(element => element.scrollWidth <= element.clientWidth + 1), path + ': no clipped content')
      }
      await inspect(label + path.replaceAll('/', '_'))
    }
  } else if (stage === 'payment-keyboard') {
    await visit('/laundry/orders/1')
    await page.getByRole('button', { name: 'Collect payment', exact: true }).click()
    await page.getByLabel('Cash received', { exact: true }).fill('200')
    const action = await page.getByRole('button', { name: /^Apply payment/ }).boundingBox()
    const height = await page.evaluate(() => visualViewport.height)
    assert.ok(action.y >= 0 && action.y + action.height <= height + 1, 'native IME: payment footer stays in view')
    await inspect('device-payment-keyboard')
  } else if (stage === 'keyboard-assert') {
    await page.waitForFunction(() => visualViewport.height < 600)
    const action = await page.getByRole('button', { name: /^Apply payment/ }).boundingBox()
    assert.ok(action.y >= 0 && action.y + action.height <= await page.evaluate(() => visualViewport.height) + 1)
    await inspect('device-payment-native-ime')
  } else if (stage === 'back-check') {
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.match(page.url(), /\/laundry\/orders\/1$/)
    await inspect('device-back-dismissal')
  } else if (stage === 'settle') {
    await visit('/laundry/orders/1')
    await page.getByRole('button', { name: 'Collect payment', exact: true }).click()
    const action = await page.getByRole('button', { name: /^Apply payment/ }).boundingBox()
    assert.ok(action.y >= 0 && action.y + action.height <= await page.evaluate(() => visualViewport.height) + 1)
    await page.getByRole('radio', { name: 'Maya', exact: true }).check()
    await page.getByRole('button', { name: /^Apply payment/ }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Update status', exact: true }).click()
    await page.getByLabel('Next status').selectOption('Ready for Pickup')
    await page.getByRole('button', { name: 'Mark as Ready for Pickup', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Complete pickup', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm pickup', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'View receipt', exact: true }).click()
    assert.match(await page.getByRole('dialog').innerText(), /BALANCE/)
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await inspect('device-completed')
  } else if (stage === 'integrity') {
    const result = await page.evaluate(async () => {
      const sqlite = window.Capacitor.Plugins.CapacitorSQLite
      const query = statement => sqlite.query({ database: 'sellix_pos', statement, values: [], readonly: false })
      return {
        integrity: await query('PRAGMA integrity_check;'),
        foreignKeys: await query('PRAGMA foreign_key_check;'),
        orders: await query('SELECT COUNT(*) AS n FROM laundry_orders;'),
        payments: await query('SELECT COUNT(*) AS n, SUM(amount_cents) AS paid FROM laundry_payments;'),
        categories: await query('PRAGMA table_info(laundry_services);'),
      }
    })
    assert.equal(result.integrity.values[0].integrity_check, 'ok')
    assert.equal(result.foreignKeys.values?.length ?? 0, 0)
    assert.equal(result.orders.values[0].n, 1)
    assert.equal(result.payments.values[0].n, 2)
    assert.equal(result.payments.values[0].paid, 35000)
    assert.ok(result.categories.values.some(column => column.name === 'category'))
    console.log(JSON.stringify(result))
    writeFileSync(resolve(directory, 'native-sqlite-integrity.json'), JSON.stringify(result, null, 2))
  } else if (stage === 'persistence') {
    await visit('/laundry/orders/1')
    await page.getByRole('heading', { name: 'Tablet QA Customer', exact: true }).waitFor()
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('button', { name: 'View order details', exact: true }).click()
    assert.match(await page.locator('body').innerText(), /Completed/)
    assert.match(await page.locator('body').innerText(), /Tablet QA: keep whites separate/)
    await visit('/reports')
    await page.getByRole('heading', { name: 'Collected payments', exact: true }).waitFor()
    assert.match(await page.locator('body').innerText(), /350\.00/)
    await inspect('device-offline-restart')
  } else {
    console.log((await page.locator('body').innerText()).slice(0, 2200))
    await inspect('device-inspect')
  }
  assert.deepEqual(errors, [])
  console.log('PASS: physical device ' + stage)
  process.exit(0) // Disconnect DevTools without closing the Android WebView.
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(0, 3500))
  await page.screenshot({ path: resolve(directory, 'device-error.png'), timeout: 5000 }).catch(() => {})
  console.error(error)
  process.exit(1)
}
