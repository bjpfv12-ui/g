export interface CityConfig {
  /** Сид генератора: одинаковый сид — одинаковый город. */
  seed: number
  /** Количество кварталов по каждой оси. */
  blocks: number
  /** Размер квартала (без дорог), м. */
  blockSize: number
  /** Ширина проезжей части, м. */
  roadWidth: number
  /** Ширина тротуара вдоль дороги, м. */
  sidewalkWidth: number
  /** Высота бордюра, м. */
  curbHeight: number
  /** Минимальный размер участка под здание, м. */
  minLot: number
  /** Зазор между зданиями внутри участка, м. */
  buildingGap: number
  /** Высота зданий в деловом центре, м. */
  downtownHeight: number
  /** Высота зданий на окраине, м. */
  suburbHeight: number
  /** Шаг высоты этажа, м. */
  floorHeight: number
  /** Шаг окон по горизонтали, м. */
  windowSpacing: number
  /** Радиус внешнего кольца «дальнего скайлайна», м. */
  skylineRadius: number
}

export const DEFAULT_CITY: CityConfig = {
  seed: 20261117,
  blocks: 7,
  blockSize: 64,
  roadWidth: 16,
  sidewalkWidth: 5,
  curbHeight: 0.15,
  minLot: 21,
  buildingGap: 1.4,
  downtownHeight: 86,
  suburbHeight: 14,
  floorHeight: 3.6,
  windowSpacing: 4.4,
  skylineRadius: 420,
}

/** Высота игрока (рост капсулы), м. */
export const PLAYER_HEIGHT = 1.78
