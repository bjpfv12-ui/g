/**
 * mobile-shot.mjs — снимок экрана в мобильном режиме.
 *
 * Эмулирует телефон (тач + вьюпорт 390×844) и снимает кадр со стиком
 * и кнопками, чтобы оценить раскладку управления.
 *
 *   npm run dev
 *   GPU=1 node scripts/mobile-shot.mjs [out.png]
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const OUT = process.argv[2] ?? 'C:\\3d game\\verify\\shot-mobile.png'
const USE_GPU = process.env.GPU === '1'
/** ORIENT=landscape — снимок в альбомной ориентации (844×390). */
const LANDSCAPE = process.env.ORIENT === 'landscape'
const VIEWPORT = LANDSCAPE
  ? { width: 844, height: 390, deviceScaleFactor: 2 }
  : { width: 390, height: 844, deviceScaleFactor: 2 }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(USE_GPU
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--window-size=390,844',
  ],
})

const page = await browser.newPage()
await page.setViewport({
  ...VIEWPORT,
  isMobile: true,
  hasTouch: true,
})
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 6000))

// Немного идём вперёд, чтобы кадр был не пустым.
const stickX = LANDSCAPE ? 70 : 62
const stickY = LANDSCAPE ? 320 : 740
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: stickX, y: stickY, id: 1 }],
})
for (let i = 1; i <= 8; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: stickX, y: stickY - i * 5, id: 1 }],
  })
  await new Promise((r) => setTimeout(r, 30))
}
await new Promise((r) => setTimeout(r, 1400))
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await new Promise((r) => setTimeout(r, 700))

await page.screenshot({ path: OUT })
console.log('кадр:', OUT)

const telemetry = await page.evaluate(() => {
  const el = document.querySelector('.hud__telemetry')
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : 'n/a'
})
console.log('телеметрия:', telemetry)

await browser.close()
