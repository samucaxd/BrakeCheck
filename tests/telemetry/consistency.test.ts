/**
 * RF-209 — consistência entre tentativas. Cobre TC-205 e TC-206 do PRD §10.2.
 */

import { describe, expect, it } from 'vitest'

import { AttemptRecorder } from '../../src/telemetry/attempt-recorder.js'
import { computeConsistency } from '../../src/telemetry/consistency.js'
import type { DerivedMetrics } from '../../src/telemetry/types.js'

const EPOCH = 1_700_000_000_000

/**
 * Uma tentativa com uma frenagem trapezoidal: sobe até `peak` em `riseMs`,
 * segura, e solta em `fallMs`. Amostrada a 100 Hz, como o sampler real.
 */
function attempt(peak: number, riseMs: number, holdMs: number, fallMs: number): DerivedMetrics {
  const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
  const step = 10
  let t = 0

  const push = (brake: number) => {
    recorder.add({ timestamp: EPOCH + t, brake, throttle: 0, steering: 0 })
    t += step
  }

  push(0)
  for (let elapsed = step; elapsed <= riseMs; elapsed += step) {
    push((elapsed / riseMs) * peak)
  }
  for (let elapsed = 0; elapsed < holdMs; elapsed += step) push(peak)
  for (let elapsed = step; elapsed <= fallMs; elapsed += step) {
    push(peak * (1 - elapsed / fallMs))
  }
  push(0)

  return recorder.finish().derivedMetrics
}

describe('computeConsistency (RF-209)', () => {
  it('TC-205: tentativas praticamente idênticas → baixa variabilidade', () => {
    const attempts = [
      attempt(90, 200, 300, 400),
      attempt(90, 200, 300, 400),
      attempt(91, 200, 300, 400),
      attempt(90, 210, 300, 400),
      attempt(89, 200, 300, 410),
    ]

    const report = computeConsistency(attempts)

    expect(report.attemptCount).toBe(5)
    for (const key of ['applicationSpeed', 'releaseSpeed', 'peakValue'] as const) {
      const stat = report.byMetric[key]
      expect(stat, key).toBeDefined()
      expect(stat!.coefficientOfVariation, key).not.toBeNull()
      expect(stat!.coefficientOfVariation!, key).toBeLessThan(0.1)
    }
  })

  it('TC-206: tentativas muito diferentes → alta variabilidade', () => {
    const attempts = [
      attempt(40, 100, 100, 100),
      attempt(95, 600, 300, 800),
      attempt(60, 150, 500, 200),
      attempt(100, 900, 100, 1200),
      attempt(35, 80, 50, 90),
    ]

    const report = computeConsistency(attempts)
    const stat = report.byMetric.applicationSpeed

    expect(stat).toBeDefined()
    expect(stat!.coefficientOfVariation!).toBeGreaterThan(0.3)
  })

  it('as duas situações são distinguíveis pelo número, não só pelo olho', () => {
    // O ponto do par TC-205/TC-206: a métrica precisa separar os dois casos com
    // folga, senão não serve para decidir avanço de nível (RN-03).
    const consistent = computeConsistency([
      attempt(90, 200, 300, 400),
      attempt(90, 200, 300, 400),
      attempt(90, 205, 300, 400),
    ]).byMetric.applicationSpeed!.coefficientOfVariation!

    const erratic = computeConsistency([
      attempt(40, 100, 100, 100),
      attempt(95, 700, 300, 900),
      attempt(60, 150, 500, 200),
    ]).byMetric.applicationSpeed!.coefficientOfVariation!

    expect(erratic).toBeGreaterThan(consistent * 5)
  })

  it('desvio amostral usa n−1', () => {
    const stat = computeConsistency(
      [attempt(80, 200, 200, 200), attempt(40, 200, 200, 200)],
      ['peakValue'],
    ).byMetric.peakValue!

    expect(stat.sampleCount).toBe(2)
    expect(stat.mean).toBeCloseTo(60, 6)
    // Amostral (n−1): |80−40| / √2 ≈ 28.28. Populacional daria 20.
    expect(stat.stddev!).toBeCloseTo(28.284, 2)
  })

  it('uma única tentativa não estima variabilidade', () => {
    // Zero significaria "perfeitamente consistente", que é exatamente a
    // conclusão que uma tentativa só não autoriza (RN-03).
    const stat = computeConsistency([attempt(80, 200, 200, 200)], ['peakValue'])
      .byMetric.peakValue!

    expect(stat.sampleCount).toBe(1)
    expect(stat.stddev).toBeNull()
    expect(stat.coefficientOfVariation).toBeNull()
  })

  it('lista vazia devolve relatório vazio, sem lançar', () => {
    const report = computeConsistency([])
    expect(report.attemptCount).toBe(0)
    expect(report.byMetric).toEqual({})
  })

  it('exclui tentativas sem a métrica em vez de contá-las como zero', () => {
    // Uma tentativa em que o piloto não freou não é uma frenagem inconsistente,
    // é ausência de dado — entrar como 0 inventaria variabilidade.
    const noBraking = new AttemptRecorder({ rawSamplesRef: 'x' })
    noBraking.add({ timestamp: EPOCH, brake: 0, throttle: 0, steering: 0 })
    noBraking.add({ timestamp: EPOCH + 100, brake: 0, throttle: 0, steering: 0 })

    const report = computeConsistency(
      [attempt(80, 200, 200, 200), noBraking.finish().derivedMetrics, attempt(80, 200, 200, 200)],
      ['peakValue'],
    )

    expect(report.attemptCount).toBe(3)
    expect(report.byMetric.peakValue!.sampleCount).toBe(2)
    expect(report.byMetric.peakValue!.coefficientOfVariation).toBeCloseTo(0, 6)
  })

  it('média zero não vira divisão por zero', () => {
    const zeroed: DerivedMetrics[] = [0, 0, 0].map(() => ({
      ...attempt(80, 200, 200, 200),
      brakingAggregate: {
        eventCount: 1,
        peakValue: 0,
        timeToPeakMs: 0,
        applicationSpeedPctPerS: 0,
        releaseSpeedPctPerS: 0,
      },
    }))

    const stat = computeConsistency(zeroed, ['peakValue']).byMetric.peakValue!
    expect(stat.mean).toBe(0)
    expect(stat.coefficientOfVariation).toBeNull()
  })
})
