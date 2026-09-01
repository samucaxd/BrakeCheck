/**
 * TC-302 a TC-305 do PRD §10.3 — a regra que o `CLAUDE.md` cita nominalmente
 * entre "o que NÃO fazer": avançar o piloto só porque ele completou um
 * exercício uma vez.
 */

import { describe, expect, it } from 'vitest'

import { exercisesForLevel, findExercise } from '../../src/training/catalog.js'
import {
  evaluateAccess,
  evaluateMastery,
  isLevelComplete,
  unlockedExercises,
  type AttemptRecord,
} from '../../src/training/progression.js'
import type { ExerciseMetrics } from '../../src/training/exercise-metrics.js'
import type { Exercise } from '../../src/training/types.js'
import { brakingTrace, metricsFor } from '../helpers/traces.js'

const EMPTY_EXERCISE_METRICS: ExerciseMetrics = {
  reactionDeltaMs: null,
  steeringRangeDuringBraking: null,
  brakeSteeringOverlapMs: 0,
  stabilizationIntervalMs: null,
  brakeSteeringCorrelation: null,
  profileMeanDeviation: null,
  subBandCoverage: [],
}

/**
 * Tentativa com uma frenagem real por trás, para o CV ser calculável.
 *
 * As métricas são geradas conforme o que o exercício exige: se ele mede tempo em
 * faixa, o traço é construído dentro da faixa dele; se a condição de avanço pede
 * consistência do atraso de reação, esse valor é preenchido. Sem isso a métrica
 * sai `null` e o exercício nunca seria dominável — que é, aliás, o comportamento
 * correto do código: dado ausente não aprova.
 */
function attemptFor(
  exercise: Exercise,
  options: {
    riseMs: number
    criterionMet: boolean
    score?: number
    reactionDeltaMs?: number
  },
): AttemptRecord {
  const band = exercise.pressureBand
  const peak = band ? (band[0] + band[1]) / 2 : 80
  const samples = brakingTrace({
    peak,
    riseMs: options.riseMs,
    holdMs: 2500,
    fallMs: 400,
  })

  return {
    exerciseId: exercise.id,
    metrics: metricsFor(samples, band),
    exerciseMetrics: {
      ...EMPTY_EXERCISE_METRICS,
      reactionDeltaMs: options.reactionDeltaMs ?? 250,
    },
    criterionMet: options.criterionMet,
    ...(options.score !== undefined ? { score: options.score } : {}),
  }
}

/** Histórico que domina um exercício: 5 tentativas idênticas e bem-sucedidas. */
function masteredHistory(exerciseId: string, score = 95): AttemptRecord[] {
  const exercise = findExercise(exerciseId)!
  return Array.from({ length: 5 }, () =>
    attemptFor(exercise, { riseMs: 200, criterionMet: true, score }),
  )
}

/** Domina o nível inteiro, que é o que o gate entre níveis exige. */
function masteredLevel(level: 'fundamentos' | 'intermediario'): AttemptRecord[] {
  return exercisesForLevel(level).flatMap((exercise) => masteredHistory(exercise.id))
}

