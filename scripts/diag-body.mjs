/**
 * diag-body.mjs — свойства тела машины из Rapier: масса, инерция,
 * заблокированные оси. Нужно, чтобы сравнить инерцию, которую считает
 * CarController, с настоящей инерцией тела.
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const USE_GPU = process.env.GPU === '1'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(USE_GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
})
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 5000))

const parked = await page.evaluate(() => window.__carState.parked ?? [])
const target = await page.evaluate((list) => {
  let best = list[0]
  let bestD = Infinity
  for (const c of list) {
    const d = Math.hypot(c.x, c.z)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}, parked)

for (const offset of [1.2, -1.2, 0, 2.2]) {
  await page.evaluate(
    (t, dx) => {
      window.__playerState.body.setTranslation({ x: t.x + dx, y: 1.2, z: t.z }, true)
    },
    target,
    offset,
  )
  await new Promise((r) => setTimeout(r, 800))
  await page.keyboard.press('KeyF')
  await new Promise((r) => setTimeout(r, 600))
  if (await page.evaluate(() => window.__carState.isDriving)) break
}

const info = await page.evaluate(() => {
  const body = window.__carState.body
  if (!body) return null
  const p = body.principalInertia()
  const f = body.principalInertiaLocalFrame()
  const c = body.collider(0)
  return {
    mass: body.mass(),
    principalInertia: { x: p.x, y: p.y, z: p.z },
    principalInertiaLocalFrame: { x: f.x, y: f.y, z: f.z },
    effectiveAngularInertia: body.effectiveAngularInertia?.() ?? null,
    worldInvInertiaSqrt: body.worldInvInertiaSqrt?.() ?? null,
    numColliders: body.numColliders(),
    colliderFriction: c ? c.friction() : null,
    colliderCombineRule: c ? c.frictionCombineRule() : null,
    bodyType: body.bodyType(),
    isSleeping: body.isSleeping(),
    gravityScale: body.gravityScale(),
    linearDamping: body.linearDamping(),
    angularDamping: body.angularDamping(),
    linvel: body.linvel(),
    angvel: body.angvel(),
    translation: body.translation(),
  }
})
console.log(JSON.stringify(info, null, 2))

// Габариты машины из конфига города — для сверки с инерцией.
const dims = await page.evaluate(() => {
  const st = window.__carState
  return st.dims ?? null
})
console.log('dims из dev-хука:', JSON.stringify(dims))

await browser.close()
