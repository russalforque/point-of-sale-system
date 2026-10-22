// Start with $env:SELLIX_UI_RETAIL='1'; node --experimental-vm-modules tests/ui-preview.mjs
// Pass a playwright-core/index.mjs path. Uses scratch fixtures; never production SQLite.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disk-cache-size=1', '--media-cache-size=1', '--disable-gpu-shader-disk-cache'] })
const output = resolve('.qa/retail-ui')
mkdirSync(output, { recursive: true })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  // The POS must remain usable while external resources are unreachable.
  await context.route(url => !url.href.startsWith('http://127.0.0.1:5174'), route => route.abort())
  await page.goto('http://127.0.0.1:5174/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@sellix.local')
  await page.getByLabel('Password', { exact: true }).fill('Admin123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.goto('http://127.0.0.1:5174/sales')
  await page.getByRole('navigation', { name: 'Product categories', exact: true }).waitFor()
  const search = page.getByRole('searchbox', { name: 'Search products or scan a barcode', exact: true })
  await page.locator('body').click({ position: { x: 600, y: 20 } })
  await page.keyboard.press('F2')
  await search.evaluate(element => { if (document.activeElement !== element) throw new Error('F2 did not focus product search') })
  await search.fill('CHICKEN')
  await search.press('Enter')
  await page.getByRole('button', { name: 'Increase Chicken Meal', exact: true }).waitFor()
  await page.getByLabel('Order notes', { exact: true }).fill('Pack sauce separately')
  await page.keyboard.press('F4')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Checkout shortcut must not interrupt typing')
  await page.locator('body').click({ position: { x: 600, y: 20 } })
  await page.keyboard.press('F4')
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: resolve(output, 'desktop-payment.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(output, 'desktop-register.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  for (const [width, height] of [[1280, 800], [800, 1280]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('button', { name: 'Charge', exact: false }).first().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await page.getByLabel('Order notes', { exact: true }).inputValue(), 'Pack sauce separately')
    await page.screenshot({ path: resolve(output, `tablet-${width}x${height}.png`), fullPage: true })
  }
  assert.deepEqual(errors, [])
  // Touch hardware uses coarse pointer controls. Rotate the same draft in one context.
  const tablet = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
  const tabletPage = await tablet.newPage()
  tabletPage.on('pageerror', error => errors.push(error.message))
  await tabletPage.goto('http://127.0.0.1:5174/login')
  await tabletPage.getByLabel('Email', { exact: true }).fill('admin@sellix.local')
  await tabletPage.getByLabel('Password', { exact: true }).fill('Admin123!')
  await tabletPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  await tabletPage.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await tabletPage.goto('http://127.0.0.1:5174/sales')
  assert.equal(await tabletPage.evaluate(() => matchMedia('(pointer:coarse)').matches), true)
  const tabletSearch = tabletPage.getByRole('searchbox', { name: 'Search products or scan a barcode', exact: true })
  await tabletSearch.fill('CHICKEN')
  await tabletSearch.press('Enter')
  await tabletPage.getByLabel('Order notes', { exact: true }).fill('Touch draft retained')
  for (const [width, height] of [[1280, 800], [800, 1280]]) {
    await tabletPage.setViewportSize({ width, height })
    assert.equal(await tabletPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await tabletPage.getByLabel('Order notes', { exact: true }).inputValue(), 'Touch draft retained')
    await tabletPage.screenshot({ path: resolve(output, `touch-${width}x${height}.png`), fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: Full HD category rail, F2 search, Enter barcode, typing-safe F4 checkout, external-network blocking, landscape/portrait layouts and retained draft notes.')
  console.log(`Screenshots: ${output}`)
} finally { await browser.close() }
