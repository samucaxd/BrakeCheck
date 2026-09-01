/**
 * Recomendação adaptativa de próximo exercício (RF-503, RF-504, RF-505, RN-05).
 *
 * O fluxo da RN-05, que **nunca** é "o próximo da lista":
 *
 *   Skill Profile → dimensão mais fraca
 *      ↓
 *   exercícios que alimentam essa dimensão
 *      ↓
 *   filtrar: desbloqueados e ainda não dominados
 *      ↓
 *   entre eles, o de menor score recente
 *
 * A ordem sequencial do catálogo serve para **desbloqueio**, não para
 * recomendação (`braking-training-engine` §5).
 */

import { DIMENSION_SOURCES } from '../evaluation/skill-profile.js'
import { SKILL_DIMENSIONS, DIMENSION_LABELS } from '../evaluation/types.js'
import type { ScoreResult, SkillDimension, SkillProfile } from '../evaluation/types.js'
import { CATALOG, findExercise } from '../training/catalog.js'
import { evaluateAccess, evaluateMastery } from '../training/progression.js'
import type { AttemptRecord } from '../training/progression.js'
import { LEVEL_ORDER } from '../training/types.js'
import type { Exercise } from '../training/types.js'

export interface Recommendation {
  exerciseId: string
  exerciseName: string
  /** Dimensão que motivou a escolha. `null` no caminho de fallback. */
  dimension: SkillDimension | null
  /** Explicação exibível de por que este exercício, e não outro. */
  reason: string
  /**
   * `true` quando a dimensão mais fraca não tinha nenhum exercício alcançável e
   * a recomendação caiu para a ordem sequencial do nível atual.
   */
  fallback: boolean
}

export interface RecommendationInput {
  profile: SkillProfile
  /** Histórico de tentativas, que define o que está desbloqueado e dominado. */
  history: readonly AttemptRecord[]
  /**
   * Resultados recentes, para escolher o exercício que mais puxa a dimensão
   * para baixo. `coach-engine` §7 propõe a janela do último bloco, não o
   * histórico inteiro — mais sensível a progresso recente.
   */
  recentScores: readonly ScoreResult[]
}

function isAccessible(exercise: Exercise, history: readonly AttemptRecord[]): boolean {
  return !evaluateAccess(exercise, history).locked
}

function isMastered(exercise: Exercise, history: readonly AttemptRecord[]): boolean {
  return evaluateMastery(exercise, history).mastered
}

/**
 * RF-503 — a maior deficiência do momento.
 *
 * Regra de prioridade da skill §2: uma dimensão **sem dado** que já tenha
 * exercício desbloqueado vem antes da mais fraca com dado. Não dá para saber que
 * ela é fraca, mas também não dá para saber que está bem, e gerar a primeira
 * medição é mais urgente que otimizar algo já medido.
 */
export function primaryDeficiency(
  profile: SkillProfile,
  history: readonly AttemptRecord[],
): SkillDimension | null {
  /**
   * "Alcançável" aqui é desbloqueado **e ainda não dominado** — a frente da
   * trilha. Um exercício já dominado não é para onde o piloto é mandado para
   * gerar a primeira medição de uma dimensão; ele já foi por lá.
   */
  const reachable = new Set(
    CATALOG.filter(
      (exercise) => isAccessible(exercise, history) && !isMastered(exercise, history),
    ).map((e) => e.id),
  )

  /**
   * Entre várias dimensões sem dado, vence a que tem o exercício alcançável mais
   * cedo na trilha — mesmo critério de desempate que `coach-engine` §7 usa entre
   * exercícios ("o mais imediatamente acionável"), em vez de depender da ordem
   * em que as dimensões foram declaradas.
   */
  let priority: SkillDimension | null = null
  let priorityRank = Infinity

  for (const dimension of SKILL_DIMENSIONS) {
    if (profile.current[dimension] !== null) continue
    for (const id of DIMENSION_SOURCES[dimension]) {
      if (!reachable.has(id)) continue
      const exercise = findExercise(id)!
      const rank = LEVEL_ORDER.indexOf(exercise.level) * 100 + exercise.difficulty
      if (rank < priorityRank) {
        priorityRank = rank
        priority = dimension
      }
    }
  }
  if (priority !== null) return priority

  let weakest: SkillDimension | null = null
  let lowest = Infinity
  for (const dimension of SKILL_DIMENSIONS) {
    const value = profile.current[dimension]
    if (value === null || !Number.isFinite(value)) continue
    if (value < lowest) {
      lowest = value
      weakest = dimension
    }
  }
  return weakest
}

