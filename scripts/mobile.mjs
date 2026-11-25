/**
 * mobile.mjs — приёмка экранного управления на телефоне.
 *
 * Эмулирует тач-устройство (Chrome DevTools Protocol: touch + мобильный
 * вьюпорт), проверяет:
 *   1. На тач-устройстве появляются стик и кнопки.
 *   2. Стик двигает персонажа (аналоговая ось → движение).
 *   3. Кнопка «Прыжок» подбрасывает персонажа.
 *   4. Кнопка «Дверь» открывает дверь.
 *   5. Свайп по экрану вращает камеру.
 *
 *   npm run dev
 *   GPU=1 node scripts/mobile.mjs
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
    '--window-size=390,844',
  ],
})

const page = await browser.newPage()
// Эмуляция телефона: тач-экран + мобильный вьюпорт.
await page.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setTouchEmulationEnabled', {
  enabled: true,
  maxTouchPoints: 5,
})
// Указываем «грубый» указатель — по нему игра включает экранное управление.
await cdp.send('Emulation.setEmitTouchEventsForMouse', {
  enabled: true,
  configuration: 'mobile',
})

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await new Promise((r) => setTimeout(r, 6000))

const results = []
const check = (ok, label, detail = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// ─── 1. Экранное управление появилось ─────────────────────────────────────
const ui = await page.evaluate(() => {
  const stick = document.querySelector('.touch__stick')
  const knob = document.querySelector('.touch__stickKnob')
  const buttons = Array.from(document.querySelectorAll('.touch__button')).map((b) =>
    b.textContent.trim(),
  )
  const overlay = document.querySelector('.hud__overlay')
  return {
    hasStick: !!stick,
    hasKnob: !!knob,
    buttons,
    overlayVisible: !!overlay,
    stickRect: stick
      ? { x: stick.getBoundingClientRect().x, y: stick.getBoundingClientRect().y, w: stick.getBoundingClientRect().width }
      : null,
    buttonRects: Array.from(document.querySelectorAll('.touch__button')).map((b) => {
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent.trim() }
    }),
  }
})

check(ui.hasStick && ui.hasKnob, 'стик отрисован')
check(ui.buttons.length === 3, 'три кнопки действий', ui.buttons.join(', '))
check(!ui.overlayVisible, 'оверлей «кликните для входа» не показан на тач-экране')

// ─── Помощники для тача ────────────────────────────────────────────────────
/** Касание по точке. */
async function tap(x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  })
  await new Promise((r) => setTimeout(r, 90))
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

/** Нажатие и перетаскивание одним пальцем. */
async function drag(fromX, fromY, toX, toY, steps = 12, holdMs = 60) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  })
  await new Promise((r) => setTimeout(r, holdMs))
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps
    const y = fromY + ((toY - fromY) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: 1 }],
    })
    await new Promise((r) => setTimeout(r, 24))
  }
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  }
}

const readState = () =>
  page.evaluate(() => {
    const p = window.__playerState
    const store = window.__inputStore
    return {
      x: p.position.x,
      z: p.position.z,
      y: p.position.y,
      speed: p.speed,
      yaw: window.__cameraStore.getState().yaw,
      stick: store ? store.getState().virtualMove : null,
      stickActive: store ? store.getState().virtualActive : false,
    }
  })

// ─── 2. Стик двигает персонажа ─────────────────────────────────────────────
const stickX = ui.stickRect.x + ui.stickRect.w / 2
const stickY = ui.stickRect.y + ui.stickRect.w / 2

const before = await readState()
// Тянем стик вверх (вперёд) и держим.
const release = await drag(stickX, stickY, stickX, stickY - 50, 6, 60)
await new Promise((r) => setTimeout(r, 1600))
const during = await readState()
await release()
await new Promise((r) => setTimeout(r, 400))

