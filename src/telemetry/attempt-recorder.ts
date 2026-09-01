/**
 * Telemetry Engine — cálculo incremental das métricas de uma tentativa.
 *
 * Cobre RF-202 a RF-208 e RF-210. Consome `TelemetrySample` da camada de Input
 * Processing e devolve `AttemptTelemetry`.
 *
 * O recorder é **streaming por requisito**, não por elegância: TC-204 exige uma
 * sessão de ~1h sem degradação nem vazamento de memória, e a 100 Hz isso são
 * 360 mil amostras. Nada aqui guarda a série — os acumuladores são O(1) e os
 * eventos de frenagem são O(nº de frenagens).
 */

import {
  BRAKE_EVENT_THRESHOLD_PERCENT,
  THROTTLE_OVERLAP_THRESHOLD_PERCENT,
} from '../config/provisional.js'
import type { TelemetrySample } from '../shared/contracts.js'
import { BrakingEventDetector } from './braking-events.js'
import type {
  AttemptTelemetry,
  BrakingAggregate,
  BrakingEvent,
  ChannelStats,
  DerivedMetrics,
} from './types.js'

export interface AttemptRecorderOptions {
  /** Referência de onde a série bruta está guardada (RF-210). */
  rawSamplesRef: string
  /** Limiar de início/fim de evento de frenagem, em %. */
  brakeThreshold?: number
  /** Limiar de acelerador para overlap (RF-208), em %. */
  throttleThreshold?: number
  /**
   * Faixa `[low, high]` de curso do freio para RF-206, definida pelo exercício.
   * Sem faixa, a métrica sai `null` — inventar uma faixa default produziria um
   * número sem significado para o exercício em questão.
   */
  pressureBand?: readonly [number, number]
  /**
   * Destino da série bruta. A Telemetry Engine não persiste nada
   * (`telemetry-engine` §4) — só repassa, para que a `session-persistence`
   * escreva em disco sem que a série precise existir inteira em memória.
   */
  onSample?: (sample: TelemetrySample) => void
}

/** Acumulador de mín/máx de um canal. */
class ChannelAccumulator {
  #min: number | null = null
  #max: number | null = null

  push(value: number): void {
    if (!Number.isFinite(value)) return
    this.#min = this.#min === null ? value : Math.min(this.#min, value)
    this.#max = this.#max === null ? value : Math.max(this.#max, value)
  }

  result(): ChannelStats {
    return { min: this.#min, max: this.#max }
  }
}

export class AttemptRecorder {
  #options: AttemptRecorderOptions
  #brakeThreshold: number
  #throttleThreshold: number

  #brake = new ChannelAccumulator()
  #throttle = new ChannelAccumulator()
  #steering = new ChannelAccumulator()
  #detector: BrakingEventDetector

  #firstTimestamp: number | null = null
  #lastSample: TelemetrySample | null = null
  #sampleCount = 0
  #pressureRangeMs = 0
  #overlapMs = 0
  #finished = false

  constructor(options: AttemptRecorderOptions) {
    this.#options = options
    this.#brakeThreshold = options.brakeThreshold ?? BRAKE_EVENT_THRESHOLD_PERCENT
    this.#throttleThreshold =
      options.throttleThreshold ?? THROTTLE_OVERLAP_THRESHOLD_PERCENT
    this.#detector = new BrakingEventDetector(this.#brakeThreshold)
  }

  get sampleCount(): number {
    return this.#sampleCount
  }

