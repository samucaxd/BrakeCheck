/**
 * Fluxo de execução de exercício (RF-306) e TC-301 do PRD §10.3.
 *
 * Roda o bloco de ponta a ponta com traços sintéticos, o que também exercita a
 * fronteira Telemetry → Training: o exercício recebe `TelemetrySample` e sai com
 * critério avaliado, sem tocar em hardware.
 */

import { describe, expect, it } from 'vitest'

import { findExercise } from '../../src/training/catalog.js'
import { ExerciseSession } from '../../src/training/exercise-session.js'
import { evaluateMastery } from '../../src/training/progression.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'
import { brakingTrace, EPOCH } from '../helpers/traces.js'

const progressiva = findExercise('fund-02-aplicacao-progressiva')!
const controlePedal = findExercise('fund-01-controle-pedal')!

/** Executa um bloco inteiro, alimentando cada tentativa com o traço dado. */
function runBlock(
  exercise: typeof progressiva,
  traces: readonly (readonly TelemetrySample[])[],
  options: { markerOffsetMs?: number } = {},
) {
  const session = new ExerciseSession({
    exercise,
    sessionId: 'sess-1',
    attempts: traces.length,
  })

  for (const trace of traces) {
    session.startCountdown()
    session.beginAttempt()
    if (options.markerOffsetMs !== undefined) {
      session.markBrakingPoint(EPOCH + options.markerOffsetMs)
    }
    for (const sample of trace) session.addSample(sample)
    session.endAttempt()
  }

  return session
}

describe('ExerciseSession — fluxo (RF-306)', () => {
  it('TC-301: a preparação expõe objetivo, instruções e critério de sucesso', () => {
    const session = new ExerciseSession({ exercise: progressiva, sessionId: 'sess-1' })

    expect(session.phase).toBe('preparacao')
    const briefing = session.briefing()

    expect(briefing.name).toBe(progressiva.name)
    expect(briefing.objective).toBe(progressiva.objective)
    expect(briefing.explanation).toBe(progressiva.explanation)
    expect(briefing.instructions).toBe(progressiva.instructions)
    // O resumo do critério é derivado do dado estruturado, então não pode
    // desatualizar quando um limiar do catálogo mudar.
    expect(briefing.successSummary).toContain('150')
    expect(briefing.successSummary).toContain('350')
    expect(briefing.attempts).toBe(5)
  })

  it('percorre preparação → contagem → captura → encerramento', () => {
    const session = new ExerciseSession({
      exercise: progressiva,
      sessionId: 'sess-1',
      attempts: 2,
    })
    const trace = brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 })

    expect(session.phase).toBe('preparacao')
    session.startCountdown()
    expect(session.phase).toBe('contagem')
    session.beginAttempt()
    expect(session.phase).toBe('capturando')

    for (const sample of trace) session.addSample(sample)
    session.endAttempt()
    // Ainda falta uma tentativa: fica entre tentativas, não encerrado.
    expect(session.phase).toBe('entre_tentativas')

    session.startCountdown()
    session.beginAttempt()
    for (const sample of trace) session.addSample(sample)
    session.endAttempt()

    expect(session.phase).toBe('encerrado')
    expect(session.completedAttempts).toBe(2)
  })

  it('a contagem regressiva não pode ser pulada', () => {
    const session = new ExerciseSession({ exercise: progressiva, sessionId: 'sess-1' })
    expect(() => session.beginAttempt()).toThrow()
  })

  it('não aceita mais tentativas que o bloco define', () => {
    const trace = brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 })
    const session = runBlock(progressiva, [trace])
    expect(session.phase).toBe('encerrado')
    expect(() => session.startCountdown()).toThrow()
  })

  it('o resultado só sai com o bloco encerrado', () => {
    const session = new ExerciseSession({ exercise: progressiva, sessionId: 'sess-1' })
    expect(() => session.result()).toThrow()
  })

  it('RF-210: cada tentativa recebe sua própria referência de série bruta', () => {
    const trace = brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 })
    const refs: string[] = []
    const session = new ExerciseSession({
      exercise: progressiva,
      sessionId: 'sess-7',
      attempts: 2,
      onSample: (_sample, ref) => {
        if (!refs.includes(ref)) refs.push(ref)
      },
    })

    for (let i = 0; i < 2; i++) {
      session.startCountdown()
      session.beginAttempt()
      for (const sample of trace) session.addSample(sample)
      session.endAttempt()
    }

    expect(refs).toEqual(['sess-7:fund-02-aplicacao-progressiva:1', 'sess-7:fund-02-aplicacao-progressiva:2'])
  })
})

