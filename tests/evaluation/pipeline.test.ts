/**
 * Integração das camadas 1→4: input normalizado → telemetria → exercício →
 * pontuação → progressão → Skill Profile.
 *
 * Existe por dois motivos. Primeiro, é o que fecha a lacuna que a camada 3
 * deixou aberta: a condição de avanço do exercício 2 exige `minScore`, e só
 * agora existe quem calcule score. Segundo, prova que as fronteiras entre
 * camadas encaixam de verdade — cada camada foi testada isolada até aqui.
 */

import { describe, expect, it } from 'vitest'

import { MockDeviceSource } from '../../src/device/mock-source.js'
import { InputProcessor } from '../../src/input/input-processor.js'
import { scoreAttempt } from '../../src/evaluation/score-attempt.js'
import { emptyProfile, updateProfile, weakestDimension } from '../../src/evaluation/skill-profile.js'
import type { ScoreResult } from '../../src/evaluation/types.js'
import { findExercise } from '../../src/training/catalog.js'
import { ExerciseSession } from '../../src/training/exercise-session.js'
import { evaluateAccess, evaluateMastery } from '../../src/training/progression.js'
import type { AttemptRecord } from '../../src/training/progression.js'
import type { Exercise } from '../../src/training/types.js'
import { brakingTrace } from '../helpers/traces.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'

const progressiva = findExercise('fund-02-aplicacao-progressiva')!

/** Roda um bloco completo e pontua cada tentativa. */
function runAndScore(
  exercise: Exercise,
  traces: readonly (readonly TelemetrySample[])[],
): { records: AttemptRecord[]; results: ScoreResult[] } {
  const session = new ExerciseSession({
    exercise,
    sessionId: 'sess-1',
    attempts: traces.length,
  })

  for (const trace of traces) {
    session.startCountdown()
    session.beginAttempt()
    for (const sample of trace) session.addSample(sample)
    session.endAttempt()
  }

  const block = session.result()
  const blockMetrics = block.attempts.map((a) => a.metrics)

  const results = block.attempts.map((attempt) =>
    scoreAttempt({
      attemptRef: attempt.rawSamplesRef,
      exercise,
      metrics: attempt.metrics,
      exerciseMetrics: attempt.exerciseMetrics,
      blockMetrics,
      blockExerciseMetrics: block.attempts.map((a) => a.exerciseMetrics),
    }),
  )

  const records = block.records.map((record, index) => ({
    ...record,
    score: results[index]!.totalScore,
  }))

  return { records, results }
}

describe('pipeline camada 1 → 2', () => {
  it('input bruto do dispositivo chega à telemetria como métrica derivada', () => {
    const source = new MockDeviceSource()
    const processor = new InputProcessor({ deadzones: { brake: 0, throttle: 0, steering: 0 } })

    // Bruto do G29: freio 0–1, volante 0–100 com 50 no centro.
    const sample = processor.process({ timestamp: 1000, brake: 0.75, throttle: 0, steering: 50 })

    expect(sample.brake).toBeCloseTo(75, 6)
    expect(sample.steering).toBe(0)
    expect(source.readState().steering).toBe(50)
  })
})

describe('pipeline camada 3 → 4 → progressão', () => {
  it('bloco bem executado pontua alto e libera o próximo exercício', () => {
    // ~80% em 300ms ≈ 265 %/s: dentro da faixa progressiva de 150–350.
    const traces = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }),
    )

    const { records, results } = runAndScore(progressiva, traces)

    expect(results.every((r) => r.totalScore === 100)).toBe(true)
    expect(results.every((r) => r.level === 'master')).toBe(true)

    // Agora a condição de avanço com minScore: 70 é verificável de ponta a ponta.
    expect(evaluateMastery(progressiva, records).mastered).toBe(true)

    // Para liberar o exercício 3, o 1 também precisa estar dominado — então ele
    // é executado de verdade, e não forjado: o exercício 1 mede tempo em faixa,
    // e um registro sem esse dado não deve (nem consegue) abrir o gate.
    const controlePedal = findExercise('fund-01-controle-pedal')!
    const holdTraces = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 35, riseMs: 200, holdMs: 2600, fallMs: 300 }),
    )
    const { records: holdRecords } = runAndScore(controlePedal, holdTraces)
    expect(evaluateMastery(controlePedal, holdRecords).mastered).toBe(true)

    const access = evaluateAccess(findExercise('fund-03-frenagem-linha-reta')!, [
      ...holdRecords,
      ...records,
    ])
    expect(access.reasons).toEqual([])
    expect(access.locked).toBe(false)
  })

  it('bloco com técnica abrupta pontua baixo e não libera', () => {
    // ~80% em 50ms ≈ 1500 %/s: "chute" no pedal em todas as tentativas.
    const traces = Array.from({ length: 5 }, () =>
      brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }),
    )

    const { records, results } = runAndScore(progressiva, traces)

    expect(results.every((r) => r.totalScore! < 70)).toBe(true)
    expect(records.every((r) => !r.criterionMet)).toBe(true)
    expect(evaluateMastery(progressiva, records).mastered).toBe(false)
  })

  it('TC-303 de ponta a ponta: acertar de formas diferentes não é domínio', () => {
    // Todas dentro da faixa de sucesso, mas com velocidades bem diferentes:
    // score alto em todas, e ainda assim sem domínio, por variabilidade.
    const traces = [
      brakingTrace({ peak: 50, riseMs: 300, holdMs: 200, fallMs: 400 }), // ~165 %/s
      brakingTrace({ peak: 100, riseMs: 300, holdMs: 200, fallMs: 400 }), // ~333 %/s
      brakingTrace({ peak: 55, riseMs: 300, holdMs: 200, fallMs: 400 }),
      brakingTrace({ peak: 100, riseMs: 310, holdMs: 200, fallMs: 400 }),
      brakingTrace({ peak: 52, riseMs: 300, holdMs: 200, fallMs: 400 }),
    ]

    const { records, results } = runAndScore(progressiva, traces)

    expect(results.every((r) => r.totalScore! >= 70)).toBe(true)
    expect(records.every((r) => r.criterionMet)).toBe(true)

    const mastery = evaluateMastery(progressiva, records)
    expect(mastery.mastered).toBe(false)
    expect(mastery.missing.some((m) => m.requirement.includes('consistência'))).toBe(true)
  })

  it('a sessão alimenta o Skill Profile e revela o ponto fraco', () => {
    const boas = Array.from({ length: 3 }, () =>
      brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }),
    )
    const ruins = Array.from({ length: 3 }, () =>
      brakingTrace({ peak: 90, riseMs: 300, holdMs: 200, fallMs: 60 }),
    )

    const aplicacao = runAndScore(progressiva, boas).results
    const liberacao = runAndScore(findExercise('int-04-liberacao-progressiva')!, ruins).results

    const profile = updateProfile(emptyProfile(), [...aplicacao, ...liberacao], 1000)

    expect(profile.current.brakeControl).toBe(100)
    expect(profile.current.brakeRelease!).toBeLessThan(100)
    expect(weakestDimension(profile)).toBe('brakeRelease')
    // RF-405: o ponto foi registrado, não só o valor corrente.
    expect(profile.history).toHaveLength(1)
  })
})
