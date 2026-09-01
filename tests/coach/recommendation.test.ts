/**
 * Recomendação adaptativa — RF-503, RF-504, RF-505, RN-05, e TC-503/TC-504.
 */

import { describe, expect, it } from 'vitest'

import {
  formatRecommendation,
  primaryDeficiency,
  recommendNext,
} from '../../src/coach/recommendation.js'
import { emptyProfile, updateProfile } from '../../src/evaluation/skill-profile.js'
import type { ScoreResult, SkillProfile } from '../../src/evaluation/types.js'
import { exercisesForLevel, findExercise } from '../../src/training/catalog.js'
import type { AttemptRecord } from '../../src/training/progression.js'
import type { ExerciseMetrics } from '../../src/training/exercise-metrics.js'
import type { Exercise, Level } from '../../src/training/types.js'
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

function attemptFor(exercise: Exercise, criterionMet: boolean, score = 95): AttemptRecord {
  const band = exercise.pressureBand
  const peak = band ? (band[0] + band[1]) / 2 : 80
  const samples = brakingTrace({ peak, riseMs: 200, holdMs: 2500, fallMs: 400 })
  return {
    exerciseId: exercise.id,
    metrics: metricsFor(samples, band),
    exerciseMetrics: { ...EMPTY_EXERCISE_METRICS, reactionDeltaMs: 250 },
    criterionMet,
    score,
  }
}

function masteredHistory(exerciseId: string): AttemptRecord[] {
  const exercise = findExercise(exerciseId)!
  return Array.from({ length: 5 }, () => attemptFor(exercise, true))
}

function masteredLevel(level: Level): AttemptRecord[] {
  return exercisesForLevel(level).flatMap((exercise) => masteredHistory(exercise.id))
}

function scoreResult(exerciseId: string, value: number, subScoreId = 'liberacao'): ScoreResult {
  return {
    attemptRef: `${exerciseId}-a1`,
    exerciseId,
    subScores: [{ id: subScoreId as never, value, describes: '', observed: value }],
    totalScore: value,
    level: 'silver',
  }
}

/** Perfil com todas as dimensões medidas, para isolar a escolha pela mais fraca. */
function profileWith(values: Partial<Record<string, number>>): SkillProfile {
  const results: ScoreResult[] = [
    scoreResult('fund-01-controle-pedal', values.brakeControl ?? 80, 'controle_pressao'),
    scoreResult('int-01-threshold-braking', values.thresholdBraking ?? 80, 'aplicacao_inicial'),
    scoreResult('int-04-liberacao-progressiva', values.brakeRelease ?? 80),
    scoreResult('adv-01-trail-braking', values.trailBraking ?? 80),
    scoreResult('adv-05-combinacao-completa', values.throttleControl ?? 80),
    scoreResult('fund-05-consistencia', values.consistency ?? 80, 'consistencia'),
    scoreResult('fund-03-frenagem-linha-reta', values.steeringControl ?? 80, 'consistencia_direcional'),
  ]
  return updateProfile(emptyProfile(), results, 1000)
}

