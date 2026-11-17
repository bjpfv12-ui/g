import { useEffect, useState } from 'react'
import { useInputStore } from '../store/InputStore'
import { useUiStore } from '../store/UiStore'
import { playerState } from '../state/playerState'
import { Minimap } from './Minimap'
import { Clock } from './Clock'
import { Speedometer } from './Speedometer'

/** Живой HUD: координаты и скорость обновляются раз в 100 мс, без ре-рендера сцены. */
export function Hud() {
  const pointerLocked = useInputStore((state) => state.pointerLocked)
  const doorPrompt = useUiStore((state) => state.doorPrompt)
  const carPrompt = useUiStore((state) => state.carPrompt)
  const [telemetry, setTelemetry] = useState({ x: 0, z: 0, speed: 0, grounded: true })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTelemetry({
        x: playerState.position.x,
        z: playerState.position.z,
        speed: playerState.speed,
        grounded: playerState.grounded,
      })
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="hud">
      <header className="hud__brand">
        <span className="hud__title">SUNSET&nbsp;DISTRICT</span>
        <span className="hud__subtitle">open world prototype</span>
      </header>

      <div className="hud__telemetry">
        <div>
          <span className="hud__key">X</span>
          {telemetry.x.toFixed(0)} м
        </div>
        <div>
          <span className="hud__key">Z</span>
          {telemetry.z.toFixed(0)} м
        </div>
        <div>
          <span className="hud__key">V</span>
          {telemetry.speed.toFixed(1)} м/с
        </div>
      </div>

      <div className="hud__controls">
        <span>
          <b>W/S</b> движение
        </span>
        <span>
          <b>A/D</b> {TUNING.controlMode === 'body' ? 'поворот' : 'шаг вбок'}
        </span>
        <span>
          <b>Shift</b> бег
        </span>
        <span>
          <b>Space</b> прыжок / тормоз
        </span>
        <span>
          <b>E</b> дверь
        </span>
        <span>
          <b>F</b> сесть / выйти
        </span>
        <span>
          <b>Мышь</b> камера
        </span>
        <span>
          <b>Esc</b> пауза
        </span>
      </div>

      <div className="hud__map">
        <div className="hud__gauges">
          <Clock />
          <Speedometer />
        </div>
        <Minimap />
        <div className="hud__mapLegend">
          <span className="hud__dot hud__dot--player" />
          <span className="hud__dot hud__dot--traffic" />
          <span className="hud__dot hud__dot--ped" />
        </div>
      </div>

      {carPrompt || doorPrompt ? (
        <div className="hud__prompt">{carPrompt || doorPrompt}</div>
      ) : null}

      {!pointerLocked && (
        <div className="hud__overlay">
          <div className="hud__overlayCard">
            <h1>Sunset District</h1>
            <p>Кликните по экрану, чтобы войти в город.</p>
            <ul>
              <li>W/S — движение по курсу персонажа, A/D — поворот</li>
              <li>Shift — спринт, Space — прыжок</li>
              <li>Мышь — прицел и орбитальная камера</li>
            </ul>
            <span className="hud__cta">клик → захват мыши</span>
          </div>
        </div>
      )}
    </div>
  )
}
