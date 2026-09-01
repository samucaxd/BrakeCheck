/**
 * Cenários do PRD §10.4 (Evaluation & Scoring Engine).
 */

import { describe, expect, it } from 'vitest'

import { classify, scoreAttempt } from '../../src/evaluation/score-attempt.js'
import {
  scoreConsistency,
  scoreCorrelation,
  scoreProportion,
  scoreTargetRange,
  scoreTargetValue,
} from '../../src/evaluation/scoring-functions.js'
import { formatScoreResult } from '../../src/evaluation/format.js'
import { findExercise } from '../../src/training/catalog.js'
import { computeExerciseMetrics } from '../../src/training/exercise-metrics.js'
import type { ExerciseMetrics } from '../../src/training/exercise-metrics.js'
import type { Exercise } from '../../src/training/types.js'
import { brakingTrace, metricsFor } from '../helpers/traces.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'

const progressiva = findExercise('fund-02-aplicacao-progressiva')!
const liberacao = findExercise('int-04-liberacao-progressiva')!

function scoreOf(exercise: Exercise, samples: readonly TelemetrySample[]) {
  const metrics = metricsFor(samples, exercise.pressureBand)
  const exerciseMetrics = computeExerciseMetrics({ samples, metrics })
  return scoreAttempt({
    attemptRef: 'a1',
    exercise,
    metrics,
    exerciseMetrics,
    samples,
    blockMetrics: [metrics],
  })
}

describe('toolkit de pontuação (skill §1)', () => {
  it('faixa-alvo: dentro da faixa vale 100', () => {
    expect(scoreTargetRange(250, [150, 350])).toBe(100)
    expect(scoreTargetRange(150, [150, 350])).toBe(100)
    expect(scoreTargetRange(350, [150, 350])).toBe(100)
  })

  it('faixa-alvo: fora da faixa, penalidade proporcional à distância', () => {
    // Tolerância = largura da faixa = 200.
    expect(scoreTargetRange(450, [150, 350])).toBeCloseTo(50, 5) // 100 além
    expect(scoreTargetRange(50, [150, 350])).toBeCloseTo(50, 5)
    expect(scoreTargetRange(550, [150, 350])).toBe(0) // 200 além = tolerância inteira
  })

  it('faixa-alvo: nunca sai de 0–100', () => {
    expect(scoreTargetRange(10_000, [150, 350])).toBe(0)
    expect(scoreTargetRange(-500, [150, 350])).toBe(0)
  })

  it('proporção satura em 100', () => {
    expect(scoreProportion(2000, 2500)).toBe(80)
    expect(scoreProportion(2500, 2500)).toBe(100)
    expect(scoreProportion(4000, 2500)).toBe(100)
    expect(scoreProportion(100, 0)).toBe(0)
  })

  it('desvio de alvo único decai linearmente', () => {
    expect(scoreTargetValue(0, 0, 400)).toBe(100)
    expect(scoreTargetValue(200, 0, 400)).toBe(50)
    expect(scoreTargetValue(400, 0, 400)).toBe(0)
    expect(scoreTargetValue(900, 0, 400)).toBe(0)
  })

  it('correlação usa magnitude e satura', () => {
    expect(scoreCorrelation(-0.6, 0.6)).toBe(100)
    expect(scoreCorrelation(-0.3, 0.6)).toBe(50)
    expect(scoreCorrelation(-0.95, 0.6)).toBe(100)
    expect(scoreCorrelation(0, 0.6)).toBe(0)
  })

  it('consistência penaliza variabilidade', () => {
    expect(scoreConsistency(0, 0.3)).toBe(100)
    expect(scoreConsistency(0.15, 0.3)).toBe(50)
    expect(scoreConsistency(0.3, 0.3)).toBe(0)
    expect(scoreConsistency(0.9, 0.3)).toBe(0)
  })
})

describe('classificação Bronze/Silver/Gold/Master (RF-403, TC-404)', () => {
  it('respeita exatamente os cortes, fechados embaixo e abertos em cima', () => {
    // O ponto do TC-404 é não haver ambiguidade nas bordas.
    expect(classify(59.9)).toBe('bronze')
    expect(classify(60)).toBe('silver')
    expect(classify(74.9)).toBe('silver')
    expect(classify(75)).toBe('gold')
    expect(classify(89.9)).toBe('gold')
    expect(classify(90)).toBe('master')
    expect(classify(100)).toBe('master')
    expect(classify(0)).toBe('bronze')
  })
})

