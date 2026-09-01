/**
 * Fluxo de execução de um exercício (RF-306).
 *
 *     Preparação/Instruções → Contagem regressiva → N tentativas → Encerramento
 *
 * É a camada que amarra Device/Telemetry ao exercício: recebe `TelemetrySample`
 * já normalizados, cria um `AttemptRecorder` por tentativa com os parâmetros que
 * o exercício pede (faixa de pressão), e avalia o critério de sucesso ao fim de
 * cada uma.
 *
 * O que ela **não** faz: pontuar (`evaluation-scoring-engine`) e gerar texto
 * (`coach-engine`). No encerramento ela sinaliza que o bloco terminou, que é o
 * gatilho para essas camadas agirem.
 */

import { ATTEMPTS_PER_BLOCK, COUNTDOWN_SECONDS } from '../config/provisional.js'
import type { TelemetrySample } from '../shared/contracts.js'
import { AttemptRecorder } from '../telemetry/attempt-recorder.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import { evaluateCriterion, type CriterionEvaluation } from './criteria.js'
import { computeExerciseMetrics, type ExerciseMetrics } from './exercise-metrics.js'
import type { AttemptRecord } from './progression.js'
import type { Exercise } from './types.js'

export type SessionPhase =
  /** Exibindo objetivo, explicação e instruções (RF-306, passo 1). */
  | 'preparacao'
  /** Contagem regressiva antes de capturar (passo 2). */
  | 'contagem'
  /** Capturando uma tentativa (passo 3). */
  | 'capturando'
  /** Entre tentativas, aguardando o piloto iniciar a próxima. */
  | 'entre_tentativas'
  /** Bloco encerrado (passo 4). */
  | 'encerrado'

/** O que a UI exibe na fase de preparação (TC-301). */
export interface Briefing {
  name: string
  objective: string
  explanation: string
  instructions: string
  /** Descrição textual do que conta como sucesso, derivada do critério estruturado. */
  successSummary: string
  attempts: number
}

export interface CompletedAttempt {
  index: number
  metrics: DerivedMetrics
  exerciseMetrics: ExerciseMetrics
  evaluation: CriterionEvaluation
  rawSamplesRef: string
}

export interface BlockResult {
  exerciseId: string
  attempts: CompletedAttempt[]
  /** Registros no formato que a progressão consome. */
  records: AttemptRecord[]
}

export interface ExerciseSessionOptions {
  exercise: Exercise
  /** Id da sessão, para compor a referência da série bruta (RF-210). */
  sessionId: string
  attempts?: number
  countdownSeconds?: number
  /** Destino da série bruta; a `session-persistence` implementa. */
  onSample?: (sample: TelemetrySample, rawSamplesRef: string) => void
  now?: () => number
}

export class ExerciseSession {
  #exercise: Exercise
  #sessionId: string
  #attemptsTarget: number
  #countdownSeconds: number
  #now: () => number
  #onSample: ExerciseSessionOptions['onSample']

  #phase: SessionPhase = 'preparacao'
  #completed: CompletedAttempt[] = []
  #recorder: AttemptRecorder | null = null
  #currentRef = ''
  #currentSamples: TelemetrySample[] = []
  #markerTimestamp: number | undefined

  constructor(options: ExerciseSessionOptions) {
    this.#exercise = options.exercise
    this.#sessionId = options.sessionId
    this.#attemptsTarget = options.attempts ?? ATTEMPTS_PER_BLOCK
    this.#countdownSeconds = options.countdownSeconds ?? COUNTDOWN_SECONDS
    this.#now = options.now ?? Date.now
    this.#onSample = options.onSample
  }

  get phase(): SessionPhase {
    return this.#phase
  }

  get completedAttempts(): number {
    return this.#completed.length
  }

  get countdownSeconds(): number {
    return this.#countdownSeconds
  }

