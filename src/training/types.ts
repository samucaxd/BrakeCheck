/**
 * Training Engine — schema de exercício (RF-305) e critérios avaliáveis.
 *
 * **Onde esta camada para:** define o que cada exercício exige e se uma
 * tentativa cumpriu o critério (booleano). Não calcula sub-scores nem score
 * agregado — isso é da `evaluation-scoring-engine`. Não gera texto de feedback —
 * isso é da `coach-engine`; aqui só se declara o que ela deve *olhar*
 * (`feedbackFocus`).
 */

import type { ConsistencyMetricKey } from '../telemetry/consistency.js'

export type Level = 'fundamentos' | 'intermediario' | 'avancado'

export const LEVEL_ORDER: readonly Level[] = ['fundamentos', 'intermediario', 'avancado']

/**
 * Sub-scores que os exercícios produzem (RN-01).
 *
 * Esta camada só declara **quais** sub-scores um exercício gera; quem os calcula
 * é a `evaluation-scoring-engine`.
 */
export type SubScoreId =
  | 'aplicacao_inicial'
  | 'controle_pressao'
  | 'liberacao'
  | 'consistencia'
  | 'consistencia_direcional'
  | 'ponto_frenagem'

/**
 * Métricas que um exercício consome (campo `metrics_used` do RF-305).
 *
 * É uma união fechada, e não `string[]`, para que uma referência a métrica
 * inexistente seja erro de compilação em vez de campo decorativo. Também
 * documenta o grafo de dependência entre as camadas: o prefixo `exercise.`
 * marca o que é calculado aqui (`braking-training-engine` §4), tudo o mais vem
 * da `telemetry-engine`.
 */
export type MetricRef =
  | 'durationMs'
  | 'brake.min'
  | 'brake.max'
  | 'throttle.max'
  | 'steering.min'
  | 'steering.max'
  | 'brakingEvents.peakValue'
  | 'brakingEvents.applicationSpeed'
  | 'brakingEvents.releaseSpeed'
  | 'brakingEvents.timeToPeak'
  | 'timeInPressureRange'
  | 'overlap.brakeThrottle'
  | 'consistency.applicationSpeed'
  | 'consistency.releaseSpeed'
  | 'consistency.brakeMax'
  | 'consistency.timeInPressureRange'
  | 'exercise.reactionDelta'
  | 'exercise.steeringRangeDuringBraking'
  | 'exercise.brakeSteeringOverlap'
  | 'exercise.stabilizationInterval'
  | 'exercise.brakeSteeringCorrelation'
  | 'exercise.profileDeviation'
  | 'exercise.subBandCoverage'

/** Faixa inclusiva `[low, high]`. */
export type Band = readonly [number, number]

/** Um segmento da sequência de faixas do exercício 9. */
export interface BandSegment {
  band: Band
  startMs: number
  endMs: number
}

/** Ponto do perfil-alvo decrescente do exercício 11, interpolado linearmente. */
export interface ProfilePoint {
  atMs: number
  target: number
}

/**
 * Critérios de sucesso, como união discriminada.
 *
 * São dados estruturados e não prosa porque TC-302 a TC-305 exigem que o
 * **sistema** decida se a tentativa passou e se o gate de nível abriu. Um texto
 * descritivo não é avaliável; a prosa correspondente vive em `objective` e
 * `instructions`, que são o que o piloto lê.
 */