describe('sub-scores por tentativa (RF-401)', () => {
  it('TC-401: aplicação abrupta penaliza o sub-score de aplicação inicial', () => {
    // ~80% em 50ms ≈ 1500 %/s, muito acima da faixa 150–350.
    const abrupta = scoreOf(progressiva, brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }))
    const boa = scoreOf(progressiva, brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }))

    const abruptaScore = abrupta.subScores[0]!.value!
    expect(boa.subScores[0]!.value).toBe(100)
    expect(abruptaScore).toBeLessThan(100)

    // A penalidade é proporcional, não um corte binário: uma aplicação menos
    // abrupta pontua melhor que uma mais abrupta.
    const menosAbrupta = scoreOf(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 150, holdMs: 200, fallMs: 400 }),
    )
    expect(menosAbrupta.subScores[0]!.value!).toBeGreaterThan(abruptaScore)
  })

  it('TC-402: liberação abrupta penaliza o sub-score de liberação', () => {
    const abrupta = scoreOf(liberacao, brakingTrace({ peak: 90, riseMs: 300, holdMs: 200, fallMs: 60 }))
    const progressivaRelease = scoreOf(
      liberacao,
      brakingTrace({ peak: 90, riseMs: 300, holdMs: 200, fallMs: 600 }),
    )

    expect(progressivaRelease.subScores[0]!.value).toBe(100)
    expect(abrupta.subScores[0]!.value!).toBeLessThan(100)
  })

  it('aplicação hesitante também penaliza — a faixa tem dois lados', () => {
    // Abaixo de 150 %/s: o exercício quer progressivo, não lento.
    const hesitante = scoreOf(
      progressiva,
      brakingTrace({ peak: 40, riseMs: 900, holdMs: 200, fallMs: 400 }),
    )
    expect(hesitante.subScores[0]!.value!).toBeLessThan(100)
  })

  it('métrica ausente vira sub-score null, não zero', () => {
    // Zero afirmaria "fez mal"; null diz que ninguém mediu. Confundir os dois
    // puxaria o agregado para baixo por falta de dado.
    const semFrenagem: TelemetrySample[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 10,
      brake: 0,
      throttle: 0,
      steering: 0,
    }))

    const result = scoreOf(progressiva, semFrenagem)

    expect(result.subScores[0]!.value).toBeNull()
    expect(result.totalScore).toBeNull()
    expect(result.level).toBeNull()
  })
})

describe('score agregado (RF-402, TC-403)', () => {
  const emptyExerciseMetrics: ExerciseMetrics = {
    reactionDeltaMs: null,
    steeringRangeDuringBraking: null,
    brakeSteeringOverlapMs: 0,
    stabilizationIntervalMs: null,
    brakeSteeringCorrelation: null,
    profileMeanDeviation: null,
    subBandCoverage: [],
  }

  /** Exercício sintético com sub-scores controlados, para conferir só a agregação. */
  function exerciseWithSubScores(targets: readonly number[]): Exercise {
    return {
      ...findExercise('fund-03-frenagem-linha-reta')!,
      scoringRules: {
        subScores: targets.map((target, index) => ({
          id: (['aplicacao_inicial', 'consistencia_direcional', 'liberacao'] as const)[index]!,
          describes: `alvo ${target}`,
          // target_value com o alvo deslocado produz exatamente o score desejado.
          spec: {
            formula: 'target_value' as const,
            metric: 'brakeThrottleOverlap' as const,
            target: 100 - target,
            maxDeviation: 100,
          },
        })),
      },
    }
  }

  it('TC-403: o agregado é a média simples dos sub-scores', () => {
    // Overlap = 0, então cada sub-score = 100 − |0 − (100−alvo)| = alvo.
    const exercise = exerciseWithSubScores([91, 78, 74])
    const metrics = metricsFor(brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }))

    const result = scoreAttempt({
      attemptRef: 'a1',
      exercise,
      metrics,
      exerciseMetrics: emptyExerciseMetrics,
    })

    expect(result.subScores.map((s) => s.value)).toEqual([91, 78, 74])
    expect(result.totalScore).toBeCloseTo((91 + 78 + 74) / 3, 6)
    expect(result.level).toBe('gold') // 81 → Gold
  })

  it('sub-scores null ficam de fora da média', () => {
    const exercise: Exercise = {
      ...findExercise('fund-03-frenagem-linha-reta')!,
      scoringRules: {
        subScores: [
          {
            id: 'aplicacao_inicial',
            describes: 'presente',
            spec: {
              formula: 'target_value',
              metric: 'brakeThrottleOverlap',
              target: 20,
              maxDeviation: 100,
            },
          },
          {
            id: 'consistencia_direcional',
            describes: 'ausente',
            spec: {
              formula: 'target_range',
              metric: 'steeringRangeDuringBraking',
              range: [0, 20],
            },
          },
        ],
      },
    }
    const metrics = metricsFor(brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }))

    const result = scoreAttempt({
      attemptRef: 'a1',
      exercise,
      metrics,
      exerciseMetrics: emptyExerciseMetrics,
    })

    expect(result.subScores[1]!.value).toBeNull()
    // Média só do que existe: 80, e não (80 + 0) / 2 = 40.
    expect(result.totalScore).toBeCloseTo(80, 6)
  })
})

describe('formato de exibição RN-01', () => {
  it('mostra total e decomposição, no formato do PRD §9', () => {
    const result = scoreOf(progressiva, brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }))
    const rendered = formatScoreResult(result, 'Threshold Braking')

    expect(rendered.split('\n')[0]).toBe('Threshold Braking — 100/100')
    expect(rendered).toContain('Aplicação inicial:')
    expect(rendered).toContain('/100')
  })

  it('sub-score sem dado aparece como travessão, não como zero', () => {
    const semFrenagem: TelemetrySample[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 10,
      brake: 0,
      throttle: 0,
      steering: 0,
    }))
    const rendered = formatScoreResult(scoreOf(progressiva, semFrenagem), 'Aplicação Progressiva')

    expect(rendered).toContain('—')
    expect(rendered).not.toContain('0/100')
  })
})
