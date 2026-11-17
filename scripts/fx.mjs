/**
 * Проверка bloom: снимок неба с солнцем в кадре + контрольный кадр с выключенным bloom.
 * Использует dev-хук __freeCam (см. CameraRig).
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const OUT = 'C:\\3d game\\verify'

mkdirSync(OUT, { recursive: true })

// Направление на солнце: elevation 0.62 рад, azimuth −0.4 рад.
const ELEV = 0.62
const AZ = -0.4
const SUN = [
  Math.cos(ELEV) * Math.sin(AZ),
  Math.sin(ELEV),
  Math.cos(ELEV) * Math.cos(AZ),
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,810',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(6000)

await page.evaluate(() => {
  document.querySelector('.hud__overlay')?.remove()
  document.querySelector('.hud__controls')?.remove()
})

// Камера в 200 м от центра, смотрит строго на солнце.
const camPos = [-SUN[0] * 220, 40, -SUN[2] * 220]
const look = [camPos[0] + SUN[0] * 900, camPos[1] + SUN[1] * 900, camPos[2] + SUN[2] * 900]

await page.evaluate((c) => {
  globalThis.__freeCam = { pos: c.pos, look: c.look }
}, { pos: camPos, look })
await wait(4000)
await page.screenshot({ path: `${OUT}\\shot-bloom.png`, captureBeyondViewport: false })
console.log('снимок с bloom:', `${OUT}\\shot-bloom.png`)

// Контроль: тот же кадр, но bloom выключен.
const off = await page.evaluate(() => {
  const scene = window.__scene
  if (!scene) return false
  let found = false
  scene.traverse((obj) => {
    if (obj.material && obj.material.type === 'BloomEffect') {
      obj.enabled = false
      found = true
    }
  })
  return found
})
console.log('bloom найден в сцене:', off)
await wait(3000)
await page.screenshot({ path: `${OUT}\\shot-nobloom.png`, captureBeyondViewport: false })
console.log('контрольный снимок:', `${OUT}\\shot-nobloom.png`)

console.log('консоль:', logs.slice(0, 15).join('\n') || '(чисто)')
await browser.close()