describe('ExerciseSession — avaliação do critério', () => {
  it('aplicação dentro da faixa cumpre o critério do exercício 2', () => {
    // Sobe ~80% em 300ms ≈ 265 %/s, dentro da faixa 150–350.
    const trace = brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 })
    const session = runBlock(progressiva, [trace])

    const attempt = session.result().attempts[0]!
    expect(attempt.evaluation.met).toBe(true)
    expect(attempt.evaluation.observed).toBeGreaterThan(150)
    expect(attempt.evaluation.observed).toBeLessThan(350)
  })

  it('aplicação abrupta reprova, e o observado explica o porquê', () => {
    // ~80% em 50ms ≈ 1500 %/s: "chute" no pedal.
    const trace = brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 })
    const session = runBlock(progressiva, [trace])

    const attempt = session.result().attempts[0]!
    expect(attempt.evaluation.met).toBe(false)
    expect(attempt.evaluation.observed!).toBeGreaterThan(350)
    // O valor observado é o que permite à coach-engine dizer "abrupta" em vez
    // de um texto genérico (RN-04).
    expect(attempt.evaluation.measure).toContain('aplicação')
  })

  it('não frear reprova por ausência de dado, não por valor ruim', () => {
    const flat: TelemetrySample[] = Array.from({ length: 50 }, (_, i) => ({
      timestamp: EPOCH + i * 10,
      brake: 0,
      throttle: 0,
      steering: 0,
    }))
    const session = runBlock(progressiva, [flat])

    const attempt = session.result().attempts[0]!
    expect(attempt.evaluation.met).toBe(false)
    // A distinção que permite dizer "você não freou" em vez de "frenagem lenta".
    expect(attempt.evaluation.observed).toBeNull()
  })

  it('sustentar o freio na faixa cumpre o critério do exercício 1', () => {
    const trace = brakingTrace({ peak: 35, riseMs: 200, holdMs: 2600, fallMs: 300 })
    const session = runBlock(controlePedal, [trace])

    const attempt = session.result().attempts[0]!
    expect(attempt.evaluation.met).toBe(true)
  })

  it('marcador de ponto de frenagem alimenta o atraso de reação', () => {
    const pontoFrenagem = findExercise('fund-06-ponto-frenagem')!
    // Traço com 300ms parado antes da frenagem começar; marcador em t=0.
    const trace = brakingTrace({
      peak: 80,
      riseMs: 200,
      holdMs: 200,
      fallMs: 300,
      leadInMs: 300,
    })

    const session = runBlock(pontoFrenagem, [trace], { markerOffsetMs: 0 })
    const attempt = session.result().attempts[0]!

    expect(attempt.exerciseMetrics.reactionDeltaMs).not.toBeNull()
    expect(attempt.exerciseMetrics.reactionDeltaMs!).toBeGreaterThan(0)
    expect(attempt.evaluation.met).toBe(true)
  })
})

describe('ExerciseSession — critério de bloco (exercício 5)', () => {
  const consistencia = findExercise('fund-05-consistencia')!

  it('tentativas iguais cumprem o critério de consistência do bloco', () => {
    const identical = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 85, riseMs: 250, holdMs: 300, fallMs: 400 }),
    )
    const result = runBlock(consistencia, identical).result()

    expect(result.attempts.every((a) => a.evaluation.met)).toBe(true)
  })

  it('tentativas dispersas reprovam o bloco', () => {
    const scattered = [
      brakingTrace({ peak: 40, riseMs: 100, holdMs: 100, fallMs: 150 }),
      brakingTrace({ peak: 95, riseMs: 700, holdMs: 400, fallMs: 900 }),
      brakingTrace({ peak: 60, riseMs: 150, holdMs: 500, fallMs: 200 }),
      brakingTrace({ peak: 100, riseMs: 900, holdMs: 100, fallMs: 1200 }),
      brakingTrace({ peak: 35, riseMs: 80, holdMs: 50, fallMs: 90 }),
    ]
    const result = runBlock(consistencia, scattered).result()

    expect(result.attempts.every((a) => !a.evaluation.met)).toBe(true)
  })

  it('reavalia com o bloco completo, não com o que a tentativa 1 conhecia', () => {
    // Durante a captura, a primeira tentativa só conhecia a si mesma e não tinha
    // como responder uma pergunta sobre repetição.
    const identical = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 85, riseMs: 250, holdMs: 300, fallMs: 400 }),
    )
    const result = runBlock(consistencia, identical).result()

    expect(result.attempts[0]!.evaluation.met).toBe(true)
    expect(result.attempts[0]!.evaluation.observed).toBeCloseTo(0, 5)
  })
})

describe('ExerciseSession → progressão', () => {
  it('um bloco bem executado alimenta a avaliação de domínio', () => {
    // Fecha o ciclo: Telemetry → Training → progressão, sem hardware.
    const traces = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 35, riseMs: 200, holdMs: 2600, fallMs: 300 }),
    )
    const result = runBlock(controlePedal, traces).result()

    expect(result.records).toHaveLength(5)
    expect(result.records.every((r) => r.criterionMet)).toBe(true)
    expect(evaluateMastery(controlePedal, result.records).mastered).toBe(true)
  })

  it('um bloco fraco não domina o exercício', () => {
    const traces = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 10, riseMs: 200, holdMs: 300, fallMs: 300 }),
    )
    const result = runBlock(controlePedal, traces).result()

    expect(result.records.every((r) => !r.criterionMet)).toBe(true)
    expect(evaluateMastery(controlePedal, result.records).mastered).toBe(false)
  })
})
