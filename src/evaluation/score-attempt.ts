/**
 * Pontuação de uma tentativa: sub-scores, agregado e classificação
 * (RF-401, RF-402, RF-403).
 */

import { computeConsistency } from '../telemetry/consistency.js'
import type { ConsistencyMetricKey } from '../telemetry/consistency.js'
import { intervalDurationMs } from '../telemetry/intervals.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import { inBand } from '../training/exercise-metrics.js'
import type { ExerciseMetrics } from '../training/exercise-metrics.js'
import type {
  ConsistencyKey,
  Exercise,
  ScorableMetric,
  SubScoreSpec,
} from '../training/types.js'
import type { TelemetrySample } from '../shared/contracts.js'
import {
  scoreConsistency,
  scoreCorrelation,
  scoreProportion,
  scoreTargetRange,
  scoreTargetValue,
} from './scoring-functions.js'
import type { PerformanceLevel, ScoreResult, SubScore } from './types.js'

export interface ScoreAttemptInput {
  attemptRef: string
  exercise: Exercise
  metrics: DerivedMetrics
  exerciseMetrics: ExerciseMetrics
  samples?: readonly TelemetrySample[]
  /** Métricas do bloco, exigidas pelos sub-scores de consistência. */
  blockMetrics?: readonly DerivedMetrics[]
  /** Métricas específicas do bloco, para consistência de métrica de exercício. */
  blockExerciseMetrics?: readonly ExerciseMetrics[]
}

/**
 * Fração do evento de frenagem passada dentro da faixa de threshold.
 *
 * Não dá para reusar `timeInPressureRange`: aquele mede a tentativa inteira, e
 * aqui a referência é o evento.
 */
function eventBandCoverage(
  exercise: Exercise,
  metrics: DerivedMetrics,
  samples: readonly TelemetrySample[],
): number | null {
  const event = metrics.brakingEvents[0]
  const criterion = exercise.successCriteria
  if (!event || criterion.kind !== 'peak_sustained') return null

  const eventMs = event.endMs - event.startMs
  if (!(eventMs > 0)) return null

  const first = samples[0]
  if (!first) return null

  const inEvent = samples.filter((sample) => {
    const t = sample.timestamp - first.timestamp
    return t >= event.startMs && t <= event.endMs
  })
  return intervalDurationMs(inEvent, (s) => inBand(s.brake, criterion.band)) / eventMs
}

/** Resolve o valor bruto sobre o qual a fórmula do sub-score vai operar. */
function resolveMetric(
  metric: ScorableMetric,
  input: ScoreAttemptInput,
): number | null {
  const { metrics, exerciseMetrics } = input

  switch (metric) {
    case 'applicationSpeed':
      return metrics.brakingAggregate.applicationSpeedPctPerS
    case 'releaseSpeed':
      return metrics.brakingAggregate.releaseSpeedPctPerS
    case 'peakValue':
      return metrics.brakingAggregate.peakValue
    case 'timeToPeak':
      return metrics.brakingAggregate.timeToPeakMs
    case 'brakeMax':
      return metrics.brake.max
    case 'pressureRangeMs':
      return metrics.timeInPressureRange?.durationMs ?? null
    case 'eventBandCoverage':
      return eventBandCoverage(input.exercise, metrics, input.samples ?? [])
    case 'worstSubBandCoverage':
      return exerciseMetrics.subBandCoverage.length > 0
        ? Math.min(...exerciseMetrics.subBandCoverage)
        : null
    case 'steeringRangeDuringBraking':
      return exerciseMetrics.steeringRangeDuringBraking
    case 'reactionDelta':
      return exerciseMetrics.reactionDeltaMs
    case 'stabilizationInterval':
      return exerciseMetrics.stabilizationIntervalMs
    case 'brakeSteeringOverlap':
      return exerciseMetrics.brakeSteeringOverlapMs
    case 'brakeThrottleOverlap':
      return metrics.overlap.durationMs
    case 'brakeSteeringCorrelation':
      return exerciseMetrics.brakeSteeringCorrelation
    case 'profileDeviation':
      return exerciseMetrics.profileMeanDeviation
  }
}

