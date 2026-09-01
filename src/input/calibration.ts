/**
 * Input Processing — calibração de mínimo/máximo por eixo (RF-106).
 *
 * Motivo de existir (`g29-input-layer` §4): não se pode assumir que o curso
 * físico do pedal cobre exatamente a faixa que a lib documenta. Folga mecânica
 * e desgaste variam por unidade e ao longo do tempo, então a normalização usa
 * os extremos **observados naquele hardware**, não os teóricos.
 */

import type { Channel } from '../shared/contracts.js'
import { NEUTRAL_RAW, type RawChannels } from '../device/types.js'

export interface AxisCalibration {
  axis: Channel
  /** Menor valor bruto observado no eixo. */
  rawMin: number
  /** Maior valor bruto observado no eixo. */
  rawMax: number
  /** Epoch ms de quando a calibração foi capturada. */
  capturedAt: number
}

/**
 * Calibração completa dos três canais.
 *
 * `session-persistence` é quem decide **como** isto vai para o disco; aqui só
 * se define **o que** precisa ser persistido (`g29-input-layer` §4).
 */
export type CalibrationSet = Record<Channel, AxisCalibration>

/**
 * Faixas teóricas da lib, usadas apenas enquanto não há calibração real.
 *
 * Isto é um fallback para o software abrir e funcionar antes do piloto
 * calibrar, não um substituto do RF-106.
 */
export function defaultCalibration(capturedAt = 0): CalibrationSet {
  return {
    brake: { axis: 'brake', rawMin: 0, rawMax: 1, capturedAt },
    throttle: { axis: 'throttle', rawMin: 0, rawMax: 1, capturedAt },
    steering: { axis: 'steering', rawMin: 0, rawMax: 100, capturedAt },
  }
}

/** Uma calibração só é utilizável se os extremos não colapsaram no mesmo ponto. */
export function isUsable(calibration: AxisCalibration): boolean {
  return (
    Number.isFinite(calibration.rawMin) &&
    Number.isFinite(calibration.rawMax) &&
    calibration.rawMax > calibration.rawMin
  )
}

/**
 * Grava os extremos enquanto o piloto move cada eixo batente a batente
 * (`g29-input-layer` §4, passos 1–3).
 *
 * Começa sem nenhum valor em vez de partir dos extremos teóricos: se partisse
 * de `{min: 0, max: 1}`, um pedal que só alcança 0.1–0.9 seria "calibrado" para
 * a faixa teórica e a calibração não teria feito nada.
 */
export class CalibrationRecorder {
  #observed = new Map<Channel, { min: number; max: number }>()
  #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** Alimenta o gravador com uma leitura bruta. */
  observe(raw: RawChannels): void {
    this.#track('brake', raw.brake)
    this.#track('throttle', raw.throttle)
    this.#track('steering', raw.steering)
  }

  #track(axis: Channel, value: number): void {
    if (!Number.isFinite(value)) return
    const current = this.#observed.get(axis)
    if (!current) {
      this.#observed.set(axis, { min: value, max: value })
      return
    }
    current.min = Math.min(current.min, value)
    current.max = Math.max(current.max, value)
  }

  /** Extremos vistos até agora num eixo, ou `null` se ele nunca foi observado. */
  rangeFor(axis: Channel): { min: number; max: number } | null {
    const range = this.#observed.get(axis)
    return range ? { ...range } : null
  }

  /**
   * Eixos que ainda não cobriram um curso utilizável.
   *
   * A UI de calibração usa isto para dizer ao piloto o que falta mover, em vez
   * de aceitar uma calibração pela metade e produzir telemetria distorcida
   * silenciosamente.
   */
  incompleteAxes(): Channel[] {
    const pending: Channel[] = []
    for (const axis of ['brake', 'throttle', 'steering'] as const) {
      const range = this.#observed.get(axis)
      if (!range || range.max <= range.min) pending.push(axis)
    }
    return pending
  }

  /**
   * Fecha a calibração. Eixos incompletos caem no default teórico em vez de
   * gerar uma calibração inválida (`rawMax <= rawMin` faria a normalização
   * dividir por zero).
   */
  build(): CalibrationSet {
    const capturedAt = this.#now()
    const fallback = defaultCalibration(capturedAt)
    const result = {} as CalibrationSet

    for (const axis of ['brake', 'throttle', 'steering'] as const) {
      const range = this.#observed.get(axis)
      result[axis] =
        range && range.max > range.min
          ? { axis, rawMin: range.min, rawMax: range.max, capturedAt }
          : fallback[axis]
    }
    return result
  }

  reset(): void {
    this.#observed.clear()
  }
}

/** Estado neutro do dispositivo, reexportado para quem monta uma calibração à mão. */
export { NEUTRAL_RAW }
