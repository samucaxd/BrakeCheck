/**
 * Avaliação dos critérios de sucesso de uma tentativa.
 *
 * Devolve **booleano + o observado**, nunca um score: pontuação é da
 * `evaluation-scoring-engine`. O "observado" existe para que a `coach-engine`
 * tenha de onde tirar feedback ancorado em dado real (RN-04) sem recalcular
 * nada, e para que o bloqueio de TC-305 consiga explicar o motivo.
 */

import type { TelemetrySample } from '../shared/contracts.js'
import { computeConsistency } from '../telemetry/consistency.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import { inBand } from './exercise-metrics.js'
import type { ExerciseMetrics } from './exercise-metrics.js'
import type { Band, SuccessCriterion } from './types.js'

export interface CriterionEvaluation {
  met: boolean
  /** Rótulo curto do que foi medido, para a UI e para a `coach-engine`. */
  measure: string
  /** Valor observado. `null` quando a tentativa não produziu o dado. */
  observed: number | null
  /** Alvo, em texto curto — o que seria preciso para cumprir. */
  target: string
}

export interface AttemptEvaluationInput {
  metrics: DerivedMetrics
  exerciseMetrics: ExerciseMetrics
  samples: readonly TelemetrySample[]
  /**
   * Métricas das outras tentativas do bloco, para os critérios que só existem
   * entre tentativas (exercício 5).
   */
  blockMetrics?: readonly DerivedMetrics[]
}

function fmtBand(band: Band): string {
  return `${band[0]}–${band[1]}`
}

/**
 * Um dado ausente nunca conta como sucesso.
 *
 * Vale para todos os critérios: se o piloto não freou, não há evento, e o
 * critério não foi cumprido — mas o `observed: null` deixa explícito que a causa
 * foi ausência de dado, não um valor ruim. Essa distinção é o que permite à
 * `coach-engine` dizer "você não freou" em vez de "sua frenagem foi lenta".
 */
function absent(measure: string, target: string): CriterionEvaluation {
  return { met: false, measure, observed: null, target }
}