/** Média dos scores recentes de um exercício. `null` = nunca tentado. */
function recentAverage(exerciseId: string, recentScores: readonly ScoreResult[]): number | null {
  const values = recentScores
    .filter((result) => result.exerciseId === exerciseId)
    .map((result) => result.totalScore)
    .filter((value): value is number => value !== null)

  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Ordena candidatos: nunca tentado primeiro, depois o de menor score recente.
 *
 * Um exercício nunca tentado tem prioridade pelo mesmo motivo da dimensão sem
 * dado — gerar a primeira medição vale mais que refinar uma já existente.
 * Empate resolve por menor `difficulty` (`coach-engine` §7), por ser o mais
 * imediatamente acionável.
 */
function pickMostUrgent(
  candidates: readonly Exercise[],
  recentScores: readonly ScoreResult[],
): Exercise | null {
  let best: Exercise | null = null
  let bestScore = Infinity

  for (const candidate of candidates) {
    const average = recentAverage(candidate.id, recentScores)
    const rank = average === null ? -1 : average

    if (best === null || rank < bestScore) {
      best = candidate
      bestScore = rank
      continue
    }
    if (rank === bestScore && candidate.difficulty < best.difficulty) {
      best = candidate
    }
  }

  return best
}

/**
 * Primeiro exercício não dominado seguindo a ordem normal da trilha.
 *
 * Caminho de fallback da skill §4, para quando a dimensão mais fraca não tem
 * nenhum exercício alcançável — a forma honesta de dizer "ainda não dá para
 * atacar isso diretamente, mas seguir o caminho normal aproxima disso".
 */
function nextInSequence(history: readonly AttemptRecord[]): Exercise | null {
  const ordered = [...CATALOG].sort((a, b) => {
    const levelDelta = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
    return levelDelta !== 0 ? levelDelta : a.difficulty - b.difficulty
  })

  return (
    ordered.find(
      (exercise) => isAccessible(exercise, history) && !isMastered(exercise, history),
    ) ?? null
  )
}

/**
 * RF-504 / RN-05 — o próximo exercício.
 *
 * RF-505 sai de graça: o filtro "desbloqueado e não dominado" respeita o gate da
 * `braking-training-engine` cegamente. Como toda `advance_condition` exige
 * domínio **e** consistência, um exercício avançado concluído com baixa
 * consistência continua não-dominado, e nada além dele é recomendado — que é
 * exatamente o TC-504.
 */
export function recommendNext(input: RecommendationInput): Recommendation | null {
  const { profile, history, recentScores } = input
  const dimension = primaryDeficiency(profile, history)

  if (dimension !== null) {
    const feeding = DIMENSION_SOURCES[dimension]
      .map((id) => findExercise(id))
      .filter((exercise): exercise is Exercise => exercise !== undefined)
      .filter((exercise) => isAccessible(exercise, history))

    const pending = feeding.filter((exercise) => !isMastered(exercise, history))

    /**
     * Exercícios já dominados entram como segunda opção.
     *
     * Motivo estrutural: o desbloqueio é estritamente sequencial
     * (`braking-training-engine` §5), então existe no máximo **um** exercício
     * desbloqueado e não dominado em todo o catálogo a qualquer momento. Se a
     * recomendação só olhasse para esse, ela seria sempre "o próximo da fila" —
     * exatamente o que a RN-05 proíbe ("nunca a ordem sequencial por padrão").
     *
     * Mandar o piloto revisitar um exercício já dominado que alimenta a dimensão
     * fraca é seguro (nada bloqueado é recomendado, RF-505 intacto) e é o que a
     * própria `braking-training-engine` §3 prevê para o fim da trilha, quando não
     * há mais nível seguinte na V1.
     */
    const chosen =
      pickMostUrgent(pending, recentScores) ?? pickMostUrgent(feeding, recentScores)

    if (chosen) {
      const value = profile.current[dimension]
      const state = value === null ? 'ainda sem medição' : `Score ${Math.round(value)}`
      const revisit = isMastered(chosen, history)
      return {
        exerciseId: chosen.id,
        exerciseName: chosen.name,
        dimension,
        reason: `Principal deficiência identificada: ${DIMENSION_LABELS[dimension]} (${state}).${
          revisit ? ' Exercício já dominado, retomado para reforçar essa dimensão.' : ''
        }`,
        fallback: false,
      }
    }
  }

  const sequential = nextInSequence(history)
  if (!sequential) return null

  return {
    exerciseId: sequential.id,
    exerciseName: sequential.name,
    dimension: null,
    reason:
      dimension === null
        ? 'Sem histórico suficiente para identificar uma deficiência — seguindo a ordem da trilha.'
        : `${DIMENSION_LABELS[dimension]} é o ponto mais fraco, mas nenhum exercício que treina essa dimensão está liberado ainda. Seguir a trilha aproxima disso.`,
    fallback: true,
  }
}

/**
 * Formato de referência da RN-05 (PRD §9), para exibição.
 *
 * ```
 * Trail Braking (Score: 58)
 *    ↓
 * Principal deficiência identificada: Brake Release
 *    ↓
 * Próximo exercício recomendado: Progressive Brake Release
 * ```
 */
export function formatRecommendation(recommendation: Recommendation): string {
  return [
    recommendation.reason,
    '   ↓',
    `Próximo exercício recomendado: ${recommendation.exerciseName}`,
  ].join('\n')
}
