/**
 * Progressão: domínio de exercício e gate de nível (RF-307, RN-03).
 *
 * É o módulo que o `CLAUDE.md` cita nominalmente entre "o que NÃO fazer": não
 * avançar o piloto de nível só por ter "completado" um exercício uma vez. Aqui
 * isso é estrutural, não uma verificação a mais — a `AdvanceCondition` sempre
 * exige N tentativas, e o gate de nível sempre exige o nível inteiro.
 *
 * Esta camada decide **acesso**. Ela não pontua (é da `evaluation-scoring-engine`)
 * nem escolhe o que recomendar em seguida (é da `coach-engine`, RN-05).
 */

import { computeConsistency } from '../telemetry/consistency.js'
import type { ConsistencyMetricKey } from '../telemetry/consistency.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import { CATALOG, exercisesForLevel } from './catalog.js'
import type { ExerciseMetrics } from './exercise-metrics.js'
import type { AdvanceCondition, ConsistencyKey, Exercise, Level } from './types.js'
import { LEVEL_ORDER } from './types.js'

/** Uma tentativa já executada e avaliada. */
export interface AttemptRecord {
  exerciseId: string
  metrics: DerivedMetrics
  exerciseMetrics: ExerciseMetrics
  /** Se cumpriu o critério de sucesso do exercício. */
  criterionMet: boolean
  /**
   * Score agregado, quando a `evaluation-scoring-engine` já o calculou.
   * `null`/ausente enquanto não houver — condições com `minScore` tratam isso
   * como não cumprido, nunca como aprovado por omissão.
   */
  score?: number | null
}

export interface UnmetRequirement {
  requirement: string
  detail: string
}

export interface MasteryResult {
  mastered: boolean
  /** O que falta, em linguagem exibível (TC-305 exige explicar o motivo). */
  missing: UnmetRequirement[]
}

/** Extrai um valor de consistência de uma tentativa, seja de telemetria ou específico do exercício. */
function consistencyValue(record: AttemptRecord, key: ConsistencyKey): number | null {
  if (key === 'reactionDelta') return record.exerciseMetrics.reactionDeltaMs
  return null // as demais vêm de DerivedMetrics, via computeConsistency
}

const EXERCISE_SPECIFIC_KEYS: readonly ConsistencyKey[] = ['reactionDelta']

/**
 * Coeficiente de variação de uma métrica ao longo das tentativas.
 *
 * Métricas de telemetria são delegadas a `computeConsistency` (RF-209) em vez de
 * recalculadas; só as específicas de exercício são resolvidas aqui, porque não
 * existem em `DerivedMetrics`.
 */
function coefficientOfVariationFor(
  records: readonly AttemptRecord[],
  key: ConsistencyKey,
): number | null {
  if (!EXERCISE_SPECIFIC_KEYS.includes(key)) {
    const report = computeConsistency(
      records.map((r) => r.metrics),
      [key as ConsistencyMetricKey],
    )
    return report.byMetric[key as ConsistencyMetricKey]?.coefficientOfVariation ?? null
  }

  const values = records
    .map((record) => consistencyValue(record, key))
    .filter((value): value is number => value !== null && Number.isFinite(value))

  if (values.length < 2) return null
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  if (mean === 0) return null
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance) / Math.abs(mean)
}

/** A maior sequência de tentativas consecutivas que cumpriram o critério. */
function longestConsecutiveRun(records: readonly AttemptRecord[]): number {
  let best = 0
  let current = 0
  for (const record of records) {
    current = record.criterionMet ? current + 1 : 0
    best = Math.max(best, current)
  }
  return best
}

/**
 * Avalia se um exercício foi dominado (RN-03).
 *
 * A janela considerada são as `outOf` tentativas **mais recentes**, não o
 * histórico inteiro: o objetivo é medir domínio atual. Sem isso, um piloto que
 * acertou 3 vezes há meses e vem errando desde então continuaria "dominando" o
 * exercício para sempre — exatamente o que a RN-03 quer impedir.
 */