export function evaluateCriterion(
  criterion: SuccessCriterion,
  input: AttemptEvaluationInput,
): CriterionEvaluation {
  const { metrics, exerciseMetrics, samples } = input

  switch (criterion.kind) {
    case 'pressure_hold': {
      const held = metrics.timeInPressureRange?.durationMs ?? null
      if (held === null) return absent('tempo na faixa', `faixa ${fmtBand(criterion.band)}`)
      const coverage = criterion.windowMs > 0 ? held / criterion.windowMs : 0
      return {
        met: coverage >= criterion.minCoverage,
        measure: 'cobertura da janela na faixa',
        observed: coverage,
        target: `≥ ${(criterion.minCoverage * 100).toFixed(0)}% de ${criterion.windowMs}ms em ${fmtBand(criterion.band)}%`,
      }
    }

    case 'application_speed_range': {
      const speed = metrics.brakingAggregate.applicationSpeedPctPerS
      if (speed === null) return absent('velocidade de aplicação', `${fmtBand(criterion.range)} %/s`)
      return {
        met: inBand(speed, criterion.range),
        measure: 'velocidade de aplicação',
        observed: speed,
        target: `${fmtBand(criterion.range)} %/s`,
      }
    }

    case 'steering_stability': {
      const range = exerciseMetrics.steeringRangeDuringBraking
      if (range === null) return absent('variação de volante na frenagem', `≤ ${criterion.maxRange}`)
      return {
        met: range <= criterion.maxRange,
        measure: 'variação de volante na frenagem',
        observed: range,
        target: `≤ ${criterion.maxRange} pontos`,
      }
    }

    case 'inter_attempt_consistency': {
      // Único critério que não é sobre a tentativa isolada: o exercício 5 tem a
      // repetição como objetivo, então só o bloco inteiro pode respondê-lo.
      const block = input.blockMetrics
      if (!block || block.length < 2) {
        return absent(
          'consistência entre tentativas',
          `CV ≤ ${criterion.maxCoefficientOfVariation} em ${criterion.metrics.join(', ')}`,
        )
      }
      const report = computeConsistency(block, criterion.metrics)
      let worst = 0
      for (const key of criterion.metrics) {
        const cv = report.byMetric[key]?.coefficientOfVariation
        if (cv === undefined || cv === null) {
          return absent('consistência entre tentativas', `CV ≤ ${criterion.maxCoefficientOfVariation}`)
        }
        worst = Math.max(worst, cv)
      }
      return {
        met: worst <= criterion.maxCoefficientOfVariation,
        measure: 'maior CV entre as métricas-chave',
        observed: worst,
        target: `≤ ${criterion.maxCoefficientOfVariation}`,
      }
    }

    case 'reaction_delta': {
      const delta = exerciseMetrics.reactionDeltaMs
      if (delta === null) return absent('atraso de reação', `≤ ${criterion.maxDeltaMs}ms`)
      return {
        met: delta >= 0 && delta <= criterion.maxDeltaMs,
        measure: 'atraso de reação',
        observed: delta,
        target: `≤ ${criterion.maxDeltaMs}ms`,
      }
    }

    case 'peak_sustained': {
      const event = metrics.brakingEvents[0]
      if (!event) return absent('pico sustentado', `${fmtBand(criterion.band)}%`)
      const eventMs = event.endMs - event.startMs
      const sustainedMs = sustainedWithinBand(samples, event.startMs, event.endMs, criterion.band)
      const coverage = eventMs > 0 ? sustainedMs / eventMs : 0
      const peakInBand = inBand(event.peakValue, criterion.band)
      return {
        met: peakInBand && coverage >= criterion.minEventCoverage,
        measure: 'fração do evento na faixa de threshold',
        observed: coverage,
        target: `pico em ${fmtBand(criterion.band)}% sustentado ≥ ${(criterion.minEventCoverage * 100).toFixed(0)}% do evento`,
      }
    }

    case 'peak_and_application': {
      const peak = metrics.brakingAggregate.peakValue
      const speed = metrics.brakingAggregate.applicationSpeedPctPerS
      if (peak === null || speed === null) {
        return absent('pico e aplicação', `pico ≥ ${criterion.minPeak}%, aplicação ≥ ${criterion.minApplicationSpeed} %/s`)
      }
      return {
        met: peak >= criterion.minPeak && speed >= criterion.minApplicationSpeed,
        measure: 'velocidade de aplicação (com pico atingido)',
        observed: speed,
        target: `pico ≥ ${criterion.minPeak}% e aplicação ≥ ${criterion.minApplicationSpeed} %/s`,
      }
    }

    case 'band_sequence': {
      const coverage = exerciseMetrics.subBandCoverage
      if (coverage.length !== criterion.segments.length) {
        return absent('cobertura por sub-faixa', `≥ ${(criterion.minCoveragePerSegment * 100).toFixed(0)}% em cada`)
      }
      // O pior segmento define o resultado: acertar duas faixas e errar a
      // terceira não é seguir a sequência.
      const worst = Math.min(...coverage)
      return {
        met: worst >= criterion.minCoveragePerSegment,
        measure: 'pior cobertura entre as sub-faixas',
        observed: worst,
        target: `≥ ${(criterion.minCoveragePerSegment * 100).toFixed(0)}% em cada sub-faixa`,
      }
    }

    case 'release_speed_range': {
      const event = metrics.brakingEvents[0]
      const speed = metrics.brakingAggregate.releaseSpeedPctPerS
      if (speed === null) return absent('velocidade de liberação', `${fmtBand(criterion.range)} %/s`)
      // Um evento truncado descreve onde a captura parou, não a liberação do
      // piloto — não pode contar como liberação bem executada.
      if (event?.truncated) {
        return {
          met: false,
          measure: 'velocidade de liberação (evento truncado)',
          observed: speed,
          target: `${fmtBand(criterion.range)} %/s com a liberação completa`,
        }
      }
      return {
        met: inBand(speed, criterion.range),
        measure: 'velocidade de liberação',
        observed: speed,
        target: `${fmtBand(criterion.range)} %/s`,
      }
    }

    case 'profile_tracking': {
      const deviation = exerciseMetrics.profileMeanDeviation
      if (deviation === null) return absent('desvio do perfil-alvo', `≤ ${criterion.maxMeanDeviation} p.p.`)
      return {
        met: deviation <= criterion.maxMeanDeviation,
        measure: 'desvio médio do perfil-alvo',
        observed: deviation,
        target: `≤ ${criterion.maxMeanDeviation} pontos percentuais`,
      }
    }

    case 'trail_overlap': {
      const overlap = exerciseMetrics.brakeSteeringOverlapMs
      const release = metrics.brakingAggregate.releaseSpeedPctPerS
      if (release === null) return absent('overlap freio×volante', `≥ ${criterion.minOverlapMs}ms`)
      return {
        met: overlap >= criterion.minOverlapMs && inBand(release, criterion.releaseRange),
        measure: 'overlap freio×volante',
        observed: overlap,
        target: `≥ ${criterion.minOverlapMs}ms com liberação em ${fmtBand(criterion.releaseRange)} %/s`,
      }
    }

    case 'stabilization_interval': {
      const interval = exerciseMetrics.stabilizationIntervalMs
      if (interval === null) return absent('intervalo de estabilização', `≥ ${criterion.minIntervalMs}ms`)
      return {
        met: interval >= criterion.minIntervalMs,
        measure: 'intervalo entre pico de freio e esterçamento acentuado',
        observed: interval,
        target: `≥ ${criterion.minIntervalMs}ms`,
      }
    }

    case 'brake_steering_correlation': {
      const r = exerciseMetrics.brakeSteeringCorrelation
      if (r === null) return absent('correlação freio × ângulo', `≤ ${criterion.maxCorrelation}`)
      // O alvo é correlação NEGATIVA forte: freio caindo enquanto o ângulo
      // cresce. Por isso a comparação é "≤", não "≥ |r|".
      return {
        met: r <= criterion.maxCorrelation,
        measure: 'correlação freio × ângulo de volante',
        observed: r,
        target: `≤ ${criterion.maxCorrelation} (negativa e forte)`,
      }
    }

    case 'clean_handoff': {
      const overlapBrakeThrottle = metrics.overlap.durationMs
      const trailOverlap = exerciseMetrics.brakeSteeringOverlapMs
      const r = exerciseMetrics.brakeSteeringCorrelation
      const met =
        overlapBrakeThrottle <= criterion.maxBrakeThrottleOverlapMs &&
        trailOverlap >= criterion.minTrailOverlapMs &&
        r !== null &&
        r <= criterion.maxCorrelation
      return {
        met,
        measure: 'overlap freio×acelerador na retomada',
        observed: overlapBrakeThrottle,
        target: `≤ ${criterion.maxBrakeThrottleOverlapMs}ms, mantendo trail braking ≥ ${criterion.minTrailOverlapMs}ms`,
      }
    }
  }
}

/**
 * Tempo dentro de uma faixa, restrito à janela do evento de frenagem.
 *
 * Não dá para reusar `metrics.timeInPressureRange` aqui: aquele mede a tentativa
 * inteira, e o critério do exercício 7 é sobre a fração **do evento**.
 */
function sustainedWithinBand(
  samples: readonly TelemetrySample[],
  startMs: number,
  endMs: number,
  band: Band,
): number {
  const first = samples[0]
  if (!first) return 0

  let total = 0
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!
    const current = samples[i]!
    const t = previous.timestamp - first.timestamp
    if (t < startMs || t >= endMs) continue
    if (!inBand(previous.brake, band)) continue
    total += current.timestamp - previous.timestamp
  }
  return total
}
