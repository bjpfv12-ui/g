/**
 * shot.mjs — снимок экрана с указанного адреса (по умолчанию — живой сайт).
 * Используется, чтобы приложить к ответу кадр уже задеплоенной версии.
 *   GPU=1 node scripts/shot.mjs [url] [out.png]
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.argv[2] ?? 'https://bjpfv12-ui.github.io/g/'
const OUT = process.argv[3] ?? 'C:\\3d game\\verify\\shot-live.png'
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
    '--window-size=1440,810',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 810 })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text())
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.addStyleTag({ content: '.hud__overlay{display:none !important}' })
await new Promise((r) => setTimeout(r, 4000))

if (process.env.CAR === '1') {
  // Садимся в машину и снимаем поворот — нужен dev-сервер с хуками.
  const parked = await page.evaluate(() => window.__carState?.parked ?? [])
  if (parked.length > 0) {
    await page.evaluate((target) => {
      window.__playerState.body.setTranslation(
        { x: target.x + 1.2, y: 1.2, z: target.z },
        true,
      )
    }, parked[0])
    await new Promise((r) => setTimeout(r, 800))
    await page.keyboard.press('KeyF')
    await new Promise((r) => setTimeout(r, 600))
  }
  await page.keyboard.down('KeyW')
  await new Promise((r) => setTimeout(r, 2200))
  await page.keyboard.down('KeyA')
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: OUT })
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
} else {
  // Доворачиваем персонажа клавишей D — видно, что камера встаёт за спину.
  await page.keyboard.down('KeyW')
  await new Promise((r) => setTimeout(r, 700))
  await page.keyboard.down('KeyD')
  await new Promise((r) => setTimeout(r, 900))
  await page.screenshot({ path: OUT })
  await page.keyboard.up('KeyD')
  await page.keyboard.up('KeyW')
}

const telemetry = await page.evaluate(() => {
  const el = document.querySelector('.hud__telemetry')
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : 'n/a'
})
console.log('кадр:', OUT)
console.log('телеметрия:', telemetry)
console.log('ошибки консоли:', logs.length ? logs.slice(0, 5).join(' | ') : 'нет')

await browser.close()