  /** RF-306 passo 1 — o que o piloto lê antes de começar (TC-301). */
  briefing(): Briefing {
    return {
      name: this.#exercise.name,
      objective: this.#exercise.objective,
      explanation: this.#exercise.explanation,
      instructions: this.#exercise.instructions,
      successSummary: describeCriterion(this.#exercise),
      attempts: this.#attemptsTarget,
    }
  }

  /** RF-306 passo 2 — sai da preparação para a contagem regressiva. */
  startCountdown(): void {
    if (this.#phase !== 'preparacao' && this.#phase !== 'entre_tentativas') {
      throw new Error(`Contagem regressiva não pode iniciar na fase "${this.#phase}"`)
    }
    if (this.#completed.length >= this.#attemptsTarget) {
      throw new Error('Bloco já tem todas as tentativas concluídas')
    }
    this.#phase = 'contagem'
  }

  /** RF-306 passo 3 — começa a capturar uma tentativa. */
  beginAttempt(): void {
    if (this.#phase !== 'contagem') {
      throw new Error(`Tentativa só começa após a contagem regressiva (fase atual: "${this.#phase}")`)
    }

    this.#currentRef = `${this.#sessionId}:${this.#exercise.id}:${this.#completed.length + 1}`
    this.#currentSamples = []
    this.#markerTimestamp = undefined
    this.#recorder = new AttemptRecorder({
      rawSamplesRef: this.#currentRef,
      ...(this.#exercise.pressureBand ? { pressureBand: this.#exercise.pressureBand } : {}),
      onSample: (sample) => {
        /**
         * A série da tentativa corrente é retida porque as métricas específicas
         * de exercício (correlação, desvio de perfil, cobertura de sub-faixa)
         * precisam olhar amostra a amostra. Uma tentativa dura segundos — o
         * TC-204 se preocupa com a sessão inteira, e essa é justamente a que
         * segue em streaming pelo `onSample`.
         */
        this.#currentSamples.push(sample)
        this.#onSample?.(sample, this.#currentRef)
      },
    })
    this.#phase = 'capturando'
  }

  /**
   * Registra o instante em que o marcador de ponto de frenagem foi exibido
   * (exercício 6). Sem isso o atraso de reação não tem referência.
   */
  markBrakingPoint(timestamp: number = this.#now()): void {
    if (this.#phase !== 'capturando') {
      throw new Error('O marcador só faz sentido durante a captura')
    }
    this.#markerTimestamp = timestamp
  }

  /** Alimenta a tentativa em andamento. */
  addSample(sample: TelemetrySample): void {
    if (this.#phase !== 'capturando' || this.#recorder === null) return
    this.#recorder.add(sample)
  }

  /** Fecha a tentativa corrente e avalia o critério de sucesso. */
  endAttempt(): CompletedAttempt {
    if (this.#phase !== 'capturando' || this.#recorder === null) {
      throw new Error('Nenhuma tentativa em andamento')
    }

    const { derivedMetrics, rawSamplesRef } = this.#recorder.finish()
    const exerciseMetrics = computeExerciseMetrics(
      {
        samples: this.#currentSamples,
        metrics: derivedMetrics,
        ...(this.#markerTimestamp !== undefined
          ? { markerTimestamp: this.#markerTimestamp }
          : {}),
      },
      criterionOptions(this.#exercise),
    )

    const evaluation = evaluateCriterion(this.#exercise.successCriteria, {
      metrics: derivedMetrics,
      exerciseMetrics,
      samples: this.#currentSamples,
      blockMetrics: [...this.#completed.map((a) => a.metrics), derivedMetrics],
    })

    const attempt: CompletedAttempt = {
      index: this.#completed.length + 1,
      metrics: derivedMetrics,
      exerciseMetrics,
      evaluation,
      rawSamplesRef,
    }
    this.#completed.push(attempt)

    this.#recorder = null
    this.#currentSamples = []
    this.#phase =
      this.#completed.length >= this.#attemptsTarget ? 'encerrado' : 'entre_tentativas'

    return attempt
  }

  /**
   * RF-306 passo 4 — resultado do bloco.
   *
   * Critérios que só existem entre tentativas (exercício 5) são **reavaliados**
   * aqui com o bloco completo: durante a captura, a tentativa 1 só conhecia a si
   * mesma e não tinha como responder uma pergunta sobre repetição.
   */
  result(): BlockResult {
    if (this.#phase !== 'encerrado') {
      throw new Error(`Bloco ainda não encerrado (fase atual: "${this.#phase}")`)
    }

    const blockMetrics = this.#completed.map((attempt) => attempt.metrics)
    const attempts = this.#completed.map((attempt) => ({
      ...attempt,
      evaluation:
        this.#exercise.successCriteria.kind === 'inter_attempt_consistency'
          ? evaluateCriterion(this.#exercise.successCriteria, {
              metrics: attempt.metrics,
              exerciseMetrics: attempt.exerciseMetrics,
              samples: [],
              blockMetrics,
            })
          : attempt.evaluation,
    }))

