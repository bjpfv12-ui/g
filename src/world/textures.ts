import * as THREE from 'three'

/** Асфальт: мелкий шум + лёгкие пятна, процедурная текстура без внешних файлов. */
export function createAsphaltTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#47474b'
  ctx.fillRect(0, 0, size, size)

  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n))
  }
  ctx.putImageData(image, 0, 0)

  // Пятна «потёков» — асфальт не бывает идеально ровным.
  for (let i = 0; i < 26; i++) {
    const r = 12 + Math.random() * 46
    ctx.globalAlpha = 0.05 + Math.random() * 0.07
    ctx.fillStyle = Math.random() > 0.5 ? '#4c4c50' : '#2f2f33'
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Земля за пределами города: сухая трава и пыль. */
export function createGroundTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#7c7452'
  ctx.fillRect(0, 0, size, size)

  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 40
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n * 0.8))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * 0.5))
  }
  ctx.putImageData(image, 0, 0)

  for (let i = 0; i < 400; i++) {
    ctx.globalAlpha = 0.08 + Math.random() * 0.12
    ctx.fillStyle = Math.random() > 0.5 ? '#8b8358' : '#6a6444'
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 9, 1 + Math.random() * 4)
  }
  ctx.globalAlpha = 1

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