/** CV de uma métrica ao longo do bloco, para os sub-scores de consistência. */
function blockCoefficientOfVariation(
  key: ConsistencyKey,
  input: ScoreAttemptInput,
): number | null {
  if (key === 'reactionDelta') {
    const values = (input.blockExerciseMetrics ?? [])
      .map((m) => m.reactionDeltaMs)
      .filter((v): v is number => v !== null && Number.isFinite(v))
    if (values.length < 2) return null
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    if (mean === 0) return null
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
    return Math.sqrt(variance) / Math.abs(mean)
  }

  const block = input.blockMetrics ?? []
  if (block.length < 2) return null
  const report = computeConsistency(block, [key as ConsistencyMetricKey])
  return report.byMetric[key as ConsistencyMetricKey]?.coefficientOfVariation ?? null
}

function applySpec(spec: SubScoreSpec, input: ScoreAttemptInput): number | null {
  if (spec.formula === 'consistency') {
    const cv = blockCoefficientOfVariation(spec.key, input)
    return cv === null ? null : scoreConsistency(cv, spec.maxCoefficientOfVariation)
  }

  const value = resolveMetric(spec.metric, input)
  /**
   * Métrica ausente vira sub-score `null`, não 0.
   *
   * Zero afirma "o piloto fez isso mal"; ausência de dado afirma que ninguém
   * mediu. Colapsar as duas coisas puxaria o score agregado para baixo por falta
   * de dado e, pior, faria o coach recomendar treino para uma fraqueza
   * inexistente (RN-05 depende de o perfil refletir habilidade real).
   */
  if (value === null || !Number.isFinite(value)) return null

  switch (spec.formula) {
    case 'target_range':
      return scoreTargetRange(value, spec.range)
    case 'proportion':
      return scoreProportion(value, spec.required)
    case 'target_value':
      return scoreTargetValue(value, spec.target, spec.maxDeviation)
    case 'correlation':
      return scoreCorrelation(value, spec.minAbsolute)
  }
}

/** RF-401 e RF-402 — sub-scores e agregado de uma tentativa. */
export function scoreAttempt(input: ScoreAttemptInput): ScoreResult {
  const subScores: SubScore[] = input.exercise.scoringRules.subScores.map((definition) => ({
    id: definition.id,
    describes: definition.describes,
    value: applySpec(definition.spec, input),
  }))

  const usable = subScores
    .map((subScore) => subScore.value)
    .filter((value): value is number => value !== null)

  /**
   * RF-402 — média aritmética simples.
   *
   * Simples e não ponderada porque nenhum exercício do catálogo define pesos
   * (`evaluation-scoring-engine` §3). Sub-scores `null` ficam de fora da média
   * em vez de entrarem como zero, pelo mesmo motivo de `applySpec`.
   */
  const totalScore =
    usable.length > 0 ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null

  return {
    attemptRef: input.attemptRef,
    exerciseId: input.exercise.id,
    subScores,
    totalScore,
    level: totalScore === null ? null : classify(totalScore),
  }
}

/**
 * RF-403 — Bronze/Silver/Gold/Master.
 *
 * Faixas fechadas embaixo e abertas em cima, exatamente como
 * `evaluation-scoring-engine` §4 define: 75 é Gold, não Silver; 90 é Master.
 * TC-404 existe justamente para travar as bordas.
 *
 * ⚠️ Os cortes são assunção provisória — o PRD §16 deixa esses números em aberto.
 */
export function classify(totalScore: number): PerformanceLevel {
  if (totalScore >= 90) return 'master'
  if (totalScore >= 75) return 'gold'
  if (totalScore >= 60) return 'silver'
  return 'bronze'
}
