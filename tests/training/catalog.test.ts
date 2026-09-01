/**
 * Integridade do catálogo (RF-301 a RF-305).
 *
 * O RF-305 exige que **todo** exercício tenha os 11 campos preenchidos, e os
 * RF-302/303/304 exigem cobertura mínima de técnicas por nível. Um catálogo
 * escrito à mão degrada exatamente por aí — um campo vazio, um id repetido, uma
 * técnica que ficou de fora —, então isso é verificado, não confiado.
 */

import { describe, expect, it } from 'vitest'

import { CATALOG, exercisesForLevel, findExercise } from '../../src/training/catalog.js'
import { describeCriterion } from '../../src/training/exercise-session.js'
import { LEVEL_ORDER } from '../../src/training/types.js'

describe('catálogo (RF-301 a RF-305)', () => {
  it('RF-301: três níveis progressivos, todos povoados', () => {
    for (const level of LEVEL_ORDER) {
      expect(exercisesForLevel(level).length, level).toBeGreaterThan(0)
    }
  })

  it('critério de aceitação da V1: ao menos um exercício completo por nível', () => {
    for (const level of LEVEL_ORDER) {
      expect(exercisesForLevel(level).length, level).toBeGreaterThanOrEqual(1)
    }
  })

  it('RF-305: todos os 11 campos preenchidos em todo exercício', () => {
    for (const exercise of CATALOG) {
      expect(exercise.name, exercise.id).toBeTruthy()
      expect(exercise.technique, exercise.id).toBeTruthy()
      expect(exercise.objective, exercise.id).toBeTruthy()
      expect(exercise.explanation, exercise.id).toBeTruthy()
      expect(exercise.instructions, exercise.id).toBeTruthy()
      expect(exercise.difficulty, exercise.id).toBeGreaterThan(0)
      expect(exercise.metricsUsed.length, exercise.id).toBeGreaterThan(0)
      expect(exercise.successCriteria, exercise.id).toBeDefined()
      expect(exercise.scoringRules.subScores.length, exercise.id).toBeGreaterThan(0)
      expect(exercise.feedbackFocus.length, exercise.id).toBeGreaterThan(0)
      expect(exercise.advanceCondition, exercise.id).toBeDefined()
    }
  })

  it('ids são únicos', () => {
    const ids = CATALOG.map((exercise) => exercise.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a dificuldade é sequencial dentro de cada nível', () => {
    // A ordem de desbloqueio intra-nível depende disso: um salto ou empate
    // deixaria um exercício inalcançável ou dois abrindo juntos.
    for (const level of LEVEL_ORDER) {
      const difficulties = exercisesForLevel(level).map((e) => e.difficulty)
      expect(difficulties, level).toEqual(
        Array.from({ length: difficulties.length }, (_, i) => i + 1),
      )
    }
  })

  it('RN-03: nenhuma condição de avanço se contenta com uma tentativa', () => {
    // A trava estrutural contra "completou uma vez, avançou".
    for (const exercise of CATALOG) {
      expect(exercise.advanceCondition.attemptsRequired, exercise.id).toBeGreaterThan(1)
      expect(exercise.advanceCondition.outOf, exercise.id).toBeGreaterThanOrEqual(
        exercise.advanceCondition.attemptsRequired,
      )
    }
  })

  it('RN-03: toda condição de avanço exige consistência, sem exceção', () => {
    // A RN-03 pede as DUAS coisas: "(a) score mínimo sustentado ao longo de
    // múltiplas tentativas, E (b) consistência (baixa variabilidade)". Um
    // exercício que exige só repetição de acertos deixa passar o piloto que
    // acerta de um jeito diferente a cada vez — que é literalmente o caso que a
    // regra existe para barrar.
    for (const exercise of CATALOG) {
      expect(
        exercise.advanceCondition.consistency.length,
        `${exercise.id} não exige consistência`,
      ).toBeGreaterThan(0)
    }
  })

  it('RF-302: Fundamentos cobre as técnicas exigidas', () => {
    const techniques = exercisesForLevel('fundamentos').map((e) => e.technique).join(' ')
    for (const expected of [
      'controle do pedal',
      'aplicação progressiva',
      'linha reta',
      'controle da pressão',
      'consistência',
      'ponto de frenagem',
    ]) {
      expect(techniques, expected).toContain(expected)
    }
  })

  it('RF-303: Intermediário cobre as técnicas exigidas', () => {
    const techniques = exercisesForLevel('intermediario').map((e) => e.technique).join(' ')
    for (const expected of [
      'threshold braking',
      'frenagem máxima',
      'modulação do pedal',
      'brake release',
      'desaceleração',
    ]) {
      expect(techniques, expected).toContain(expected)
    }
  })

  it('RF-304: Avançado cobre as técnicas exigidas', () => {
    const techniques = exercisesForLevel('avancado').map((e) => e.technique).join(' ')
    for (const expected of [
      'trail braking',
      'brake release',
      'transferência de peso',
      'rotação',
      'combinação',
    ]) {
      expect(techniques, expected).toContain(expected)
    }
  })

  it('exercícios que medem tempo em faixa declaram a faixa', () => {
    // Sem `pressureBand`, o AttemptRecorder não calcula RF-206 e o critério
    // ficaria permanentemente não cumprido por ausência de dado.
    for (const exercise of CATALOG) {
      if (exercise.successCriteria.kind === 'pressure_hold') {
        expect(exercise.pressureBand, exercise.id).toEqual(exercise.successCriteria.band)
      }
    }
  })

  it('o exercício que usa marcador está sinalizado', () => {
    for (const exercise of CATALOG) {
      if (exercise.successCriteria.kind === 'reaction_delta') {
        expect(exercise.usesBrakingMarker, exercise.id).toBe(true)
      }
    }
  })

  it('todo critério tem descrição legível para a tela de preparação', () => {
    for (const exercise of CATALOG) {
      const summary = describeCriterion(exercise)
      expect(summary, exercise.id).toBeTruthy()
      expect(summary.length, exercise.id).toBeGreaterThan(10)
    }
  })

  it('todo sub-score declara como é calculado (RN-01)', () => {
    // O campo `scoring_rules` do RF-305 pede "quais sub-scores esse exercício
    // produz, E o que cada um mede". Sem a fórmula, a evaluation-scoring-engine
    // teria que adivinhar limiares — o que a skill dela proíbe explicitamente.
    for (const exercise of CATALOG) {
      for (const subScore of exercise.scoringRules.subScores) {
        expect(subScore.describes, `${exercise.id}/${subScore.id}`).toBeTruthy()
        expect(subScore.spec, `${exercise.id}/${subScore.id}`).toBeDefined()
        expect(subScore.spec.formula, `${exercise.id}/${subScore.id}`).toBeTruthy()
      }
    }
  })

  it('nenhum exercício declara o mesmo sub-score duas vezes', () => {
    for (const exercise of CATALOG) {
      const ids = exercise.scoringRules.subScores.map((s) => s.id)
      expect(new Set(ids).size, exercise.id).toBe(ids.length)
    }
  })

  it('faixas e tolerâncias das fórmulas são utilizáveis', () => {
    // Uma faixa invertida ou tolerância zero produziria score constante,
    // silenciosamente — o pior modo de falha possível numa fórmula de pontuação.
    for (const exercise of CATALOG) {
      for (const { id, spec } of exercise.scoringRules.subScores) {
        const where = `${exercise.id}/${id}`
        if (spec.formula === 'target_range') {
          expect(spec.range[1], where).toBeGreaterThan(spec.range[0])
        }
        if (spec.formula === 'target_value') {
          expect(spec.maxDeviation, where).toBeGreaterThan(0)
        }
        if (spec.formula === 'proportion') {
          expect(spec.required, where).toBeGreaterThan(0)
        }
        if (spec.formula === 'correlation') {
          expect(spec.minAbsolute, where).toBeGreaterThan(0)
        }
        if (spec.formula === 'consistency') {
          expect(spec.maxCoefficientOfVariation, where).toBeGreaterThan(0)
        }
      }
    }
  })

  it('findExercise localiza por id e devolve undefined para desconhecido', () => {
    expect(findExercise('adv-01-trail-braking')?.level).toBe('avancado')
    expect(findExercise('nao-existe')).toBeUndefined()
  })
})
