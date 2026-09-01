/**
 * RF-209 — consistência entre tentativas de um mesmo exercício.
 *
 * Diferente de todo o resto desta camada, que é por tentativa: aqui a entrada é
 * a lista de `DerivedMetrics` de N tentativas (`telemetry-engine` §3).
 *
 * **Esta função não decide nada.** Ela entrega o número; se aquilo conta como
 * "consistente o suficiente" para liberar avanço de nível é da
 * `evaluation-scoring-engine` (RN-03).
 */

import type { DerivedMetrics } from './types.js'

/**
 * Métricas-chave sobre as quais a consistência é medida.
 *
 * As três primeiras são as que `telemetry-engine` §3 cita como típicas; o
 * exercício pode escolher outro subconjunto via `braking-training-engine`.
 */
export type ConsistencyMetricKey =
  | 'applicationSpeed'
  | 'releaseSpeed'
  | 'peakValue'
  | 'timeToPeak'

export const DEFAULT_CONSISTENCY_KEYS: readonly ConsistencyMetricKey[] = [
  'applicationSpeed',
  'releaseSpeed',
  'peakValue',
]

export interface ConsistencyStat {
  /** Tentativas que tinham a métrica disponível. */
  sampleCount: number
  mean: number
  /** Desvio padrão **amostral** (n−1). `null` com menos de 2 tentativas. */
  stddev: number | null
  /**
   * Coeficiente de variação — `stddev / |mean|`, adimensional.
   *
   * Mais útil que o desvio sozinho porque permite comparar consistência entre
   * métricas de escalas diferentes (%/s e ms não são comparáveis em valor
   * absoluto). `null` quando não é calculável.
   */
  coefficientOfVariation: number | null
}

export interface ConsistencyReport {
  /** Tentativas recebidas, incluindo as que não tinham métrica alguma. */
  attemptCount: number
  byMetric: Partial<Record<ConsistencyMetricKey, ConsistencyStat>>
}

const SELECTORS: Record<ConsistencyMetricKey, (m: DerivedMetrics) => number | null> = {
  applicationSpeed: (m) => m.brakingAggregate.applicationSpeedPctPerS,
  releaseSpeed: (m) => m.brakingAggregate.releaseSpeedPctPerS,
  peakValue: (m) => m.brakingAggregate.peakValue,
  timeToPeak: (m) => m.brakingAggregate.timeToPeakMs,
}

/**
 * Calcula consistência entre tentativas.
 *
 * Tentativas sem a métrica (ex.: nenhuma frenagem detectada) são **excluídas**
 * daquela estatística em vez de entrarem como zero — uma tentativa em que o
 * piloto não freou não é uma frenagem inconsistente, é ausência de dado.
 * `sampleCount` versus `attemptCount` deixa isso visível para quem consome.
 */
export function computeConsistency(
  attempts: readonly DerivedMetrics[],
  keys: readonly ConsistencyMetricKey[] = DEFAULT_CONSISTENCY_KEYS,
): ConsistencyReport {
  const byMetric: Partial<Record<ConsistencyMetricKey, ConsistencyStat>> = {}

  for (const key of keys) {
    const select = SELECTORS[key]
    const values: number[] = []
    for (const attempt of attempts) {
      const value = select(attempt)
      if (value !== null && Number.isFinite(value)) values.push(value)
    }
    if (values.length === 0) continue
    byMetric[key] = summarize(values)
  }

  return { attemptCount: attempts.length, byMetric }
}

function summarize(values: readonly number[]): ConsistencyStat {
  const n = values.length
  const mean = values.reduce((sum, v) => sum + v, 0) / n

  /**
   * Com uma única tentativa não há variabilidade a estimar — o desvio amostral
   * dividiria por zero. `null` é a resposta correta, e não 0: zero significaria
   * "perfeitamente consistente", que é justamente a conclusão que uma tentativa
   * só não autoriza (RN-03 existe por causa disso).
   */
  if (n < 2) {
    return { sampleCount: n, mean, stddev: null, coefficientOfVariation: null }
  }

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  const stddev = Math.sqrt(variance)

  /**
   * Denominador em valor absoluto: entre as métricas-chave todas são
   * não-negativas, mas se um exercício apontar a consistência para um canal que
   * pode ser negativo (steering), `stddev / mean` devolveria um CV negativo,
   * que não significa nada. Magnitude é o que interessa aqui.
   */
  const coefficientOfVariation = mean !== 0 ? stddev / Math.abs(mean) : null

  return { sampleCount: n, mean, stddev, coefficientOfVariation }
}
