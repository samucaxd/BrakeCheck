/**
 * Tipos da camada de persistência (RF-601 a RF-605).
 */

import type { CoachFeedback } from '../coach/feedback.js'
import type { SkillDimension, ScoreResult } from '../evaluation/types.js'
import type { DerivedMetrics } from '../telemetry/types.js'

/**
 * `incomplete` não é definido por nenhum código normal — só a rotina de
 * recuperação no boot o atribui, a sessões órfãs de um encerramento abrupto
 * (`session-persistence` §1 e §3).
 */
export type SessionStatus = 'active' | 'paused' | 'finished' | 'incomplete'

export interface SessionRecord {
  id: number
  startTime: number
  endTime: number | null
  status: SessionStatus
  deviceInfo: string | null
}

export interface SessionSummary extends SessionRecord {
  attemptsCount: number
}

/** Tentativa como está no disco. Nome distinto do `AttemptRecord` da camada de treino. */
export interface StoredAttempt {
  id: number
  sessionId: number
  exerciseId: string
  timestamp: number
  derivedMetrics: DerivedMetrics
  /** `null` até a `evaluation-scoring-engine` calcular. */
  scoreResult: ScoreResult | null
  /** `null` até a `coach-engine` gerar. */
  feedback: CoachFeedback | null
}

export interface StoredSample {
  timestamp: number
  brake: number
  throttle: number
  steering: number
}

export interface ExerciseProgressRow {
  exerciseId: string
  unlocked: boolean
  mastered: boolean
  masteredAt: number | null
}

export interface CalibrationRow {
  axis: string
  rawMin: number
  rawMax: number
  capturedAt: number
}

export interface ExerciseComparison {
  exerciseId: string
  /** Média de `totalScore` das tentativas do exercício na sessão. `null` se não houve. */
  avgScoreA: number | null
  avgScoreB: number | null
  /** `null` quando algum dos lados não tem dado — não é o mesmo que delta zero. */
  delta: number | null
}

/** RF-604 — resultado da comparação entre duas sessões. */
export interface SessionComparison {
  sessionA: SessionSummary
  sessionB: SessionSummary
  byExercise: ExerciseComparison[]
  skillProfileDelta: Record<SkillDimension, number | null>
}
