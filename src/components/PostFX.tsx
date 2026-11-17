import {
  EffectComposer,
  Bloom,
  HueSaturation,
  ToneMapping,
  Vignette,
  Noise,
  createEffectComponent,
} from '@react-three/postprocessing'
import { ToneMappingMode, BlendFunction } from 'postprocessing'
import { ExposureEffect } from '../world/exposure'

const Exposure = createEffectComponent(ExposureEffect)

/**
 * Экспозиция кадра. Тонмаппинг живёт в композере, поэтому множитель
 * экспозиции тоже должен быть там: небо Preetham при солнце в 45° без него
 * выгорает в белый.
 */
const EXPOSURE = 0.24

/**
 * Порог свечения. После экспозиции окна и фонари светятся в единицах ~5,
 * небо — ~2.4, диск солнца — десятки, поэтому порог стоит выше неба.
 */
const BLOOM_THRESHOLD = 3

/**
 * Постобработка в духе GTA SA: мягкое свечение солнца и светящихся окон,
 * лёгкий подъём насыщенности, кинематографичное ACES-тонирование,
 * виньетка по краям кадра и плёночное зерно.
 *
 * Композер сам переводит рендерер в NoToneMapping, поэтому тональная
 * кривая применяется ровно один раз — уже на готовом HDR-кадре.
 *
 * Виньетка и зерно стоят после тонмаппинга: в линейном HDR-пространстве
 * крупинка плёнки почти не читается, а по краям кадра виньетка съедала бы
 * яркость сильнее, чем нужно.
 */
export function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <Exposure args={[{ exposure: EXPOSURE }]} />
      {/* Свечение: только самые яркие пиксели — солнце, окна, фонари. */}
      <Bloom
        intensity={0.7}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={0.5}
        mipmapBlur
        radius={0.8}
      />
      {/* Немного больше цвета: бетон становится теплее, трава — сочнее. */}
      <HueSaturation saturation={0.22} hue={0} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* Тёмные углы кадра — как на PS2-версии Los Santos. */}
      <Vignette offset={0.26} darkness={0.6} eskil={false} blendFunction={BlendFunction.NORMAL} />
      {/* Крупинка плёнки: слабая, но заметная в движении. */}
      <Noise opacity={0.05} premultiply blendFunction={BlendFunction.SOFT_LIGHT} />
    </EffectComposer>
  )
}