  /** Consome uma amostra. Ordem cronológica é premissa — o sampler garante. */
  add(sample: TelemetrySample): void {
    if (this.#finished) {
      throw new Error('AttemptRecorder.add() chamado após finish()')
    }

    if (this.#firstTimestamp === null) this.#firstTimestamp = sample.timestamp

    this.#brake.push(sample.brake)
    this.#throttle.push(sample.throttle)
    this.#steering.push(sample.steering)

    this.#accumulateIntervals(sample)

    this.#detector.push(sample.timestamp - this.#firstTimestamp, sample.brake)

    this.#sampleCount++
    this.#lastSample = sample
    this.#options.onSample?.(sample)
  }

  /**
   * Acumula as métricas que são medidas em **intervalo**, não em ponto
   * (RF-206 e RF-208).
   *
   * O Δt entre duas amostras é creditado ao estado da amostra **anterior**, que
   * é o que se sabe ter valido durante aquele intervalo. Atribuir ao estado
   * seguinte contaria como "dentro da faixa" um trecho em que o pedal ainda não
   * tinha chegado lá.
   */
  #accumulateIntervals(sample: TelemetrySample): void {
    const previous = this.#lastSample
    if (previous === null) return

    const deltaMs = sample.timestamp - previous.timestamp
    if (!(deltaMs > 0)) return

    const band = this.#options.pressureBand
    if (band && previous.brake >= band[0] && previous.brake <= band[1]) {
      this.#pressureRangeMs += deltaMs
    }

    if (
      previous.brake > this.#brakeThreshold &&
      previous.throttle > this.#throttleThreshold
    ) {
      this.#overlapMs += deltaMs
    }
  }

  /**
   * Fecha a tentativa e devolve as métricas.
   *
   * Uma tentativa sem amostras, ou com uma só, produz métricas zeradas/`null` em
   * vez de exceção — é o TC-203 (tentativa de poucos ms não pode travar nem
   * gerar métrica inválida).
   */
  finish(): AttemptTelemetry {
    this.#finished = true

    const first = this.#firstTimestamp
    const last = this.#lastSample
    const durationMs = first !== null && last !== null ? last.timestamp - first : 0

    const events =
      first !== null && last !== null
        ? this.#detector.finish(last.timestamp - first, last.brake)
        : []

    return {
      rawSamplesRef: this.#options.rawSamplesRef,
      derivedMetrics: {
        durationMs,
        sampleCount: this.#sampleCount,
        brake: this.#brake.result(),
        throttle: this.#throttle.result(),
        steering: this.#steering.result(),
        brakingEvents: events,
        brakingAggregate: aggregate(events),
        timeInPressureRange: this.#options.pressureBand
          ? { band: this.#options.pressureBand, durationMs: this.#pressureRangeMs }
          : null,
        overlap: {
          durationMs: this.#overlapMs,
          pctOfDuration: durationMs > 0 ? (this.#overlapMs / durationMs) * 100 : null,
        },
      } satisfies DerivedMetrics,
    }
  }
}

/**
 * Agregação padrão entre múltiplos eventos de uma tentativa: média simples
 * (`telemetry-engine` §2 e §6). A `braking-training-engine` pode sobrepor isso
 * por exercício.
 */
function aggregate(events: readonly BrakingEvent[]): BrakingAggregate {
  return {
    eventCount: events.length,
    peakValue: meanOf(events, (e) => e.peakValue),
    timeToPeakMs: meanOf(events, (e) => e.timeToPeakMs),
    applicationSpeedPctPerS: meanOf(events, (e) => e.applicationSpeedPctPerS),
    releaseSpeedPctPerS: meanOf(events, (e) => e.releaseSpeedPctPerS),
  }
}

/**
 * Média ignorando os eventos cujo valor é `null`.
 *
 * Um evento sem velocidade de aplicação mensurável (subida em uma única
 * amostra) não deve puxar a média para baixo como se fosse zero — ele
 * simplesmente não tem o que informar.
 */
function meanOf(
  events: readonly BrakingEvent[],
  select: (event: BrakingEvent) => number | null,
): number | null {
  let sum = 0
  let count = 0
  for (const event of events) {
    const value = select(event)
    if (value === null || !Number.isFinite(value)) continue
    sum += value
    count++
  }
  return count > 0 ? sum / count : null
}
