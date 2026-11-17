import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = /* glsl */ `
uniform float exposure;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}
`

/**
 * Экспозиция кадра перед тонмаппингом.
 *
 * Когда тонмаппинг переезжает в композер, рендерер переключается в
 * NoToneMapping и его `toneMappingExposure` перестаёт работать. Небо Preetham
 * при солнце в 45° даёт радиантность порядка 10, поэтому ACES на входе
 * без экспозиции уводит небо в чистый белый. Этот эффект возвращает
 * недостающий множитель и делает яркость кадра управляемой.
 */
export class ExposureEffect extends Effect {
  constructor({ exposure = 1 }: { exposure?: number } = {}) {
    super('ExposureEffect', fragmentShader, {
      uniforms: new Map([['exposure', new Uniform(exposure)]]),
    })
  }

  get exposure(): number {
    return this.uniforms.get('exposure')!.value
  }

  set exposure(value: number) {
    this.uniforms.get('exposure')!.value = value
  }
}
