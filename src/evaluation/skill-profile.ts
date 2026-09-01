/**
 * Driving Skill Profile (RF-404, RF-405).
 *
 * Sete dimensões fixas do PRD §8, alimentadas pelos sub-scores dos exercícios
 * que cada uma cobre.
 */

import type { SubScoreId } from '../training/types.js'
import type {
  ScoreResult,
  SkillDimension,
  SkillProfile,
  SkillProfilePoint,
} from './types.js'
import { SKILL_DIMENSIONS } from './types.js'

/**
 * Mapeamento exercício → dimensão (`evaluation-scoring-engine` §5).
 *
 * ⚠️ Assunção provisória registrada pela própria skill: é uma interpretação
 * razoável construída a partir da técnica de cada exercício, **não** uma
 * definição literal do PRD, que não detalha esse mapeamento.
 *
 * Desbalanceamento esperado na V1, e não um bug: como o foco de conteúdo é
 * frenagem (PRD §2), `throttleControl` é alimentado por um único exercício e
 * `steeringControl` é sempre secundário a exercícios de freio. Essas duas
 * dimensões terão base amostral mais fraca até o roadmap V2+ trazer outras
 * técnicas.
 */
export const DIMENSION_SOURCES: Readonly<Record<SkillDimension, readonly string[]>> = {
  brakeControl: [
    'fund-01-controle-pedal',
    'fund-02-aplicacao-progressiva',
    'fund-03-frenagem-linha-reta',
    'fund-04-controle-pressao',
    'fund-06-ponto-frenagem',
    'int-03-modulacao-pedal',
  ],
  thresholdBraking: [
    'int-01-threshold-braking',
    'int-02-frenagem-maxima',
    'int-05-pressao-desaceleracao',
  ],
  brakeRelease: [
    'int-04-liberacao-progressiva',
    'int-05-pressao-desaceleracao',
    'adv-02-brake-release',
  ],
  trailBraking: [
    'adv-01-trail-braking',
    'adv-03-transferencia-peso',
    'adv-04-frenagem-rotacao',
    'adv-05-combinacao-completa',
  ],
  steeringControl: [
    'fund-03-frenagem-linha-reta',
    'adv-02-brake-release',
    'adv-04-frenagem-rotacao',
    'adv-05-combinacao-completa',
  ],
  throttleControl: ['adv-05-combinacao-completa'],
  consistency: ['fund-05-consistencia'],
}

/** O sub-score "Consistência" alimenta a dimensão Consistency venha de onde vier. */
const CONSISTENCY_SUBSCORE: SubScoreId = 'consistencia'

export function emptyProfile(): SkillProfile {
  return {
    current: Object.fromEntries(SKILL_DIMENSIONS.map((d) => [d, null])) as Record<
      SkillDimension,
      number | null
    >,
    history: [],
  }
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Calcula as dimensões a partir dos resultados do bloco mais recente de cada
 * exercício.
 *
 * Espera receber os `ScoreResult` das tentativas mais recentes — tipicamente os
 * de uma sessão. Uma dimensão sem nenhum exercício tentado sai `null`, nunca 0.
 */
export function computeDimensions(
  results: readonly ScoreResult[],
): Record<SkillDimension, number | null> {
  const values = {} as Record<SkillDimension, number | null>

  for (const dimension of SKILL_DIMENSIONS) {
    const sources = DIMENSION_SOURCES[dimension]
    const relevant: number[] = []

    for (const result of results) {
      const feedsDimension = sources.includes(result.exerciseId)
      /**
       * A dimensão Consistency recebe também o sub-score "Consistência" de
       * qualquer exercício que o produza, não só do exercício dedicado — é o
       * que `evaluation-scoring-engine` §5 determina.
       */
      const feedsConsistency =
        dimension === 'consistency' &&
        result.subScores.some((s) => s.id === CONSISTENCY_SUBSCORE && s.value !== null)

      if (!feedsDimension && !feedsConsistency) continue

      for (const subScore of result.subScores) {
        if (subScore.value === null) continue
        if (dimension === 'consistency' && !feedsDimension) {
          if (subScore.id !== CONSISTENCY_SUBSCORE) continue
        }
        relevant.push(subScore.value)
      }
    }

    values[dimension] = mean(relevant)
  }

  return values
}

/**
 * RF-404 + RF-405 — atualiza o perfil e **acrescenta** um ponto ao histórico.
 *
 * Nunca sobrescreve (TC-405): o histórico é o que permite mostrar evolução ao
 * longo do tempo, e é a única coisa aqui que não pode ser recalculada depois se
 * for perdida.
 *
 * Dimensões sem dado nesta sessão preservam o valor corrente anterior em vez de
 * virarem `null`: não ter treinado trail braking hoje não apaga o que o piloto
 * já demonstrou. O ponto do histórico registra o estado do perfil naquele
 * instante, e não apenas o que a sessão mediu.
 */
export function updateProfile(
  profile: SkillProfile,
  results: readonly ScoreResult[],
  timestamp: number,
): SkillProfile {
  const measured = computeDimensions(results)
  const current = {} as Record<SkillDimension, number | null>

  for (const dimension of SKILL_DIMENSIONS) {
    current[dimension] = measured[dimension] ?? profile.current[dimension] ?? null
  }

  const point: SkillProfilePoint = { timestamp, values: { ...current } }

  return {
    current,
    history: [...profile.history, point],
  }
}

/**
 * A dimensão mais fraca do perfil (base para RF-503/RN-05, na `coach-engine`).
 *
 * Dimensões `null` são ignoradas, não tratadas como zero: recomendar treino para
 * a fraqueza que ninguém mediu é exatamente o erro que a distinção
 * `null` × 0 existe para evitar.
 */
export function weakestDimension(profile: SkillProfile): SkillDimension | null {
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