describe('primaryDeficiency (RF-503)', () => {
  it('aponta a dimensão de menor valor quando todas têm dado', () => {
    const profile = profileWith({ trailBraking: 45 })
    const history = [...masteredLevel('fundamentos'), ...masteredLevel('intermediario')]

    expect(primaryDeficiency(profile, history)).toBe('trailBraking')
  })

  it('prioriza dimensão SEM dado que já tenha exercício desbloqueado', () => {
    // Regra da skill §2: não dá para saber que ela é fraca, mas também não dá
    // para saber que está bem — gerar a primeira medição é mais urgente que
    // otimizar algo já medido.
    let profile = emptyProfile()
    profile = updateProfile(profile, [scoreResult('fund-01-controle-pedal', 30, 'controle_pressao')], 1000)

    // brakeControl = 30 (baixíssimo), mas Consistency nunca foi medida e o
    // exercício 5 é alcançável depois de dominar 1-4.
    const history = [
      ...masteredHistory('fund-01-controle-pedal'),
      ...masteredHistory('fund-02-aplicacao-progressiva'),
      ...masteredHistory('fund-03-frenagem-linha-reta'),
      ...masteredHistory('fund-04-controle-pressao'),
    ]

    expect(primaryDeficiency(profile, history)).toBe('consistency')
  })

  it('ignora dimensão sem dado cujos exercícios ainda estão bloqueados', () => {
    // Trail Braking não tem dado, mas nada que a alimente está liberado para
    // quem está em Fundamentos — priorizá-la seria apontar para o inalcançável.
    let profile = emptyProfile()
    profile = updateProfile(profile, [scoreResult('fund-01-controle-pedal', 40, 'controle_pressao')], 1000)

    expect(primaryDeficiency(profile, [])).not.toBe('trailBraking')
  })

  it('perfil totalmente vazio sem histórico aponta para o que é alcançável', () => {
    const deficiency = primaryDeficiency(emptyProfile(), [])
    // Só o exercício 1 está liberado, e ele alimenta Brake Control.
    expect(deficiency).toBe('brakeControl')
  })
})

