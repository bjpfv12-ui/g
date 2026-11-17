/**
 * Скрипт проверки: запускает страницу в headless Chrome, снимает скриншоты,
 * имитирует движение (W / Shift+W / Space) и печатает телеметрию + ошибки консоли.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const OUT = 'C:\\3d game\\verify'

mkdirSync(OUT, { recursive: true })

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
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 })

const logs = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`[${msg.type()}] ${msg.text()}`)
})
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

await page.goto(URL, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
})

// Прячем оверлей паузы, чтобы видеть саму сцену.
await page.addStyleTag({ content: '.hud__overlay{display:none !important}' })

const readTelemetry = () =>
  page.evaluate(() => {
    const el = document.querySelector('.hud__telemetry')
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : 'n/a'
  })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// FAST=1 — только один скриншот (SwiftShader рендерит очень медленно).
const FAST = process.env.FAST === '1'

await wait(4000)
console.log('SPAWN   :', await readTelemetry())
if (!FAST) await page.screenshot({ path: `${OUT}\\shot-idle.png` })

// Идём вперёд (относительно камеры) и бежим.
await page.keyboard.down('KeyW')
await wait(1600)
if (!FAST) await page.screenshot({ path: `${OUT}\\shot-walk.png` })
console.log('WALK    :', await readTelemetry())

await page.keyboard.down('ShiftLeft')
await wait(1600)
console.log('SPRINT  :', await readTelemetry())
if (!FAST) await page.screenshot({ path: `${OUT}\\shot-sprint.png` })
await page.keyboard.up('ShiftLeft')
await page.keyboard.up('KeyW')

// Прыжок.
await page.keyboard.press('Space')
await wait(350)
if (!FAST) await page.screenshot({ path: `${OUT}\\shot-jump.png` })
console.log('JUMP    :', await readTelemetry())

// Стенана: идём влево-вперёд и проверяем, что камера не уходит в стены.
await page.keyboard.down('KeyA')
await wait(1200)
await page.keyboard.up('KeyA')
await wait(500)
if (!FAST) await page.screenshot({ path: `${OUT}\\shot-strafe.png` })
console.log('STRAFE  :', await readTelemetry())

const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - start < 2000) requestAnimationFrame(tick)
        else resolve(Math.round((frames * 1000) / (performance.now() - start)))
      }
      requestAnimationFrame(tick)
    }),
)
console.log('FPS(swiftshader):', fps)

// Состояние мира: сколько машин и пешеходов и движутся ли они.
const world = await page.evaluate(async () => {
  const read = () => {
    const w = window.__worldState
    if (!w) return null
    return {
      traffic: w.traffic.length,
      pedestrians: w.pedestrians.length,
      firstCar: w.traffic[0] ? { x: +w.traffic[0].x.toFixed(2), z: +w.traffic[0].z.toFixed(2) } : null,
      firstPed: w.pedestrians[0]
        ? { x: +w.pedestrians[0].x.toFixed(2), z: +w.pedestrians[0].z.toFixed(2) }
        : null,
    }
  }
  const before = read()
  await new Promise((r) => setTimeout(r, 1500))
  const after = read()
  return { before, after }
})
console.log('WORLD   :', JSON.stringify(world))

const doorPrompt = await page.evaluate(
  () => document.querySelector('.hud__prompt')?.textContent ?? 'нет подсказки',
)
console.log('DOOR    :', doorPrompt)

// Телепорт к ближайшей двери и проверка подсказки + открывания.
const doorTest = await page.evaluate(async () => {
  const state = window.__worldState
  const player = window.__playerState
  if (!state || !player || !state.doors.length) return { error: 'нет данных о дверях' }

  const door = state.doors[0]
  const body = player.body
  if (!body) return { error: 'нет тела игрока' }

  // Встаём в 2 метрах от двери, на тротуаре.
  body.setTranslation({ x: door.x + 1.6, y: 2.2, z: door.z + 1.6 }, true)
  await new Promise((r) => setTimeout(r, 1200))
  return { door: { x: +door.x.toFixed(1), z: +door.z.toFixed(1) } }
})
console.log('ДВЕРЬ   :', JSON.stringify(doorTest))

await wait(1500)
const promptNear = await page.evaluate(
  () => document.querySelector('.hud__prompt')?.textContent ?? 'нет подсказки',
)
console.log('ПОДСКАЗКА:', promptNear)

await page.keyboard.press('KeyE')
await wait(1500)
const promptAfter = await page.evaluate(
  () => document.querySelector('.hud__prompt')?.textContent ?? 'нет подсказки',
)
console.log('ПОСЛЕ E :', promptAfter)
await page.screenshot({ path: `${OUT}\\shot-door.png` })

const minimap = await page.evaluate(() => {
  const canvas = document.querySelector('.minimap')
  if (!canvas) return 'нет мини-карты'
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let painted = 0
  for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) painted++
  return `мини-карта ${canvas.width}x${canvas.height}, закрашенных пикселей ~${painted}`
})
console.log('MAP     :', minimap)

await page.screenshot({ path: `${OUT}\\shot-final.png` })

console.log('--- console (errors/warnings) ---')
console.log(logs.slice(0, 25).join('\n') || '(пусто)')

await browser.close()
