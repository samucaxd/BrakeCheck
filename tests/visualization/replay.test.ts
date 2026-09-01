/**
 * Replay — RF-706, RF-707, e TC-703/TC-704 do PRD §10.7.
 *
 * A reprodução é testada com relógio falso: o que importa verificar é que o
 * intervalo entre quadros bate com o delta **real** das amostras, e não com um
 * intervalo fixo. Com relógio de verdade isso viraria um teste de tolerância a
 * jitter do runner, que é outra coisa.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttemptRecorder } from '../../src/telemetry/attempt-recorder.js'
import type { StoredSample } from '../../src/persistence/types.js'
import type { DerivedMetrics } from '../../src/telemetry/types.js'
import {
  ReplayPlayer,
  buildComparisonTimeline,
  buildTimeline,
} from '../../src/visualization/replay.js'
import type { AttemptFrame } from '../../src/visualization/replay.js'
import { brakingTrace } from '../helpers/traces.js'

function attempt(options: Parameters<typeof brakingTrace>[0]): {
  samples: StoredSample[]
  metrics: DerivedMetrics
} {
  const samples = brakingTrace(options)
  const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
  for (const sample of samples) recorder.add(sample)
  return { samples, metrics: recorder.finish().derivedMetrics }
}

/** Traço com deltas irregulares de propósito, para o teste de jitter. */
function irregularAttempt(): { samples: StoredSample[]; metrics: DerivedMetrics } {
  const gaps = [0, 10, 35, 12, 8, 60, 10, 10]
  let t = 1_700_000_000_000
  const brakes = [0, 0, 40, 80, 90, 60, 20, 0]
  const samples: StoredSample[] = gaps.map((gap, i) => {
    t += gap
    return { timestamp: t, brake: brakes[i]!, throttle: 0, steering: 0 }
  })

  const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
  for (const sample of samples) recorder.add(sample)
  return { samples, metrics: recorder.finish().derivedMetrics }
}

describe('buildTimeline', () => {
  it('coloca o início da frenagem em zero', () => {
    const source = attempt({ peak: 80, riseMs: 200, holdMs: 200, fallMs: 300, leadInMs: 500 })
    const timeline = buildTimeline(source)

    expect(timeline).toHaveLength(source.samples.length)
    expect(timeline[0]!.tAligned).toBeLessThan(0) // antes da frenagem
    expect(timeline.some((cue) => cue.tAligned === 0)).toBe(true)
  })

  it('série vazia devolve linha do tempo vazia', () => {
    const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
    expect(buildTimeline({ samples: [], metrics: recorder.finish().derivedMetrics })).toEqual([])
  })
})

describe('ReplayPlayer (RF-706, TC-703)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('TC-703: reproduz na ordem e no timing originais', async () => {
    const source = irregularAttempt()
    const timeline = buildTimeline(source)

    const emitted: { at: number; brake: number }[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: timeline,
      onFrame: (payload) => {
        emitted.push({ at: Date.now(), brake: payload.sample.brake })
      },
    })

    const startedAt = Date.now()
    player.play()
    await vi.advanceTimersByTimeAsync(500)

    expect(emitted).toHaveLength(source.samples.length)
    // Ordem preservada.
    expect(emitted.map((e) => e.brake)).toEqual(source.samples.map((s) => s.brake))

    // E o intervalo entre quadros bate com o delta REAL das amostras — não com
    // um intervalo fixo, que é o que o cenário existe para descartar.
    for (let i = 1; i < emitted.length; i++) {
      const realDelta = source.samples[i]!.timestamp - source.samples[i - 1]!.timestamp
      const replayDelta = emitted[i]!.at - emitted[i - 1]!.at
      expect(replayDelta, `quadro ${i}`).toBe(realDelta)
    }
    expect(emitted[0]!.at - startedAt).toBe(0)
  })

  it('o jitter da captura aparece no replay em vez de ser suavizado', () => {
    const source = irregularAttempt()
    const timeline = buildTimeline(source)
    const deltas = timeline.slice(1).map((cue, i) => cue.tAligned - timeline[i]!.tAligned)

    // Se algum código tivesse "normalizado" a taxa, todos os deltas seriam
    // iguais. O replay reflete o que aconteceu.
    expect(new Set(deltas).size).toBeGreaterThan(1)
  })

  it('avisa quando termina', async () => {
    const source = attempt({ peak: 80, riseMs: 100, holdMs: 50, fallMs: 100 })
    let ended = false
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildTimeline(source),
      onFrame: () => {},
      onEnd: () => {
        ended = true
      },
    })

    player.play()
    await vi.advanceTimersByTimeAsync(1000)

    expect(ended).toBe(true)
    expect(player.finished).toBe(true)
    expect(player.playing).toBe(false)
  })

  it('pausar interrompe a emissão e retomar continua de onde parou', async () => {
    const source = attempt({ peak: 80, riseMs: 200, holdMs: 200, fallMs: 200 })
    const emitted: number[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildTimeline(source),
      onFrame: (payload) => emitted.push(payload.index),
    })

    player.play()
    await vi.advanceTimersByTimeAsync(100)
    const beforePause = emitted.length
    expect(beforePause).toBeGreaterThan(0)

    player.pause()
    await vi.advanceTimersByTimeAsync(500)
    expect(emitted.length).toBe(beforePause)
    expect(player.playing).toBe(false)

    player.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(emitted.length).toBeGreaterThan(beforePause)
    // Sem repetir quadros já emitidos.
    expect(new Set(emitted).size).toBe(emitted.length)
  })

  it('stop volta ao início', async () => {
    const source = attempt({ peak: 80, riseMs: 200, holdMs: 100, fallMs: 200 })
    const emitted: number[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildTimeline(source),
      onFrame: (payload) => emitted.push(payload.index),
    })

    player.play()
    await vi.advanceTimersByTimeAsync(150)
    player.stop()
    const afterStop = emitted.length

    player.play()
    await vi.advanceTimersByTimeAsync(2000)
    // Reproduziu tudo de novo desde o começo.
    expect(emitted.length).toBe(afterStop + source.samples.length)
    expect(emitted[afterStop]).toBe(0)
  })

  it('seek adianta sem reproduzir os quadros já passados', async () => {
    const source = attempt({ peak: 80, riseMs: 300, holdMs: 300, fallMs: 300 })
    const emitted: number[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildTimeline(source),
      onFrame: (payload) => emitted.push(payload.index),
    })

    player.seek(400)
    player.play()
    await vi.advanceTimersByTimeAsync(2000)

    // Mostrar a tentativa fora de ordem ao buscar adiante seria pior que não
    // mostrar nada.
    expect(emitted[0]!).toBeGreaterThan(0)
    expect(emitted).toEqual([...emitted].sort((a, b) => a - b))
  })

  it('velocidade reduzida estica o tempo sem alterar a ordem', async () => {
    const source = irregularAttempt()
    const emitted: { at: number; index: number }[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildTimeline(source),
      onFrame: (payload) => emitted.push({ at: Date.now(), index: payload.index }),
      speed: 0.5,
    })

    player.play()
    await vi.advanceTimersByTimeAsync(2000)

    expect(emitted.map((e) => e.index)).toEqual(source.samples.map((_, i) => i))
    for (let i = 1; i < emitted.length; i++) {
      const realDelta = source.samples[i]!.timestamp - source.samples[i - 1]!.timestamp
      expect(emitted[i]!.at - emitted[i - 1]!.at).toBe(realDelta * 2)
    }
  })

  it('linha do tempo vazia termina imediatamente', async () => {
    let ended = false
    const player = new ReplayPlayer<AttemptFrame>({
      cues: [],
      onFrame: () => {},
      onEnd: () => {
        ended = true
      },
    })

    player.play()
    await vi.advanceTimersByTimeAsync(10)
    expect(ended).toBe(true)
  })
})

