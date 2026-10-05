import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/opt/node22/lib/node_modules/playwright')
const out = process.argv[2]
const b = await chromium.launch()
async function mk(w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, timezoneId: 'Asia/Manila', deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { localStorage.setItem('sellix.token', 'local:1:1'); localStorage.setItem('sellix.user', JSON.stringify({ id: '1', email: 'admin@sellix.local', fullName: 'Maria Santos', role: 'admin' })) })
  const page = await ctx.newPage()
  await page.clock.install({ time: new Date('2026-10-05T15:30:00+08:00') }); await page.clock.resume()
  page.on('pageerror', e => console.log('pageerror:', e.message))
  return page
}
const page = await mk(1600, 1000)
await page.goto('http://localhost:5199/sales'); await page.waitForTimeout(2000)
for (const n of ['Iced Coffee', 'Ensaymada', 'Chicken Adobo Rice', 'Mango Shake', 'Halo-Halo', 'Iced Coffee']) { await page.click(`button:has-text("${n}")`); await page.waitForTimeout(250) }
await page.click('button:has-text("Charge")'); await page.waitForTimeout(800)
await page.click('button:has-text("₱1,000.00")'); await page.waitForTimeout(600)
await page.screenshot({ path: out + '/r-pay2.png' })
const last = await page.$$eval('[role=dialog] button, button', bs => bs.map(b => b.innerText.trim().replace(/\n/g,' ')).filter(Boolean).slice(-4)); console.log(last)
await page.click('button:has-text("Complete")').catch(async () => { await page.click('button:has-text("Charge ₱")').catch(e => console.log('no complete', e.message)) })
await page.waitForTimeout(1500)
await page.screenshot({ path: out + '/r-done.png' })
console.log(await page.$$eval('button', bs => bs.map(b => b.innerText.trim().replace(/\n/g,' ')).filter(Boolean).slice(-8)))
const m = await mk(400, 860)
for (const r of ['/sales', '/dashboard']) { await m.goto('http://localhost:5199' + r); await m.waitForTimeout(2000); await m.screenshot({ path: out + '/r-m' + r.replace('/', '-') + '.png' }) }
for (const r of ['/reports', '/shift', '/returns', '/customers', '/audit-log', '/users', '/receive-stock', '/printer-settings']) { await page.goto('http://localhost:5199' + r); await page.waitForTimeout(1800); await page.screenshot({ path: out + '/r' + r.replace('/', '-') + '.png' }) }
await b.close()
