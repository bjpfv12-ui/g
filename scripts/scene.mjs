/**
 * Обзорный снимок: широкий кадр города с небом и пальмами.
 * Использует dev-хук камеры, поэтому работает только на dev-сервере.
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
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
})
await page.addStyleTag({ content: '.hud__overlay{display:none !important}' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(5000)

// Ракурс: чуть выше, чтобы в кадр попали небо и облака.
const applied = await page.evaluate(() => {
  const store = window.__cameraStore
  if (!store) return false
  const state = store.getState()
  state.setPitch(Number(new URLSearchParams(location.search).get('pitch') ?? -0.08))
  state.setYaw(Number(new URLSearchParams(location.search).get('yaw') ?? 0))
  state.setDistance(Number(new URLSearchParams(location.search).get('dist') ?? 9))
  return true
})
console.log('dev-хук камеры:', applied)

// Диагностика рендерера: тонмаппинг, экспозиция, свет, туман.
const diag = await page.evaluate(() => {
  const gl = window.__gl
  const scene = window.__scene
  if (!gl || !scene) return { error: 'нет пробника' }
  const lights = []
  scene.traverse((obj) => {
    if (obj.isLight) {
      lights.push({
        type: obj.type,
        intensity: obj.intensity,
        color: '#' + obj.color.getHexString(),
        shadow: !!obj.castShadow,
      })
    }
  })
  return {
    toneMapping: gl.toneMapping,
    toneMappingExposure: gl.toneMappingExposure,
    outputColorSpace: gl.outputColorSpace,
    fog: scene.fog ? { color: '#' + scene.fog.color.getHexString(), near: scene.fog.near, far: scene.fog.far } : null,
    lights,
  }
})
console.log('ДИАГНОСТИКА:', JSON.stringify(diag, null, 2))

// Диагностика облаков: по умолчанию красим в мадженту, если передан color.
const color = new URLSearchParams(process.env.APP_URL?.split('?')[1] ?? '').get('cloud')
if (color) {
  const ok = await page.evaluate((hex) => {
    const mesh = window.__clouds
    if (!mesh) return false
    mesh.material.color.set(hex)
    mesh.material.opacity = 1
    mesh.material.needsUpdate = true
    return true
  }, color)
  console.log('подкраска облаков:', ok ? 'да' : 'сетки нет')
}

await wait(4000)
try {
  await page.screenshot({ path: `${OUT}\\shot-scene.png`, captureBeyondViewport: false })
  console.log('снимок с облаками:', `${OUT}\\shot-scene.png`)

  // Контрольный кадр без облаков — сразу видно, кто засвечивает сцену.
  const hidden = await page.evaluate(() => {
    const mesh = window.__clouds
    if (!mesh) return false
    mesh.visible = false
    return true
  })
  if (hidden) {
    await wait(2500)
    await page.screenshot({ path: `${OUT}\\shot-noclouds.png`, captureBeyondViewport: false })
    console.log('контрольный снимок:', `${OUT}\\shot-noclouds.png`)
  }
} catch (error) {
  console.log('Скриншот не снят:', error.message)
}
console.log('консоль:', logs.slice(0, 15).join('\n') || '(чисто)')

await browser.close()
