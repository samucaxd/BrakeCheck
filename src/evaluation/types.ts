/**
 * Evaluation & Scoring Engine — tipos (RF-401 a RF-405).
 *
 * **Onde esta camada para:** entrega números. Nenhum texto de feedback sai
 * daqui — isso é da `coach-engine`, que consome estes números já prontos.
 */

import type { SubScoreId } from '../training/types.js'

/** RF-403 — classificação de desempenho. */
export type PerformanceLevel = 'bronze' | 'silver' | 'gold' | 'master'

export interface SubScore {
  id: SubScoreId
  /** 0–100. `null` quando a tentativa não produziu a métrica que ele mede. */
  value: number | null
  /** O que este sub-score mede neste exercício (vem do catálogo). */
  describes: string
}

/** RF-401, RF-402, RF-403 — resultado de uma tentativa. */
export interface ScoreResult {
  attemptRef: string
  exerciseId: string
  subScores: SubScore[]
  /** 0–100. `null` quando nenhum sub-score pôde ser calculado. */
  totalScore: number | null
  /** `null` quando não há score a classificar. */
  level: PerformanceLevel | null
}

/** As 7 dimensões fixas do PRD §8. */
export type SkillDimension =
  | 'brakeControl'
  | 'thresholdBraking'
  | 'brakeRelease'
  | 'trailBraking'
  | 'steeringControl'
  | 'throttleControl'
  | 'consistency'

export const SKILL_DIMENSIONS: readonly SkillDimension[] = [
  'brakeControl',
  'thresholdBraking',
  'brakeRelease',
  'trailBraking',
  'steeringControl',
  'throttleControl',
  'consistency',
]

/** Rótulos de exibição (RN-02). Em inglês por serem termos técnicos consagrados (RNF-10). */
export const DIMENSION_LABELS: Readonly<Record<SkillDimension, string>> = {
  brakeControl: 'Brake Control',
  thresholdBraking: 'Threshold Braking',
  brakeRelease: 'Brake Release',
  trailBraking: 'Trail Braking',
  steeringControl: 'Steering Control',
  throttleControl: 'Throttle Control',
  consistency: 'Consistency',
}

/**
 * Um ponto na evolução do perfil.
 *
 * Uma dimensão é `null` quando nenhum exercício que a alimenta foi tentado —
 * **nunca 0**. Zero significaria "desempenho ruim"; ausência de dado é outra
 * coisa, e confundir as duas faria o coach recomendar treino para uma fraqueza
 * que ninguém mediu.
 */
export interface SkillProfilePoint {
  timestamp: number
  values: Readonly<Record<SkillDimension, number | null>>
}

/** RF-404, RF-405 — perfil com histórico preservado. */
export interface SkillProfile {
  current: Readonly<Record<SkillDimension, number | null>>
  /** RF-405 — sempre append, nunca sobrescrita (TC-405). */
  history: readonly SkillProfilePoint[]
}
