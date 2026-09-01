/**
 * Métricas específicas de exercício (`braking-training-engine` §4).
 *
 * Estas combinam canais de um jeito que só faz sentido para um exercício, então
 * não pertencem à `telemetry-engine`, que é genérica. Elas **reaproveitam** as
 * primitivas da camada 2 (`intervalDurationMs`) em vez de reimplementar a
 * convenção de medida por intervalo — a skill é explícita: se um cálculo daqui
 * amadurecer e virar genérico, ele deve ser promovido para lá, nunca duplicado.
 *
 * Todas operam sobre a série de **uma tentativa**, que dura segundos. Isso não
 * conflita com o TC-204, cuja preocupação é a sessão inteira.
 */

import {
  BRAKE_EVENT_THRESHOLD_PERCENT,
  STEERING_ACTIVE_THRESHOLD_PERCENT,
  STEERING_PRONOUNCED_THRESHOLD_PERCENT,
} from '../config/provisional.js'
import type { TelemetrySample } from '../shared/contracts.js'
import { intervalDurationMs } from '../telemetry/intervals.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import type { Band, BandSegment, ProfilePoint } from './types.js'

export interface ExerciseMetricsInput {
  samples: readonly TelemetrySample[]
  metrics: DerivedMetrics
  /** Epoch ms em que o marcador de ponto de frenagem foi exibido (exercício 6). */
  markerTimestamp?: number
}

/** Todas opcionais: cada exercício usa um subconjunto. */
export interface ExerciseMetrics {
  /** Exercício 6 — atraso entre o marcador e o início da frenagem, em ms. */
  reactionDeltaMs: number | null
  /** Exercício 3 — amplitude de `steering` durante o evento de frenagem. */
  steeringRangeDuringBraking: number | null
  /** Exercício 12 — tempo com freio residual e volante já girando. */
  brakeSteeringOverlapMs: number
  /** Exercício 14 — intervalo entre o pico de freio e o esterçamento acentuado. */
  stabilizationIntervalMs: number | null
  /** Exercício 15 — correlação de Pearson entre `brake` e `|steering|` na janela de overlap. */
  brakeSteeringCorrelation: number | null
  /** Exercício 11 — desvio médio absoluto em relação ao perfil-alvo, em pontos percentuais. */
  profileMeanDeviation: number | null
  /** Exercício 9 — fração da janela de cada sub-faixa passada dentro dela. */
  subBandCoverage: number[]
}

/** Janela `[startMs, endMs]` do primeiro evento de frenagem, relativa à tentativa. */
function firstEventWindow(metrics: DerivedMetrics): { startMs: number; endMs: number } | null {
  const event = metrics.brakingEvents[0]
  return event ? { startMs: event.startMs, endMs: event.endMs } : null
}

function relativeMs(samples: readonly TelemetrySample[], sample: TelemetrySample): number {
  const first = samples[0]
  return first ? sample.timestamp - first.timestamp : 0
}

function withinWindow(
  samples: readonly TelemetrySample[],
  window: { startMs: number; endMs: number },
): TelemetrySample[] {
  return samples.filter((s) => {
    const t = relativeMs(samples, s)
    return t >= window.startMs && t <= window.endMs
  })
}

/**
 * Exercício 6 — atraso de reação ao marcador.
 *
 * `null` quando não houve marcador ou o piloto não freou: ausência de frenagem
 * não é "reação infinitamente lenta", é ausência de dado, e transformá-la em um
 * número penalizaria a consistência com um valor inventado.
 */
export function reactionDelta(input: ExerciseMetricsInput): number | null {
  const { samples, metrics, markerTimestamp } = input
  const event = metrics.brakingEvents[0]
  const first = samples[0]
  if (markerTimestamp === undefined || !event || !first) return null
  return first.timestamp + event.startMs - markerTimestamp
}

/** Exercício 3 — o quanto o volante variou durante a frenagem. */
export function steeringRangeDuringBraking(input: ExerciseMetricsInput): number | null {
  const window = firstEventWindow(input.metrics)
  if (!window) return null

  const inWindow = withinWindow(input.samples, window)
  if (inWindow.length === 0) return null

  let min = Infinity
  let max = -Infinity
  for (const sample of inWindow) {
    min = Math.min(min, sample.steering)
    max = Math.max(max, sample.steering)
  }
  return max - min
}

/**
 * Exercício 12 — overlap entre freio residual e volante já girando.
 *
 * Mesma primitiva do RF-208, aplicada a outro par de canais, exatamente como a
 * skill §4 instrui.
 */
export function brakeSteeringOverlapMs(
  samples: readonly TelemetrySample[],
  brakeThreshold = BRAKE_EVENT_THRESHOLD_PERCENT,
  steeringThreshold = STEERING_ACTIVE_THRESHOLD_PERCENT,
): number {
  return intervalDurationMs(
    samples,
    (s) => s.brake > brakeThreshold && Math.abs(s.steering) > steeringThreshold,
  )
}

/**
 * Exercício 14 — tempo entre o pico de freio e o primeiro esterçamento acentuado.
 *
 * `null` se não houve pico ou o piloto nunca esterçou de forma acentuada — não
 * há intervalo a medir. Um valor **negativo** é informação real e é preservado:
 * significa que o piloto esterçou forte *antes* do pico, que é exatamente o erro
 * que o exercício procura.
 */
