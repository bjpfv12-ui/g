import { useEffect, useState } from 'react'
import { timeState } from '../state/timeState'

/** Часы и фаза суток. Обновляются раз в четверть секунды. */
export function Clock() {
  const [view, setView] = useState({ clock: timeState.clock, label: timeState.label })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setView({ clock: timeState.clock, label: timeState.label })
    }, 250)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="hud__gauge hud__gauge--clock">
      <span className="hud__gaugeValue">{view.clock}</span>
      <span className="hud__gaugeLabel">{view.label}</span>
    </div>
  )
}
