import { useEffect, useRef } from 'react'
import { readVirtualMove, useInputStore } from '../store/InputStore'
import { TUNING } from '../tuning'

/**
 * TouchControls.tsx — экранное управление для телефона и планшета.
 *
 * Раскладка ( обе ориентации):
 *   - слева внизу — аналоговый стик: движение персонажа;
 *   - справа внизу — кнопки действий: прыжок, бег, дверь;
 *   - всё остальное поле — свайп для обзора (камера едет за пальцем).
 *
 * Кнопки не эмулируют клавиши «как есть» — они пишут в тот же `keys`,
 * поэтому вся игровая логика (прыжок, дверь, бег) работает одинаково
 * на клавиатуре и на тач-экране.
 */

/** Радиус хода стика в CSS-пикселях. */
const STICK_RADIUS = 54
/** Мёртвая зона в нормированных единицах — палец не должен «дрожать». */
const DEADZONE = 0.14

/**
 * Масштаб свайпа относительно мышиного.
 *
 * Мышь даёт ~0.0026 рад/пиксель — для пальца это слишком медленно,
 * экран меньше и движение короче. Считаем коэффициент так, чтобы итоговая
 * чувствительность была TOUCH_LOOK_SENSITIVITY рад/пиксель.
 */
const LOOK_SCALE = TUNING.touchLookSensitivity / TUNING.mouseSensitivity

export function TouchControls() {
  const touch = useInputStore((state) => state.touch)
  const setKey = useInputStore((state) => state.setKey)
  const setVirtualMove = useInputStore((state) => state.setVirtualMove)

  const stickRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  /** id пальца, который сейчас держит стик. */
  const stickPointer = useRef<number | null>(null)
  /** id пальца, который сейчас ведёт обзор. */
  const lookPointer = useRef<number | null>(null)
  const lookLast = useRef({ x: 0, y: 0 })

  // Стик всегда возвращается в ноль: если телефон потерял фокус (звонок,
  // сворачивание приложения), персонаж не должен «убегать» сам.
  useEffect(() => {
    const onBlur = () => {
      stickPointer.current = null
      lookPointer.current = null
      setVirtualMove(0, 0, false)
      if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)'
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointercancel', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointercancel', onBlur)
    }
  }, [setVirtualMove])

  if (!touch) return null

  /** Ведёт стик по касанию: смещение от центра основы. */
  const moveStick = (event: React.PointerEvent<HTMLDivElement>) => {
    const base = stickRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2

    let dx = event.clientX - cx
    let dy = event.clientY - cy
    const distance = Math.hypot(dx, dy)

    // Палец дальше радиуса — стик упирается в край и не «убегает».
    if (distance > STICK_RADIUS) {
      dx = (dx / distance) * STICK_RADIUS
      dy = (dy / distance) * STICK_RADIUS
    }

    if (knobRef.current) {
      knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }

    // Нормируем и гасим мёртвую зону, чтобы лёгкое касание не давало рывка.
    let nx = dx / STICK_RADIUS
    let ny = -dy / STICK_RADIUS
    const len = Math.hypot(nx, ny)
    if (len < DEADZONE) {
      nx = 0
      ny = 0
    } else {
      const scaled = (len - DEADZONE) / (1 - DEADZONE) / len
      nx *= scaled
      ny *= scaled
    }
    setVirtualMove(nx, ny, true)
  }

  const onStickDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    stickPointer.current = event.pointerId
    moveStick(event)
  }

  const onStickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== event.pointerId) return
    moveStick(event)
  }

  const onStickUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== event.pointerId) return
    stickPointer.current = null
    setVirtualMove(0, 0, false)
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)'
  }

  // ─── Обзор: свайп по свободному полю экрана ───────────────────────────────
  const onLookDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    lookPointer.current = event.pointerId
    lookLast.current = { x: event.clientX, y: event.clientY }
  }

  const onLookMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointer.current !== event.pointerId) return
    const dx = event.clientX - lookLast.current.x
    const dy = event.clientY - lookLast.current.y
    lookLast.current = { x: event.clientX, y: event.clientY }
    // Пишем в ту же очередь, что и мышь: камера читает её без разницы,
    // откуда дельта пришла.
    useInputStore.getState().addMouseDelta(dx * LOOK_SCALE, dy * LOOK_SCALE)
  }

  const onLookUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointer.current !== event.pointerId) return
    lookPointer.current = null
  }

  /**
   * Кнопка-действие: держит клавишу, пока её нажимают.
   * `press` — нажать один раз (прыжок, дверь), `hold` — удерживать (бег).
   */
  const actionButton = (
    code: string,
    label: string,
    kind: 'press' | 'hold',
    extraClass = '',
  ) => (
    <button
      type="button"
      className={`touch__button touch__button--${kind} ${extraClass}`}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        setKey(code, true)
        if (kind === 'press') setKey(code, false)
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (kind === 'hold') setKey(code, false)
      }}
      onPointerCancel={() => {
        if (kind === 'hold') setKey(code, false)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  )

  return (
    <div className="touch" onContextMenu={(event) => event.preventDefault()}>
      {/* Зона обзора: свайп ведёт камеру. Под стиком и кнопками. */}
      <div
        className="touch__look"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />

      {/* Стик движения */}
      <div
        ref={stickRef}
        className="touch__stick"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        <div ref={knobRef} className="touch__stickKnob" />
      </div>

      {/* Кнопки действий */}
      <div className="touch__buttons">
        {actionButton('KeyE', 'Дверь', 'press')}
        {actionButton('ShiftLeft', 'Бег', 'hold')}
        {actionButton('Space', 'Прыжок', 'press', 'touch__button--jump')}
      </div>
    </div>
  )
}

/**
 * Мёртвая зона и радиус — наружу, чтобы их можно было подкрутить из devtools.
 */
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __touchConfig: { radius: number; deadzone: number } }).__touchConfig =
    { radius: STICK_RADIUS, deadzone: DEADZONE }
}

/** Текущее состояние стика — для тестов и отладки. */
export function readStick(): { x: number; y: number; active: boolean } {
  return readVirtualMove()
}
