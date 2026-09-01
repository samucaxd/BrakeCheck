/**
 * Input Processing — junta calibração, deadzone e normalização e entrega o
 * `TelemetrySample` do contrato (RF-106 a RF-108).
 *
 * **Onde esta camada para** (`g29-input-layer`): aqui. Duração, taxa de
 * aplicação/liberação, overlap, consistência — nada disso é calculado neste
 * arquivo, mesmo parecendo natural continuar. Isso é `telemetry-engine`.
 */

import { DEFAULT_DEADZONE_PERCENT } from '../config/provisional.js'
import type { RawSample } from '../device/types.js'
import type { Channel, TelemetrySample } from '../shared/contracts.js'
import {
  defaultCalibration,
  type CalibrationSet,
} from './calibration.js'
import {
  applyDeadzoneBipolar,
  applyDeadzoneUnipolar,
  normalizePedal,
  normalizeSteering,
} from './normalize.js'

/** Deadzone em % da faixa normalizada, por eixo (RF-107). */
export type DeadzoneSettings = Record<Channel, number>

export function defaultDeadzones(): DeadzoneSettings {
  return {
    brake: DEFAULT_DEADZONE_PERCENT,
    throttle: DEFAULT_DEADZONE_PERCENT,
    steering: DEFAULT_DEADZONE_PERCENT,
  }
}

export interface InputProcessorOptions {
  calibration?: CalibrationSet
  deadzones?: Partial<DeadzoneSettings>
}

/**
 * Converte amostras brutas do Device Layer em `TelemetrySample`.
 *
 * Sem estado entre amostras de propósito: cada amostra é traduzida
 * isoladamente. Suavização/filtro temporal seria análise, não processamento de
 * input, e mascararia justamente as transições rápidas que o RF-103 quer
 * capturar.
 */
export class InputProcessor {
  #calibration: CalibrationSet
  #deadzones: DeadzoneSettings

  constructor(options: InputProcessorOptions = {}) {
    this.#calibration = options.calibration ?? defaultCalibration()
    this.#deadzones = { ...defaultDeadzones(), ...options.deadzones }
  }

  /** RF-106 — troca a calibração ativa (ex.: o piloto recalibrou). */
  setCalibration(calibration: CalibrationSet): void {
    this.#calibration = calibration
  }

  getCalibration(): CalibrationSet {
    return this.#calibration
  }

  /** RF-107 — a deadzone é configurável, nunca fixa no código. */
  setDeadzone(axis: Channel, percent: number): void {
    this.#deadzones = { ...this.#deadzones, [axis]: percent }
  }

  getDeadzones(): DeadzoneSettings {
    return { ...this.#deadzones }
  }

  /** Traduz uma amostra bruta para o contrato de saída da camada. */
  process(raw: RawSample): TelemetrySample {
    return {
      timestamp: raw.timestamp,
      brake: applyDeadzoneUnipolar(
        normalizePedal(raw.brake, this.#calibration.brake),
        this.#deadzones.brake,
      ),
      throttle: applyDeadzoneUnipolar(
        normalizePedal(raw.throttle, this.#calibration.throttle),
        this.#deadzones.throttle,
      ),
      steering: applyDeadzoneBipolar(
        normalizeSteering(raw.steering, this.#calibration.steering),
        this.#deadzones.steering,
      ),
    }
  }
}