export type SuccessCriterion =
  /** Exercícios 1 e 4 — sustentar o curso dentro de uma faixa. */
  | {
      kind: 'pressure_hold'
      band: Band
      /** Janela pedida ao piloto, em ms. */
      windowMs: number
      /** Fração mínima da janela dentro da faixa, 0–1. */
      minCoverage: number
    }
  /** Exercício 2 — aplicação nem abrupta nem hesitante. */
  | { kind: 'application_speed_range'; range: Band }
  /** Exercício 3 — volante estável durante a frenagem. */
  | { kind: 'steering_stability'; maxRange: number }
  /** Exercício 5 — o próprio objetivo é repetir igual. */
  | {
      kind: 'inter_attempt_consistency'
      metrics: readonly ConsistencyMetricKey[]
      maxCoefficientOfVariation: number
    }
  /** Exercício 6 — reagir rápido e de forma repetível a um marcador. */
  | { kind: 'reaction_delta'; maxDeltaMs: number }
  /** Exercício 7 — pico na faixa de threshold, sustentado. */
  | { kind: 'peak_sustained'; band: Band; minEventCoverage: number }
  /** Exercício 8 — pico alto sem hesitar na aplicação. */
  | { kind: 'peak_and_application'; minPeak: number; minApplicationSpeed: number }
  /** Exercício 9 — seguir uma sequência de faixas dentro da mesma tentativa. */
  | { kind: 'band_sequence'; segments: readonly BandSegment[]; minCoveragePerSegment: number }
  /** Exercícios 10 e 13 — soltar progressivamente. */
  | { kind: 'release_speed_range'; range: Band }
  /** Exercício 11 — acompanhar um perfil decrescente. */
  | { kind: 'profile_tracking'; profile: readonly ProfilePoint[]; maxMeanDeviation: number }
  /** Exercício 12 — sobrepor liberação de freio e início de esterçamento. */
  | { kind: 'trail_overlap'; minOverlapMs: number; releaseRange: Band }
  /** Exercício 14 — deixar o carro assentar antes de esterçar forte. */
  | { kind: 'stabilization_interval'; minIntervalMs: number }
  /** Exercício 15 — reduzir freio residual conforme o volante gira. */
  | { kind: 'brake_steering_correlation'; maxCorrelation: number }
  /** Exercício 16 — retomada limpa, sem pisar nos dois pedais. */
  | {
      kind: 'clean_handoff'
      maxBrakeThrottleOverlapMs: number
      minTrailOverlapMs: number
      maxCorrelation: number
    }

/**
 * Exigência de consistência entre tentativas dentro de uma condição de avanço.
 *
 * `key` cobre tanto métricas da `telemetry-engine` quanto as específicas de
 * exercício (§4), porque a condição de avanço do exercício 6 pede o CV do delta
 * de reação, que só existe aqui.
 */
export type ConsistencyKey = ConsistencyMetricKey | 'reactionDelta'

export interface ConsistencyRequirement {
  key: ConsistencyKey
  maxCoefficientOfVariation: number
}

/**
 * Condição de domínio de um exercício (RN-03).
 *
 * O tipo **obriga** a combinação que a RN-03 exige: um exercício não é dominado
 * por acertar uma vez. `attemptsRequired` sempre existe, e é o que impede que
 * "completou" vire "avançou".
 */
export interface AdvanceCondition {
  /** Tentativas que precisam cumprir o critério de sucesso. */
  attemptsRequired: number
  /** Dentro de uma janela de quantas tentativas recentes. */
  outOf: number
  /** Se as tentativas precisam ser consecutivas (exercício 1). */
  consecutive: boolean
  /** Score agregado mínimo sustentado, quando o exercício exige (exercício 2). */
  minScore?: number
  /** Exigências de baixa variabilidade. */
  consistency: readonly ConsistencyRequirement[]
}

/** Um exercício do catálogo, com os 11 campos do RF-305. */
export interface Exercise {
  id: string
  name: string
  level: Level
  technique: string
  objective: string
  explanation: string
  instructions: string
  /** Posição dentro do nível, 1 = introdutório. Define a ordem de desbloqueio. */
  difficulty: number
  metricsUsed: readonly MetricRef[]
  successCriteria: SuccessCriterion
  scoringRules: {
    subScores: readonly SubScoreId[]
    /** O que cada sub-score mede neste exercício especificamente. */
    describes: Readonly<Partial<Record<SubScoreId, string>>>
  }
  /** O que a `coach-engine` deve observar — não é o texto do feedback. */
  feedbackFocus: readonly string[]
  advanceCondition: AdvanceCondition
  /**
   * Faixa de pressão a passar ao `AttemptRecorder` para RF-206, quando o
   * exercício mede tempo em faixa.
   */
  pressureBand?: Band
  /**
   * `true` quando o exercício mostra um marcador e mede o tempo de reação
   * (exercício 6). O fluxo de execução precisa saber para registrar o marcador.
   */
  usesBrakingMarker?: boolean
}