describe('recommendNext (RF-504, RN-05)', () => {
  const fullHistory = [...masteredLevel('fundamentos'), ...masteredLevel('intermediario')]

  it('TC-503: a dimensão claramente mais fraca guia a recomendação', () => {
    const profile = profileWith({ trailBraking: 45 })

    const recommendation = recommendNext({
      profile,
      history: fullHistory,
      recentScores: [
        scoreResult('adv-01-trail-braking', 61),
        scoreResult('adv-03-transferencia-peso', 80),
        scoreResult('adv-04-frenagem-rotacao', 75),
      ],
    })!

    expect(recommendation.dimension).toBe('trailBraking')
    expect(recommendation.fallback).toBe(false)
    // Entre os exercícios que alimentam Trail Braking, o de menor score recente.
    expect(recommendation.exerciseId).toBe('adv-01-trail-braking')
    expect(recommendation.reason).toContain('Trail Braking')
  })

  it('NÃO recomenda simplesmente o próximo da lista', () => {
    // A ordem do catálogo serve para desbloqueio, não para recomendação. Com a
    // trilha inteira dominada, os quatro exercícios de Trail Braking estão
    // acessíveis — e quem decide é o score recente, não a posição no catálogo.
    const everything = [
      ...masteredLevel('fundamentos'),
      ...masteredLevel('intermediario'),
      ...masteredLevel('avancado'),
    ]
    const profile = profileWith({ trailBraking: 45 })

    const recommendation = recommendNext({
      profile,
      history: everything,
      recentScores: [
        scoreResult('adv-01-trail-braking', 90),
        scoreResult('adv-03-transferencia-peso', 88),
        scoreResult('adv-04-frenagem-rotacao', 52), // o que puxa a dimensão pra baixo
        scoreResult('adv-05-combinacao-completa', 85),
      ],
    })!

    expect(recommendation.exerciseId).toBe('adv-04-frenagem-rotacao')
    expect(recommendation.reason).toContain('já dominado')
  })

  it('exercício nunca tentado tem prioridade sobre um já medido', () => {
    const everything = [
      ...masteredLevel('fundamentos'),
      ...masteredLevel('intermediario'),
      ...masteredLevel('avancado'),
    ]
    const profile = profileWith({ trailBraking: 45 })

    const recommendation = recommendNext({
      profile,
      history: everything,
      // adv-01 medido e ruim; os outros três da dimensão, sem medição recente.
      recentScores: [scoreResult('adv-01-trail-braking', 40)],
    })!

    // Gerar a primeira medição vale mais que refinar uma já existente.
    expect(recommendation.exerciseId).not.toBe('adv-01-trail-braking')
  })

  it('nunca recomenda exercício bloqueado (RF-505 por construção)', () => {
    // Trail Braking é a mais fraca, mas o piloto está em Fundamentos.
    const profile = profileWith({ trailBraking: 20 })

    const recommendation = recommendNext({ profile, history: [], recentScores: [] })!

    expect(findExercise(recommendation.exerciseId)!.level).toBe('fundamentos')
  })

  it('cai para a ordem da trilha quando a deficiência é inalcançável', () => {
    // Caminho de fallback da skill §4 — a forma honesta de dizer "ainda não dá
    // para atacar isso diretamente, mas seguir a trilha aproxima disso".
    const profile = profileWith({ trailBraking: 20 })
    const history = masteredHistory('fund-01-controle-pedal')

    const recommendation = recommendNext({ profile, history, recentScores: [] })!

    expect(recommendation.fallback).toBe(true)
    expect(recommendation.exerciseId).toBe('fund-02-aplicacao-progressiva')
    expect(recommendation.reason).toContain('nenhum exercício')
  })

  it('TC-504: baixa consistência mantém o piloto no exercício, sem liberar o próximo', () => {
    // O exercício avançado foi "completado" (critério cumprido em todas as
    // tentativas) mas com alta variabilidade, então a advance_condition não
    // fecha — e o filtro "não dominado" mantém a recomendação nele mesmo.
    const trailBraking = findExercise('adv-01-trail-braking')!
    const inconsistent = [120, 500, 180, 700, 150].map((fallMs) => ({
      exerciseId: trailBraking.id,
      metrics: metricsFor(brakingTrace({ peak: 85, riseMs: 250, holdMs: 300, fallMs })),
      exerciseMetrics: EMPTY_EXERCISE_METRICS,
      criterionMet: true,
      score: 92,
    }))

    const history = [...fullHistory, ...inconsistent]
    const profile = profileWith({ trailBraking: 58 })

    const recommendation = recommendNext({
      profile,
      history,
      recentScores: [scoreResult('adv-01-trail-braking', 92)],
    })!

    // Continua dentro de Trail Braking; nada mais avançado foi liberado.
    expect(recommendation.dimension).toBe('trailBraking')
    expect(findExercise(recommendation.exerciseId)!.level).toBe('avancado')
  })

  it('sem nada dominado, começa pelo primeiro exercício da trilha', () => {
    const recommendation = recommendNext({
      profile: emptyProfile(),
      history: [],
      recentScores: [],
    })!

    expect(recommendation.exerciseId).toBe('fund-01-controle-pedal')
  })

  it('com a trilha inteira dominada, segue recomendando dentro do Avançado', () => {
    // Não existe nível seguinte na V1: `braking-training-engine` §3 delega à
    // coach-engine decidir o que vem depois, dentro do próprio Avançado.
    const everything = [
      ...masteredLevel('fundamentos'),
      ...masteredLevel('intermediario'),
      ...masteredLevel('avancado'),
    ]
    const profile = profileWith({ brakeRelease: 40 })

    const recommendation = recommendNext({ profile, history: everything, recentScores: [] })!

    expect(recommendation).not.toBeNull()
    expect(recommendation.dimension).toBe('brakeRelease')
    expect(recommendation.reason).toContain('já dominado')
  })
})

describe('formato de exibição RN-05', () => {
  it('mostra a deficiência e o exercício recomendado', () => {
    const profile = profileWith({ trailBraking: 58 })
    const recommendation = recommendNext({
      profile,
      history: [...masteredLevel('fundamentos'), ...masteredLevel('intermediario')],
      recentScores: [scoreResult('adv-01-trail-braking', 61)],
    })!

    const rendered = formatRecommendation(recommendation)

    expect(rendered).toContain('Principal deficiência identificada')
    expect(rendered).toContain('Trail Braking')
    expect(rendered).toContain('Próximo exercício recomendado')
  })
})
