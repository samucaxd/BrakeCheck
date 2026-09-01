/**
 * Cenários do PRD §10.2 (Telemetry Engine).
 *
 * Os gabaritos são construídos amostra a amostra, com números escolhidos para
 * que o valor esperado seja conferível de cabeça — o objetivo é que uma fórmula
 * errada apareça como um número errado óbvio, não como um decimal plausível.
 */

import { describe, expect, it } from 'vitest'

import { AttemptRecorder } from '../../src/telemetry/attempt-recorder.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'

const EPOCH = 1_700_000_000_000

/** `[relMs, brake, throttle?, steering?]` → série com timestamps de epoch. */
type Point = readonly [number, number, number?, number?]

function trace(points: readonly Point[]): TelemetrySample[] {
  return points.map(([relMs, brake, throttle = 0, steering = 0]) => ({
    timestamp: EPOCH + relMs,
    brake,
    throttle,
    steering,
  }))
}

function record(
  samples: readonly TelemetrySample[],
  options: Partial<ConstructorParameters<typeof AttemptRecorder>[0]> = {},
) {
  const recorder = new AttemptRecorder({ rawSamplesRef: 'test-ref', ...options })
  for (const sample of samples) recorder.add(sample)
  return recorder.finish()
}

describe('AttemptRecorder — gabarito de frenagem (TC-201)', () => {
  // Subida 50→100 em 100ms  → 500 %/s
  // Descida 100→0 em 200ms  → 500 %/s
  const gabarito = trace([
    [0, 0],
    [100, 0],
    [200, 50],
    [300, 100],
    [400, 50],
    [500, 0],
  ])

  it('RF-202: duração é o intervalo entre a primeira e a última amostra', () => {
    expect(record(gabarito).derivedMetrics.durationMs).toBe(500)
  })

  it('RF-203: mín/máx por canal', () => {
    const { brake, throttle, steering } = record(gabarito).derivedMetrics
    expect(brake).toEqual({ min: 0, max: 100 })
    expect(throttle).toEqual({ min: 0, max: 0 })
    expect(steering).toEqual({ min: 0, max: 0 })
  })

  it('RF-204/205/207: velocidades e tempo até o pico batem com o esperado', () => {
    const { brakingEvents } = record(gabarito).derivedMetrics

    expect(brakingEvents).toHaveLength(1)
    const event = brakingEvents[0]!

    expect(event.startMs).toBe(200)
    expect(event.peakMs).toBe(300)
    expect(event.endMs).toBe(500)
    expect(event.peakValue).toBe(100)
    expect(event.timeToPeakMs).toBe(100)
    expect(event.applicationSpeedPctPerS).toBeCloseTo(500, 6)
    expect(event.releaseSpeedPctPerS).toBeCloseTo(500, 6)
    expect(event.truncated).toBe(false)
  })

  it('tempos dos eventos são relativos ao início da tentativa, não epoch', () => {
    // Resolve a pergunta deixada aberta em `g29-input-layer` §7: a amostra
    // carrega epoch, esta camada deriva o tempo relativo.
    const event = record(gabarito).derivedMetrics.brakingEvents[0]!
    expect(event.startMs).toBeLessThan(1000)
  })

  it('RF-210: métricas referenciam a série bruta, não a duplicam', () => {
    const result = record(gabarito)
    expect(result.rawSamplesRef).toBe('test-ref')
    expect(JSON.stringify(result)).not.toContain(String(EPOCH))
  })

  it('repassa a série bruta ao sink sem retê-la', () => {
    const forwarded: TelemetrySample[] = []
    record(gabarito, { onSample: (s) => forwarded.push(s) })
    expect(forwarded).toHaveLength(gabarito.length)
  })
})

describe('AttemptRecorder — eventos de frenagem', () => {
  it('detecta múltiplos eventos numa mesma tentativa', () => {
    const samples = trace([
      [0, 0],
      [100, 60],
      [200, 0],
      [300, 0],
      [400, 80],
      [500, 0],
    ])

    const { brakingEvents, brakingAggregate } = record(samples).derivedMetrics

    expect(brakingEvents).toHaveLength(2)
    expect(brakingEvents[0]!.peakValue).toBe(60)
    expect(brakingEvents[1]!.peakValue).toBe(80)
    // Agregação padrão entre eventos é a média simples (`telemetry-engine` §2).
    expect(brakingAggregate.eventCount).toBe(2)
    expect(brakingAggregate.peakValue).toBe(70)
  })

  it('ignora ruído residual abaixo do limiar', () => {
    // Com deadzone de 2% pode sobrar resíduo; o limiar de 5% existe justamente
    // para que isso não vire um evento de frenagem fantasma.
    const samples = trace([
      [0, 0],
      [100, 3],
      [200, 4],
      [300, 0],
    ])
    expect(record(samples).derivedMetrics.brakingEvents).toHaveLength(0)
  })

  it('marca como truncado o evento que a captura interrompeu', () => {
    // A tentativa acaba com o pedal ainda pisado: a "liberação" medida é o fim
    // da captura, não a técnica do piloto. Quem pontua precisa poder distinguir.
    const samples = trace([
      [0, 0],
      [100, 50],
      [200, 90],
    ])

    const event = record(samples).derivedMetrics.brakingEvents[0]!
    expect(event.truncated).toBe(true)
    expect(event.endMs).toBe(200)
  })

  it('abre evento quando a tentativa já começa com o pedal pressionado', () => {
    const samples = trace([
      [0, 70],
      [100, 90],
      [200, 0],
    ])

    const events = record(samples).derivedMetrics.brakingEvents
    expect(events).toHaveLength(1)
    expect(events[0]!.startValue).toBe(70)
  })
})

