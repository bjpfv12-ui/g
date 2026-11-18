import { useEffect, useState } from 'react'
import { playerState } from '../state/playerState'

/** Перевод метров в секунду в километры в час. */
const KMH = 3.6
/** Предел шкалы спидометра, км/ч. */
const MAX_KMH = 60

/**
 * Спидометр в углу HUD.
 *
 * Источник — реальная линейная скорость игрока из Rapier: контроллер
 * игрока берёт linvel() тела персонажа. Здесь переводим её в километры в час.
 */
export function Speedometer() {
  const [speed, setSpeed] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSpeed(playerState.speed)
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  const kmh = Math.min(speed * KMH, MAX_KMH)
  const fill = Math.min(kmh / MAX_KMH, 1)

  return (
    <div className="hud__gauge hud__gauge--speed">
      <span className="hud__gaugeValue">{kmh.toFixed(0)}</span>
      <span className="hud__gaugeLabel">км/ч</span>
      <span className="hud__speedBar">
        <span className="hud__speedFill" style={{ transform: `scaleX(${fill})` }} />
      </span>
    </div>
  )
}
