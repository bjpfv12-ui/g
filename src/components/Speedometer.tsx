/**
 * Спидометр в углу HUD.
 *
 * Пока это заглушка со значением 0: реальная скорость игрока будет подключена
 * отдельным шагом, здесь держим только каркас панели.
 */
const SPEED_PLACEHOLDER = 0

export function Speedometer({ value = SPEED_PLACEHOLDER }: { value?: number }) {
  return (
    <div className="hud__gauge hud__gauge--speed">
      <span className="hud__gaugeValue">{value.toFixed(0)}</span>
      <span className="hud__gaugeLabel">км/ч</span>
    </div>
  )
}