    return {
      exerciseId: this.#exercise.id,
      attempts,
      records: attempts.map((attempt) => ({
        exerciseId: this.#exercise.id,
        metrics: attempt.metrics,
        exerciseMetrics: attempt.exerciseMetrics,
        criterionMet: attempt.evaluation.met,
      })),
    }
  }
}

/** Parâmetros que algumas métricas específicas precisam receber do exercício. */
function criterionOptions(exercise: Exercise) {
  const criterion = exercise.successCriteria
  if (criterion.kind === 'profile_tracking') return { profile: criterion.profile }
  if (criterion.kind === 'band_sequence') return { segments: criterion.segments }
  return {}
}

/**
 * Resumo legível do critério de sucesso, para a tela de preparação (TC-301).
 *
 * Derivado do critério estruturado em vez de escrito à mão no catálogo: assim
 * um limiar ajustado em `catalog.ts` não deixa o texto exibido desatualizado.
 */
export function describeCriterion(exercise: Exercise): string {
  const c = exercise.successCriteria
  switch (c.kind) {
    case 'pressure_hold':
      return `Manter o freio entre ${c.band[0]}% e ${c.band[1]}% por ao menos ${(c.minCoverage * 100).toFixed(0)}% de ${(c.windowMs / 1000).toFixed(1)}s.`
    case 'application_speed_range':
      return `Velocidade de aplicação entre ${c.range[0]} e ${c.range[1]} %/s.`
    case 'steering_stability':
      return `Variação do volante durante a frenagem dentro de ${c.maxRange} pontos.`
    case 'inter_attempt_consistency':
      return `Coeficiente de variação ≤ ${c.maxCoefficientOfVariation} entre as tentativas, em ${c.metrics.join(' e ')}.`
    case 'reaction_delta':
      return `Iniciar a frenagem em até ${c.maxDeltaMs}ms após o marcador.`
    case 'peak_sustained':
      return `Pico entre ${c.band[0]}% e ${c.band[1]}%, sustentado por ≥ ${(c.minEventCoverage * 100).toFixed(0)}% do evento.`
    case 'peak_and_application':
      return `Pico ≥ ${c.minPeak}% com velocidade de aplicação ≥ ${c.minApplicationSpeed} %/s.`
    case 'band_sequence':
      return `Ficar ≥ ${(c.minCoveragePerSegment * 100).toFixed(0)}% do tempo dentro de cada uma das ${c.segments.length} faixas da sequência.`
    case 'release_speed_range':
      return `Velocidade de liberação entre ${c.range[0]} e ${c.range[1]} %/s.`
    case 'profile_tracking':
      return `Desvio médio em relação ao perfil-alvo ≤ ${c.maxMeanDeviation} pontos percentuais.`
    case 'trail_overlap':
      return `Ao menos ${c.minOverlapMs}ms de freio residual com o volante já girando, mantendo a liberação entre ${c.releaseRange[0]} e ${c.releaseRange[1]} %/s.`
    case 'stabilization_interval':
      return `Ao menos ${c.minIntervalMs}ms entre o pico de freio e o esterçamento acentuado.`
    case 'brake_steering_correlation':
      return `Correlação entre freio e ângulo de volante ≤ ${c.maxCorrelation} (freio caindo enquanto o ângulo cresce).`
    case 'clean_handoff':
      return `Overlap freio×acelerador ≤ ${c.maxBrakeThrottleOverlapMs}ms, mantendo trail braking ≥ ${c.minTrailOverlapMs}ms.`
  }
}