describe('comparação A×B no replay (RF-707, TC-704)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('TC-704: durações diferentes ficam sincronizadas pelo instante da frenagem', () => {
    const a = attempt({ peak: 80, riseMs: 150, holdMs: 100, fallMs: 200 })
    const b = attempt({ peak: 80, riseMs: 600, holdMs: 700, fallMs: 800, leadInMs: 1000 })

    const timeline = buildComparisonTimeline(a, b)

    // Uma linha do tempo só, ordenada pelo relógio compartilhado.
    expect(timeline).toHaveLength(a.samples.length + b.samples.length)
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.tAligned).toBeGreaterThanOrEqual(timeline[i - 1]!.tAligned)
    }

    // O instante zero das duas é o início da frenagem de cada uma, apesar de a
    // segunda ter esperado mais de um segundo antes de frear.
    const zeroA = timeline.find((c) => c.tAligned === 0 && c.payload.side === 'a')
    const zeroB = timeline.find((c) => c.tAligned === 0 && c.payload.side === 'b')
    expect(zeroA).toBeDefined()
    expect(zeroB).toBeDefined()
    expect(zeroA!.payload.sample.brake).toBeGreaterThan(5)
    expect(zeroB!.payload.sample.brake).toBeGreaterThan(5)
  })

  it('as duas tentativas são emitidas sob um relógio compartilhado', async () => {
    const a = attempt({ peak: 80, riseMs: 150, holdMs: 100, fallMs: 200 })
    const b = attempt({ peak: 80, riseMs: 600, holdMs: 700, fallMs: 800, leadInMs: 1000 })

    const emitted: { side: 'a' | 'b'; tAligned: number }[] = []
    const player = new ReplayPlayer<AttemptFrame>({
      cues: buildComparisonTimeline(a, b),
      onFrame: (payload, tAligned) => emitted.push({ side: payload.side, tAligned }),
    })

    player.play()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(emitted.filter((e) => e.side === 'a')).toHaveLength(a.samples.length)
    expect(emitted.filter((e) => e.side === 'b')).toHaveLength(b.samples.length)
    // Monotônico: o relógio é um só, não dois independentes.
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]!.tAligned).toBeGreaterThanOrEqual(emitted[i - 1]!.tAligned)
    }
  })

  it('a mesma tentativa comparada consigo mesma fica perfeitamente sobreposta', () => {
    const source = attempt({ peak: 80, riseMs: 200, holdMs: 200, fallMs: 300 })
    const timeline = buildComparisonTimeline(source, source)

    // Cada instante aparece duas vezes, uma de cada lado, no mesmo tAligned.
    for (let i = 0; i < timeline.length; i += 2) {
      expect(timeline[i]!.tAligned).toBe(timeline[i + 1]!.tAligned)
      expect(new Set([timeline[i]!.payload.side, timeline[i + 1]!.payload.side])).toEqual(
        new Set(['a', 'b']),
      )
    }
  })
})