describe('AttemptRecorder — overlap brake × throttle (TC-202)', () => {
  it('detecta e quantifica a sobreposição', () => {
    const samples = trace([
      [0, 0, 0],
      [100, 50, 50],
      [200, 50, 50],
      [300, 50, 0],
    ])

    const { overlap } = record(samples).derivedMetrics

    // Dois intervalos de 100ms com ambos os pedais acima do limiar.
    expect(overlap.durationMs).toBe(200)
    expect(overlap.pctOfDuration).toBeCloseTo(66.667, 2)
  })

  it('não acusa overlap quando só um pedal está acima do limiar', () => {
    const samples = trace([
      [0, 0, 0],
      [100, 80, 0],
      [200, 0, 80],
      [300, 0, 0],
    ])
    expect(record(samples).derivedMetrics.overlap.durationMs).toBe(0)
  })
})

describe('AttemptRecorder — tempo em faixa de pressão (RF-206)', () => {
  it('soma apenas os intervalos dentro da faixa', () => {
    const samples = trace([
      [0, 0],
      [100, 75],
      [200, 80],
      [300, 90],
      [400, 0],
    ])

    const { timeInPressureRange } = record(samples, {
      pressureBand: [70, 85],
    }).derivedMetrics

    expect(timeInPressureRange).not.toBeNull()
    expect(timeInPressureRange!.band).toEqual([70, 85])
    // Intervalos que começam em 75 e 80 contam; o que começa em 90, não.
    expect(timeInPressureRange!.durationMs).toBe(200)
  })

  it('sai null quando o exercício não define faixa', () => {
    // Uma faixa default seria um número sem significado para o exercício.
    const samples = trace([[0, 0], [100, 75]])
    expect(record(samples).derivedMetrics.timeInPressureRange).toBeNull()
  })
})

describe('AttemptRecorder — casos de borda (TC-203)', () => {
  it('tentativa sem nenhuma amostra não lança nem gera métrica inválida', () => {
    const result = record([])
    const m = result.derivedMetrics

    expect(m.durationMs).toBe(0)
    expect(m.sampleCount).toBe(0)
    expect(m.brake).toEqual({ min: null, max: null })
    expect(m.brakingEvents).toEqual([])
    expect(m.brakingAggregate.peakValue).toBeNull()
    expect(m.overlap.pctOfDuration).toBeNull()
  })

  it('tentativa de uma única amostra não divide por zero', () => {
    const m = record(trace([[0, 90]])).derivedMetrics

    expect(m.durationMs).toBe(0)
    expect(m.overlap.pctOfDuration).toBeNull()
    const event = m.brakingEvents[0]!
    // Subida e descida em intervalo zero: null, nunca Infinity — Infinity
    // vazaria para o scoring como técnica excepcional.
    expect(event.applicationSpeedPctPerS).toBeNull()
    expect(event.releaseSpeedPctPerS).toBeNull()
    expect(Number.isFinite(event.timeToPeakMs)).toBe(true)
  })

  it('amostras com timestamp repetido não quebram os acumuladores', () => {
    const samples = trace([
      [0, 0],
      [0, 50],
      [0, 90],
    ])
    const m = record(samples, { pressureBand: [70, 85] }).derivedMetrics

    expect(m.durationMs).toBe(0)
    expect(m.timeInPressureRange!.durationMs).toBe(0)
    expect(m.overlap.durationMs).toBe(0)
  })

  it('usar o recorder depois de finish() é erro explícito', () => {
    const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
    recorder.finish()
    expect(() => recorder.add({ timestamp: 0, brake: 0, throttle: 0, steering: 0 })).toThrow()
  })
})

describe('AttemptRecorder — sessão longa (TC-204)', () => {
  it('processa 1h a 100 Hz sem acumular a série', () => {
    // 360 mil amostras. O modo realista de falhar aqui é acidentalmente virar
    // O(n²) ou reter uma amostra por entrada; os dois aparecem neste teste.
    const recorder = new AttemptRecorder({ rawSamplesRef: 'long' })
    const totalSamples = 360_000

    const startedAt = Date.now()
    for (let i = 0; i < totalSamples; i++) {
      // Uma frenagem a cada 1000 amostras (10s), com pico bem definido.
      const phase = i % 1000
      const brake = phase < 100 ? phase : phase < 200 ? 200 - phase : 0
      recorder.add({ timestamp: EPOCH + i * 10, brake, throttle: 0, steering: 0 })
    }
    const result = recorder.finish()
    const elapsedMs = Date.now() - startedAt

    expect(result.derivedMetrics.sampleCount).toBe(totalSamples)
    expect(result.derivedMetrics.durationMs).toBe((totalSamples - 1) * 10)
    // 360 frenagens retidas contra 360 mil amostras processadas: o que fica em
    // memória é proporcional aos eventos, não às amostras.
    expect(result.derivedMetrics.brakingEvents).toHaveLength(360)
    expect(elapsedMs).toBeLessThan(10_000)
  })
})