export function stabilizationIntervalMs(
  input: ExerciseMetricsInput,
  pronouncedThreshold = STEERING_PRONOUNCED_THRESHOLD_PERCENT,
): number | null {
  const { samples, metrics } = input
  const event = metrics.brakingEvents[0]
  if (!event) return null

  for (const sample of samples) {
    if (Math.abs(sample.steering) > pronouncedThreshold) {
      return relativeMs(samples, sample) - event.peakMs
    }
  }
  return null
}

/**
 * Exercício 15 — correlação de Pearson entre `brake` e `|steering|` na janela de
 * overlap.
 *
 * O exercício quer freio residual **caindo** conforme o ângulo **cresce**, então
 * o resultado esperado é fortemente negativo. `null` quando não há variação em
 * um dos canais (desvio zero ⇒ correlação indefinida, não zero).
 */
export function brakeSteeringCorrelation(
  samples: readonly TelemetrySample[],
  brakeThreshold = BRAKE_EVENT_THRESHOLD_PERCENT,
  steeringThreshold = STEERING_ACTIVE_THRESHOLD_PERCENT,
): number | null {
  const window = samples.filter(
    (s) => s.brake > brakeThreshold && Math.abs(s.steering) > steeringThreshold,
  )
  if (window.length < 3) return null

  const n = window.length
  const brakeMean = window.reduce((sum, s) => sum + s.brake, 0) / n
  const steerMean = window.reduce((sum, s) => sum + Math.abs(s.steering), 0) / n

  let covariance = 0
  let brakeVariance = 0
  let steerVariance = 0
  for (const sample of window) {
    const db = sample.brake - brakeMean
    const ds = Math.abs(sample.steering) - steerMean
    covariance += db * ds
    brakeVariance += db * db
    steerVariance += ds * ds
  }

  const denominator = Math.sqrt(brakeVariance * steerVariance)
  return denominator > 0 ? covariance / denominator : null
}

/** Interpola linearmente o perfil-alvo do exercício 11 em um instante. */
function targetAt(profile: readonly ProfilePoint[], atMs: number): number | null {
  if (profile.length === 0) return null

  const first = profile[0]!
  const last = profile[profile.length - 1]!
  if (atMs <= first.atMs) return first.target
  if (atMs >= last.atMs) return last.target

  for (let i = 1; i < profile.length; i++) {
    const previous = profile[i - 1]!
    const current = profile[i]!
    if (atMs <= current.atMs) {
      const span = current.atMs - previous.atMs
      if (span <= 0) return current.target
      const ratio = (atMs - previous.atMs) / span
      return previous.target + (current.target - previous.target) * ratio
    }
  }
  return last.target
}

/**
 * Exercício 11 — desvio médio absoluto entre o freio executado e o perfil-alvo,
 * medido apenas dentro do evento de frenagem.
 */
export function profileMeanDeviation(
  input: ExerciseMetricsInput,
  profile: readonly ProfilePoint[],
): number | null {
  const window = firstEventWindow(input.metrics)
  if (!window) return null

  const { samples } = input
  let sum = 0
  let count = 0
  for (const sample of samples) {
    const t = relativeMs(samples, sample)
    if (t < window.startMs || t > window.endMs) continue
    const target = targetAt(profile, t - window.startMs)
    if (target === null) continue
    sum += Math.abs(sample.brake - target)
    count++
  }
  return count > 0 ? sum / count : null
}

/** Exercício 9 — fração da janela de cada sub-faixa passada dentro dela. */
export function subBandCoverage(
  samples: readonly TelemetrySample[],
  segments: readonly BandSegment[],
): number[] {
  const first = samples[0]
  if (!first) return segments.map(() => 0)

  return segments.map((segment) => {
    const windowMs = segment.endMs - segment.startMs
    if (!(windowMs > 0)) return 0

    const inSegment = samples.filter((s) => {
      const t = s.timestamp - first.timestamp
      return t >= segment.startMs && t <= segment.endMs
    })
    const insideMs = intervalDurationMs(inSegment, (s) => inBand(s.brake, segment.band))
    return insideMs / windowMs
  })
}

export function inBand(value: number, band: Band): boolean {
  return value >= band[0] && value <= band[1]
}

/**
 * Calcula todas as métricas específicas de uma vez.
 *
 * Cada exercício consome só o subconjunto que declarou em `metricsUsed`; o custo
 * de calcular as demais sobre uma série de poucos segundos é irrelevante perto
 * da complexidade de agendar cálculo por exercício.
 */
export function computeExerciseMetrics(
  input: ExerciseMetricsInput,
  options: {
    profile?: readonly ProfilePoint[]
    segments?: readonly BandSegment[]
  } = {},
): ExerciseMetrics {
  return {
    reactionDeltaMs: reactionDelta(input),
    steeringRangeDuringBraking: steeringRangeDuringBraking(input),
    brakeSteeringOverlapMs: brakeSteeringOverlapMs(input.samples),
    stabilizationIntervalMs: stabilizationIntervalMs(input),
    brakeSteeringCorrelation: brakeSteeringCorrelation(input.samples),
    profileMeanDeviation: options.profile
      ? profileMeanDeviation(input, options.profile)
      : null,
    subBandCoverage: options.segments ? subBandCoverage(input.samples, options.segments) : [],
  }
}
