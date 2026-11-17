import { useEffect, useMemo, useRef } from 'react'
import { DEFAULT_CITY, type CityConfig } from '../world/cityConfig'
import { getCityOutline } from '../world/cityLayout'
import { playerState } from '../state/playerState'
import { worldState } from '../state/worldState'

const SIZE = 190
const VIEW_METERS = 260

/**
 * Мини-карта: город видом сверху, стрелка игрока, точки транспорта и пешеходов.
 */
export function Minimap({ config = DEFAULT_CITY }: { config?: CityConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const outline = useMemo(() => getCityOutline(config), [config])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    let raf = 0
    let last = 0

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw)
      if (time - last < 60) return
      last = time

      const px = playerState.position.x
      const pz = playerState.position.z
      const scale = SIZE / VIEW_METERS

      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#15181d'
      ctx.fillRect(0, 0, SIZE, SIZE)

      ctx.save()
      ctx.translate(SIZE / 2, SIZE / 2)
      ctx.scale(scale, scale)
      ctx.translate(-px, -pz)

      // Кварталы — сплошная застройка.
      ctx.fillStyle = '#2b3138'
      const { lines, blockSize, roadWidth } = outline
      for (let i = 0; i < lines.length - 1; i++) {
        for (let j = 0; j < lines.length - 1; j++) {
          const x0 = lines[i] + roadWidth / 2
          const z0 = lines[j] + roadWidth / 2
          ctx.fillRect(x0, z0, blockSize, blockSize)
        }
      }

      // Осевые линии улиц.
      ctx.strokeStyle = 'rgba(255, 176, 102, 0.22)'
      ctx.lineWidth = 1.5 / scale
      for (const line of lines) {
        ctx.beginPath()
        ctx.moveTo(line, -outline.extent / 2)
        ctx.lineTo(line, outline.extent / 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-outline.extent / 2, line)
        ctx.lineTo(outline.extent / 2, line)
        ctx.stroke()
      }

      // Транспорт и пешеходы.
      ctx.fillStyle = '#ffb066'
      for (const car of worldState.traffic) {
        ctx.beginPath()
        ctx.arc(car.x, car.z, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#7fd0c4'
      for (const ped of worldState.pedestrians) {
        ctx.beginPath()
        ctx.arc(ped.x, ped.z, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()

      // Стрелка игрока в центре карты.
      ctx.save()
      ctx.translate(SIZE / 2, SIZE / 2)
      ctx.rotate(-playerState.facing)
      ctx.beginPath()
      ctx.moveTo(0, -7)
      ctx.lineTo(5, 6)
      ctx.lineTo(0, 3)
      ctx.lineTo(-5, 6)
      ctx.closePath()
      ctx.fillStyle = '#ffd79a'
      ctx.fill()
      ctx.strokeStyle = '#1b1512'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [outline])

  return <canvas ref={canvasRef} className="minimap" style={{ width: SIZE, height: SIZE }} />
}
