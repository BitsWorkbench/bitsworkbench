import { chromium } from 'playwright'
const BASE = 'http://localhost:5287/'
const OUT = '/tmp/claude-1000/journey/shots/'
const SIZES = [['chromebook',1366,768,false],['ipad',1024,768,true],['phone',390,844,true]]
const b = await chromium.launch({executablePath: process.env.HOME+'/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'})
for (const [n,w,h,touch] of SIZES) {
  const c = await b.newContext({ viewport:{width:w,height:h}, hasTouch:touch, deviceScaleFactor:1 })
  const p = await c.newPage()
  await p.goto(BASE, { waitUntil:'networkidle' })
  await p.evaluate(()=>{localStorage.setItem('opencodebot.welcomed.v1','1');localStorage.setItem('opencodebot.device.v1','codex')})
  await p.reload({waitUntil:'networkidle'})
  await p.click('#btn-learn'); await p.click('#modal [data-builtin="LCX"]')
  await p.waitForFunction(()=>!document.getElementById('learn-pane').hidden)
  await p.evaluate(()=>document.querySelectorAll('.toast').forEach(t=>t.remove()))
  const pane = s => p.locator('#learn-pane '+s)
  await pane('[data-mission="0"]').click()
  for (let i=0;i<4;i++) await pane('[data-learn="next"]').click()   // to objective 4 (The Simulator)
  try { await p.click('#btn-sim', {timeout:3000}) } catch {}
  await p.waitForTimeout(6000)
  await p.screenshot({ path: OUT+`now-${n}-open.png` })
  if (await p.isVisible('#learn-rail .rail-toggle')) { await p.click('#learn-rail .rail-toggle'); await p.waitForTimeout(500) }
  try { await p.click('#btn-run',{timeout:3000}); await p.waitForTimeout(3000) } catch {}
  await p.screenshot({ path: OUT+`now-${n}-closed.png` })
  const words = await p.evaluate(()=>document.getElementById('learn-pane').innerText.split(/\s+/).filter(Boolean).length)
  console.log(n, 'words in pane', words)
  await c.close()
}
await b.close()