export function evaluateMastery(
  exercise: Exercise,
  history: readonly AttemptRecord[],
): MasteryResult {
  const condition: AdvanceCondition = exercise.advanceCondition
  const relevant = history.filter((record) => record.exerciseId === exercise.id)
  const window = relevant.slice(-condition.outOf)
  const missing: UnmetRequirement[] = []

  if (window.length < condition.attemptsRequired) {
    missing.push({
      requirement: 'tentativas',
      detail: `${window.length} de ${condition.attemptsRequired} tentativas necessárias executadas`,
    })
  }

  const successful = window.filter((record) => record.criterionMet)

  if (condition.consecutive) {
    const run = longestConsecutiveRun(window)
    if (run < condition.attemptsRequired) {
      missing.push({
        requirement: 'tentativas consecutivas',
        detail: `melhor sequência: ${run} de ${condition.attemptsRequired} consecutivas dentro do critério`,
      })
    }
  } else if (successful.length < condition.attemptsRequired) {
    missing.push({
      requirement: 'tentativas dentro do critério',
      detail: `${successful.length} de ${condition.attemptsRequired} (em até ${condition.outOf} tentativas)`,
    })
  }

  if (condition.minScore !== undefined) {
    /**
     * Score ausente conta como não atingido. Tratar `null` como aprovado
     * deixaria o gate passar por omissão de dado, que é o modo mais silencioso
     * de violar a RN-03.
     */
    const qualifying = window.filter(
      (record) =>
        record.criterionMet &&
        record.score !== null &&
        record.score !== undefined &&
        record.score >= condition.minScore!,
    )
    if (qualifying.length < condition.attemptsRequired) {
      missing.push({
        requirement: `score ≥ ${condition.minScore}`,
        detail: `${qualifying.length} de ${condition.attemptsRequired} tentativas com score sustentado`,
      })
    }
  }

  for (const requirement of condition.consistency) {
    const cv = coefficientOfVariationFor(window, requirement.key)
    if (cv === null) {
      missing.push({
        requirement: `consistência de ${requirement.key}`,
        detail: 'ainda não há tentativas suficientes com essa métrica para medir variabilidade',
      })
      continue
    }
    if (cv > requirement.maxCoefficientOfVariation) {
      missing.push({
        requirement: `consistência de ${requirement.key}`,
        detail: `variabilidade ${cv.toFixed(2)} acima do máximo ${requirement.maxCoefficientOfVariation}`,
      })
    }
  }

  return { mastered: missing.length === 0, missing }
}

export interface AccessResult {
  locked: boolean
  /** Por que está bloqueado. Vazio quando liberado. */
  reasons: UnmetRequirement[]
}

/**
 * Decide se o piloto pode acessar um exercício (RF-307, TC-305).
 *
 * Duas travas, nesta ordem:
 *
 * 1. **Gate de nível** — todo exercício do nível anterior precisa estar
 *    dominado, não só o último. É a leitura mais estrita de RN-03, e é a que a
 *    skill §5 determina.
 * 2. **Ordem intra-nível** — dentro do nível, os exercícios abrem em sequência
 *    de dificuldade.
 *
 * Devolve o motivo junto com o bloqueio: a UI precisa explicar, não só negar.
 */
export function evaluateAccess(
  exercise: Exercise,
  history: readonly AttemptRecord[],
): AccessResult {
  const reasons: UnmetRequirement[] = []

  const levelIndex = LEVEL_ORDER.indexOf(exercise.level)
  for (let i = 0; i < levelIndex; i++) {
    const previousLevel = LEVEL_ORDER[i]!
    for (const previous of exercisesForLevel(previousLevel)) {
      const mastery = evaluateMastery(previous, history)
      if (!mastery.mastered) {
        reasons.push({
          requirement: `${previous.name} (${previousLevel})`,
          detail: mastery.missing.map((m) => m.detail).join('; '),
        })
      }
    }
  }

  for (const sibling of exercisesForLevel(exercise.level)) {
    if (sibling.difficulty >= exercise.difficulty) break
    const mastery = evaluateMastery(sibling, history)
    if (!mastery.mastered) {
      reasons.push({
        requirement: sibling.name,
        detail: mastery.missing.map((m) => m.detail).join('; '),
      })
    }
  }

  return { locked: reasons.length > 0, reasons }
}

/** Exercícios atualmente acessíveis, para a trilha da UI. */
export function unlockedExercises(history: readonly AttemptRecord[]): Exercise[] {
  return CATALOG.filter((exercise) => !evaluateAccess(exercise, history).locked)
}

/** Se um nível inteiro foi concluído — o gate para o nível seguinte. */
export function isLevelComplete(level: Level, history: readonly AttemptRecord[]): boolean {
  return exercisesForLevel(level).every(
    (exercise) => evaluateMastery(exercise, history).mastered,
  )
}