const moved = Math.hypot(during.x - before.x, during.z - before.z)
check(moved > 0.5, 'стик двигает персонажа', `пройдено ${moved.toFixed(2)} м`)
check(during.speed > 0.5, 'персонаж идёт при удержании стика', `скорость ${during.speed.toFixed(2)} м/с`)
check(
  during.stickActive === true && Math.abs(during.stick?.y ?? 0) > 0.2,
  'ось стика передаётся в игру',
  `y=${(during.stick?.y ?? 0).toFixed(2)}`,
)

// ─── 3. Свайп вращает камеру ───────────────────────────────────────────────
const camBefore = await readState()
const releaseLook = await drag(300, 300, 120, 300, 10, 60)
await new Promise((r) => setTimeout(r, 500))
const camAfter = await readState()
await releaseLook()
let yawDelta = camAfter.yaw - camBefore.yaw
while (yawDelta > Math.PI) yawDelta -= Math.PI * 2
while (yawDelta < -Math.PI) yawDelta += Math.PI * 2
check(Math.abs(yawDelta) > 0.1, 'свайп вращает камеру', `Δyaw ${yawDelta.toFixed(3)} рад`)

// ─── 4. Кнопка «Прыжок» ────────────────────────────────────────────────────
const jumpBtn = ui.buttonRects.find((b) => b.label.includes('Прыжок'))
if (jumpBtn) {
  // Разгоняемся, чтобы прыжок был заметен по высоте.
  const rel = await drag(stickX, stickY, stickX, stickY - 50, 6, 60)
  await new Promise((r) => setTimeout(r, 1200))
  await rel()
  await new Promise((r) => setTimeout(r, 300))

  const jumpBefore = await readState()
  await tap(jumpBtn.x, jumpBtn.y)
  await new Promise((r) => setTimeout(r, 260))
  const jumpAfter = await readState()
  check(
    jumpAfter.y > jumpBefore.y + 0.15,
    'кнопка «Прыжок» подбрасывает персонажа',
    `y ${jumpBefore.y.toFixed(2)} → ${jumpAfter.y.toFixed(2)}`,
  )
} else {
  check(false, 'кнопка «Прыжок» найдена')
}

// ─── 5. Кнопка «Дверь» ─────────────────────────────────────────────────────
const doorBtn = ui.buttonRects.find((b) => b.label.includes('Дверь'))
if (doorBtn) {
  // Подходим к ближайшей двери и нажимаем кнопку.
  const atDoor = await page.evaluate(() => {
    const doors = window.__worldState?.doors ?? []
    const p = window.__playerState
    if (!doors.length) return null
    let best = doors[0]
    let bestD = Infinity
    for (const d of doors) {
      const dist = Math.hypot(d.x - p.position.x, d.z - p.position.z)
      if (dist < bestD) {
        bestD = dist
        best = d
      }
    }
    window.__playerState.body.setTranslation({ x: best.x + 1.5, y: 1.4, z: best.z }, true)
    return best
  })
  await new Promise((r) => setTimeout(r, 900))

  const promptBefore = await page.evaluate(
    () => document.querySelector('.hud__prompt')?.textContent ?? '',
  )
  await tap(doorBtn.x, doorBtn.y)
  await new Promise((r) => setTimeout(r, 900))
  const promptAfter = await page.evaluate(
    () => document.querySelector('.hud__prompt')?.textContent ?? '',
  )
  // Регистр не важен: на тач-экране подсказка «Открыть дверь»,
  // на клавиатуре «E — открыть дверь».
  const openedBefore = promptBefore.toLowerCase().includes('открыть')
  const closedAfter = promptAfter.toLowerCase().includes('закрыть')
  check(
    openedBefore && closedAfter,
    'кнопка «Дверь» открывает дверь',
    `«${promptBefore}» → «${promptAfter}»`,
  )
  void atDoor
} else {
  check(false, 'кнопка «Дверь» найдена')
}

check(errors.length === 0, 'нет ошибок в консоли', errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)

await browser.close()
process.exit(failed.length ? 1 : 0)
