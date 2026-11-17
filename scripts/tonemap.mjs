/**
 * Диагностика тонмаппинга: что реально применяется к кадру.
 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 800, height: 600 })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 7000))

const diag = await page.evaluate(() => {
  const gl = window.__gl
  if (!gl) return { error: 'нет пробника' }
  const names = ['NoToneMapping', 'LinearToneMapping', 'ReinhardToneMapping', 'CineonToneMapping', 'ACESFilmicToneMapping', 'AgXToneMapping', 'NeutralToneMapping']
  return {
    rendererToneMapping: gl.toneMapping,
    rendererToneMappingName: names[gl.toneMapping] ?? '?',
    exposure: gl.toneMappingExposure,
    outputColorSpace: gl.outputColorSpace,
  }
})
console.log('РЕНДЕРЕР:', JSON.stringify(diag, null, 2))
console.log('консоль:', logs.slice(0, 10).join('\n') || '(чисто)')
await browser.close()