describe('evaluateMastery (RN-03)', () => {
  const progressiva = findExercise('fund-02-aplicacao-progressiva')!

  it('TC-302: score abaixo do mínimo não libera avanço', () => {
    // Critério de sucesso cumprido em todas as tentativas, mas o score
    // sustentado exigido pelo exercício é 70.
    const history = Array.from({ length: 5 }, () =>
      attemptFor(progressiva, { riseMs: 200, criterionMet: true, score: 50 }),
    )

    const result = evaluateMastery(progressiva, history)

    expect(result.mastered).toBe(false)
    expect(result.missing.some((m) => m.requirement.includes('score'))).toBe(true)
  })

  it('TC-303: score alto com alta variabilidade não libera avanço', () => {
    // Este é o coração da RN-03: acertar com score alto, mas de formas muito
    // diferentes a cada tentativa, não é domínio.
    const history = [
      attemptFor(progressiva, { riseMs: 80, criterionMet: true, score: 95 }),
      attemptFor(progressiva, { riseMs: 600, criterionMet: true, score: 92 }),
      attemptFor(progressiva, { riseMs: 120, criterionMet: true, score: 98 }),
      attemptFor(progressiva, { riseMs: 900, criterionMet: true, score: 90 }),
      attemptFor(progressiva, { riseMs: 150, criterionMet: true, score: 94 }),
    ]

    const result = evaluateMastery(progressiva, history)

    expect(result.mastered).toBe(false)
    expect(result.missing.some((m) => m.requirement.includes('consistência'))).toBe(true)
  })

  it('TC-304: domínio sustentado com consistência libera', () => {
    const result = evaluateMastery(progressiva, masteredHistory(progressiva.id))

    expect(result.mastered).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('uma única tentativa perfeita não domina o exercício', () => {
    // "Não avançar nível apenas por completar um exercício uma vez" (CLAUDE.md).
    const history = [attemptFor(progressiva, { riseMs: 200, criterionMet: true, score: 100 })]

    const result = evaluateMastery(progressiva, history)

    expect(result.mastered).toBe(false)
    expect(result.missing.some((m) => m.requirement === 'tentativas')).toBe(true)
  })

  it('score ausente não passa por omissão', () => {
    // Se a evaluation-scoring-engine ainda não pontuou, o gate não pode abrir
    // por falta de dado — seria a forma mais silenciosa de furar a RN-03.
    const history = Array.from({ length: 5 }, () =>
      attemptFor(progressiva, { riseMs: 200, criterionMet: true }),
    )

    expect(evaluateMastery(progressiva, history).mastered).toBe(false)
  })

  it('considera apenas as tentativas recentes, não o histórico inteiro', () => {
    // Um piloto que dominou há meses e vem errando desde então não deve seguir
    // "dominando" para sempre.
    const exercise = findExercise('fund-03-frenagem-linha-reta')!
    const history = [
      ...Array.from({ length: 5 }, () =>
        attemptFor(exercise, { riseMs: 200, criterionMet: true }),
      ),
      ...Array.from({ length: 5 }, () =>
        attemptFor(exercise, { riseMs: 200, criterionMet: false }),
      ),
    ]

    expect(evaluateMastery(exercise, history).mastered).toBe(false)
  })

  it('exige tentativas consecutivas quando o exercício pede', () => {
    // Exercício 1 pede 3 consecutivas: acertar alternadamente não vale.
    const exercise = findExercise('fund-01-controle-pedal')!
    const alternating = [true, false, true, false, true].map((met) =>
      attemptFor(exercise, { riseMs: 200, criterionMet: met }),
    )

    const result = evaluateMastery(exercise, alternating)

    expect(result.mastered).toBe(false)
    expect(result.missing.some((m) => m.requirement.includes('consecutivas'))).toBe(true)
  })

  it('ignora tentativas de outros exercícios', () => {
    const history = masteredHistory('fund-01-controle-pedal')
    expect(evaluateMastery(progressiva, history).mastered).toBe(false)
  })
})

describe('evaluateAccess (RF-307, TC-305)', () => {
  it('TC-305: exercício avançado sem pré-requisitos fica bloqueado, com motivo', () => {
    const trailBraking = findExercise('adv-01-trail-braking')!

    const access = evaluateAccess(trailBraking, [])

    expect(access.locked).toBe(true)
    expect(access.reasons.length).toBeGreaterThan(0)
    // A UI precisa explicar, não só negar — cada motivo aponta um exercício.
    expect(access.reasons.every((r) => r.requirement.length > 0)).toBe(true)
    expect(access.reasons.some((r) => r.requirement.includes('fundamentos'))).toBe(true)
  })

  it('o primeiro exercício de Fundamentos começa liberado', () => {
    expect(evaluateAccess(findExercise('fund-01-controle-pedal')!, []).locked).toBe(false)
  })

  it('dentro do nível, os exercícios abrem em sequência', () => {
    const history = masteredHistory('fund-01-controle-pedal')

    expect(evaluateAccess(findExercise('fund-02-aplicacao-progressiva')!, history).locked).toBe(false)
    expect(evaluateAccess(findExercise('fund-03-frenagem-linha-reta')!, history).locked).toBe(true)
  })

  it('o gate de nível exige TODOS os exercícios do nível anterior, não só o último', () => {
    // Leitura estrita da RN-03 determinada pela skill §5: dominar o último
    // exercício de Fundamentos não basta para entrar no Intermediário.
    const onlyLast = masteredHistory('fund-06-ponto-frenagem')
    const threshold = findExercise('int-01-threshold-braking')!

    expect(evaluateAccess(threshold, onlyLast).locked).toBe(true)

    expect(evaluateAccess(threshold, masteredLevel('fundamentos')).locked).toBe(false)
  })

  it('Avançado exige Fundamentos e Intermediário completos', () => {
    const trailBraking = findExercise('adv-01-trail-braking')!
    const onlyFundamentos = masteredLevel('fundamentos')

    expect(evaluateAccess(trailBraking, onlyFundamentos).locked).toBe(true)

    const both = [...onlyFundamentos, ...masteredLevel('intermediario')]
    expect(evaluateAccess(trailBraking, both).locked).toBe(false)
  })

  it('unlockedExercises devolve só a frente da trilha', () => {
    expect(unlockedExercises([]).map((e) => e.id)).toEqual(['fund-01-controle-pedal'])
  })

  it('isLevelComplete reflete o nível inteiro', () => {
    expect(isLevelComplete('fundamentos', [])).toBe(false)
    expect(isLevelComplete('fundamentos', masteredLevel('fundamentos'))).toBe(true)
  })
})
