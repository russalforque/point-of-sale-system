// Drives the real Sellix POS app (served by vite.capture.config.ts on :5199) through a sale
// and saves every UI state the film uses to ../shots/, plus element positions in shots.json.
// Usage: node capture-shots.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require('/opt/node22/lib/node_modules/playwright') }

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'shots')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5199'
const NOW = new Date('2026-10-05T15:30:00+08:00')
const meta = {}

const browser = await playwright.chromium.launch({ args: ['--force-color-profile=srgb'] })
async function open(width, height, scale) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, timezoneId: 'Asia/Manila', locale: 'en-PH' })
  await ctx.addInitScript(() => {
    localStorage.setItem('sellix.token', 'local:1:1')
    localStorage.setItem('sellix.user', JSON.stringify({ id: '1', email: 'admin@sellix.local', fullName: 'Maria Santos', role: 'admin' }))
    localStorage.setItem('sellix.printer.config', JSON.stringify({ connectionType: 'bluetooth', deviceId: '00:11:22:33:44:55', deviceName: 'POS-80 Thermal', paperWidth: 80, autoCut: true, autoOpenDrawerOnCash: false, drawerPin: 0, drawerOnMs: 120, drawerOffMs: 240 }))
  })
  const page = await ctx.newPage()
  await page.clock.install({ time: NOW })
  await page.clock.resume()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  return page
}
const settle = (page, ms = 700) => page.mouse.move(page.viewportSize().width - 3, 3).then(() => page.waitForTimeout(ms))
async function shot(page, name, opts = {}) {
  await settle(page, opts.wait ?? 700)
  await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 92, fullPage: !!opts.fullPage })
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
  meta[name] = { ...(meta[name] || {}), viewport: page.viewportSize(), full: opts.fullPage ? size : null }
  console.log('shot', name)
}
const rect = (page, selector) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }
})
// SPA navigation keeps the in-memory database (and the sale we just rang up).
const go = (page, route) => page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')) }, route)

/* ---------- desktop: register → payment → sale complete ---------- */
const d = await open(1600, 1000, 1.5)
await d.goto(BASE + '/sales')
await d.waitForSelector('button:has-text("Iced Coffee")')
await shot(d, 'sales-0', { wait: 1500 })
const ORDER = ['Iced Coffee', 'Ensaymada', 'Chicken Adobo Rice', 'Mango Shake', 'Halo-Halo', 'Iced Coffee']
meta.order = []
for (let i = 0; i < ORDER.length; i++) {
  const tile = await rect(d, `button:has-text("${ORDER[i]}")`)
  await d.click(`button:has-text("${ORDER[i]}")`)
  await shot(d, `sales-${i + 1}`, { wait: 500 })
  meta.order.push({ name: ORDER[i], tile })
}
meta.cart = await rect(d, 'text=Current order').then(async (head) => ({ head, charge: await rect(d, 'button:has-text("Charge")') }))
await d.click('button:has-text("Charge")')
await d.waitForSelector('text=Amount due')
await shot(d, 'pay-0')
meta.quick = await rect(d, 'button:has-text("₱1,000.00")')
await d.click('button:has-text("₱1,000.00")')
await shot(d, 'pay-1')
meta.complete = await rect(d, 'button:has-text("Complete sale")')
await d.click('button:has-text("Complete sale")')
await d.waitForSelector('text=Sale complete')
await shot(d, 'done-0', { wait: 1200 })
await d.click('text=Receipt preview')
await d.waitForTimeout(500)
await shot(d, 'done-1')
const receipt = d.locator('[aria-label^="Receipt preview for invoice"]').first()
await receipt.screenshot({ path: path.join(OUT, 'receipt.png') })
meta.receipt = await receipt.evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight }))
await d.click('button:has-text("New sale")')

/* ---------- desktop: insights + operations ---------- */
for (const [route, name, full] of [
  ['/dashboard', 'dashboard', true], ['/inventory', 'inventory', true], ['/reports', 'reports', true],
  ['/shift', 'shift', false], ['/returns', 'returns', false], ['/customers', 'customers', false],
  ['/audit-log', 'audit-log', false], ['/users', 'users', false], ['/receive-stock', 'receive-stock', false],
]) {
  await go(d, route)
  await shot(d, name, { fullPage: full, wait: 1500 })
}

/* ---------- mobile (Android layout) ---------- */
const m = await open(400, 860, 2.5)
await m.goto(BASE + '/sales')
await m.waitForSelector('text=Americano')
await shot(m, 'm-sales', { wait: 1500 })
for (const n of ['Iced Coffee', 'Ensaymada', 'Mango Shake']) {
  await m.locator(`div:has(> * :text-is("${n}")) button:has-text("Add"), :text-is("${n}") >> xpath=ancestor::*[.//button[contains(., "Add")]][1]//button[contains(., "Add")]`).first().click().catch(() => console.log('mobile add miss', n))
  await m.waitForTimeout(250)
}
await m.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0 }) })
await shot(m, 'm-sales-cart')
await go(m, '/dashboard')
await shot(m, 'm-dashboard', { wait: 1500 })

fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(meta, null, 2))
await browser.close()
console.log('saved', Object.keys(meta).length, 'entries →', OUT)
