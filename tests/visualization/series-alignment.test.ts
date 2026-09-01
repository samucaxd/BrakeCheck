/**
 * TC-701, TC-702 e TC-704 do PRD §10.7 — transformação, alinhamento e curva ideal.
 */

import { describe, expect, it } from 'vitest'

import { AttemptRecorder } from '../../src/telemetry/attempt-recorder.js'
import type { StoredSample } from '../../src/persistence/types.js'
import type { DerivedMetrics } from '../../src/telemetry/types.js'
import { findExercise } from '../../src/training/catalog.js'
import { alignSeries, alignmentOffset, buildOverlay } from '../../src/visualization/alignment.js'
import { clampCurve, idealCurveFor } from '../../src/visualization/ideal-curve.js'
import { channelPair, toChartSeries } from '../../src/visualization/series.js'
import { brakingTrace } from '../helpers/traces.js'

/** Traço + métricas, como sairiam do banco e da telemetria. */
function attempt(options: Parameters<typeof brakingTrace>[0]): {
  samples: StoredSample[]
  metrics: DerivedMetrics
} {
  const samples = brakingTrace(options)
  const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
  for (const sample of samples) recorder.add(sample)
  return { samples, metrics: recorder.finish().derivedMetrics }
}

describe('toChartSeries (RF-701 a RF-703, TC-701)', () => {
  it('TC-701: reflete os dados brutos 1:1, sem distorção de escala ou tempo', () => {
    const { samples } = attempt({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 })
    const series = toChartSeries(7291, samples)

    expect(series.tMs).toHaveLength(samples.length)
    expect(series.brake).toHaveLength(samples.length)
    // Nenhuma interpolação nem reamostragem: cada ponto é o ponto capturado.
    for (let i = 0; i < samples.length; i++) {
      expect(series.brake[i]).toBe(samples[i]!.brake)
      expect(series.throttle[i]).toBe(samples[i]!.throttle)
      expect(series.steering[i]).toBe(samples[i]!.steering)
    }
  })

  it('relativiza o tempo ao início da tentativa, não a epoch', () => {
    const { samples } = attempt({ peak: 80, riseMs: 100, holdMs: 100, fallMs: 100 })
    const series = toChartSeries(1, samples)

    expect(series.tMs[0]).toBe(0)
    expect(series.tMs[1]).toBe(10)
    // Epoch não tem utilidade nenhuma para o piloto olhando um gráfico.
    expect(series.tMs[series.tMs.length - 1]).toBeLessThan(10_000)
  })

  it('série vazia não quebra', () => {
    const series = toChartSeries(1, [])
    expect(series.tMs).toEqual([])
    expect(series.brake).toEqual([])
  })

  it('channelPair devolve o par (x, y) de um canal', () => {
    const { samples } = attempt({ peak: 80, riseMs: 100, holdMs: 100, fallMs: 100 })
    const series = toChartSeries(1, samples)

    const [x, y] = channelPair(series, 'brake')
    expect(x).toBe(series.tMs)
    expect(y).toBe(series.brake)
  })
})

describe('alinhamento temporal (RF-704, TC-704)', () => {
  it('usa o início do primeiro evento de frenagem como referência', () => {
    // 500ms parado antes de frear: sem alinhamento, esta tentativa apareceria
    // deslocada meio segundo em relação a uma que começou na hora.
    const { samples, metrics } = attempt({
      peak: 80,
      riseMs: 200,
      holdMs: 200,
      fallMs: 300,
      leadInMs: 500,
    })

    const offset = alignmentOffset(metrics)
    expect(offset).toBeGreaterThan(400)

    const aligned = alignSeries(toChartSeries(1, samples), offset)
    // O instante do início da frenagem cai exatamente em zero.
    const zeroIndex = aligned.tAligned.findIndex((t) => t === 0)
    expect(zeroIndex).toBeGreaterThan(0)
    expect(aligned.brake[zeroIndex]!).toBeGreaterThan(5)
  })

  it('TC-704: durações bem diferentes ficam comparáveis no eixo alinhado', () => {
    // Uma tentativa curta que começa logo; outra longa com muita espera antes.
    const curta = attempt({ peak: 80, riseMs: 150, holdMs: 100, fallMs: 200 })
    const longa = attempt({
      peak: 80,
      riseMs: 600,
      holdMs: 800,
      fallMs: 900,
      leadInMs: 1200,
    })

    const overlay = buildOverlay([
      { series: toChartSeries('curta', curta.samples), metrics: curta.metrics },
      { series: toChartSeries('longa', longa.samples), metrics: longa.metrics },
    ])

    expect(overlay.series).toHaveLength(2)
    // O início da frenagem das duas cai no mesmo ponto do eixo — que é o que
    // torna a comparação legítima apesar das durações diferentes.
    for (const series of overlay.series) {
      expect(series.tAligned).toContain(0)
    }
    // Sem alinhamento, os inícios estariam a mais de um segundo de distância.
    expect(Math.abs(overlay.series[0]!.offsetMs - overlay.series[1]!.offsetMs)).toBeGreaterThan(
      1000,
    )
  })

  it('o domínio cobre todas as séries, para a UI usar um eixo comum', () => {
    const curta = attempt({ peak: 80, riseMs: 150, holdMs: 100, fallMs: 200 })
    const longa = attempt({ peak: 80, riseMs: 600, holdMs: 800, fallMs: 900, leadInMs: 1200 })

    const overlay = buildOverlay([
      { series: toChartSeries('curta', curta.samples), metrics: curta.metrics },
      { series: toChartSeries('longa', longa.samples), metrics: longa.metrics },
    ])

    // Escalas independentes fariam duas frenagens de durações diferentes
    // parecerem iguais, que é o oposto do que a comparação deve mostrar.
    expect(overlay.domain.minMs).toBeLessThan(0)
    const maiorFim = Math.max(
      ...overlay.series.map((s) => s.tAligned[s.tAligned.length - 1]!),
    )
    expect(overlay.domain.maxMs).toBe(maiorFim)
  })

  it('tentativa sem frenagem cai no fallback de deslocamento zero', () => {
    const flat: StoredSample[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 10,
      brake: 0,
      throttle: 0,
      steering: 0,
    }))
    const recorder = new AttemptRecorder({ rawSamplesRef: 'x' })
    for (const sample of flat) recorder.add(sample)
    const metrics = recorder.finish().derivedMetrics

    expect(metrics.brakingEvents).toHaveLength(0)
    expect(alignmentOffset(metrics)).toBe(0)

    const aligned = alignSeries(toChartSeries(1, flat), alignmentOffset(metrics))
    expect(aligned.tAligned).toEqual(aligned.tMs)
  })

  it('overlay vazio devolve domínio neutro em vez de Infinity', () => {
    expect(buildOverlay([]).domain).toEqual({ minMs: 0, maxMs: 0 })
  })
})

describe('curva ideal (RF-705, TC-702)', () => {
  it('faixa-alvo sustentada vira linha reta no ponto médio', () => {
    const curve = idealCurveFor(findExercise('fund-01-controle-pedal')!)

    expect(curve.kind).toBe('curve')
    if (curve.kind !== 'curve') return
    // Faixa 30–40 → 35.
    expect(curve.points.every((p) => p.value === 35)).toBe(true)
    expect(curve.points[0]!.tAligned).toBe(0)
    expect(curve.points[1]!.tAligned).toBe(2500)
  })

  it('TC-702: a curva ideal usa o mesmo eixo alinhado da executada', () => {
    // O ponto do cenário é não haver deslocamento acidental entre as duas.
    const { samples, metrics } = attempt({
      peak: 35,
      riseMs: 200,
      holdMs: 2600,
      fallMs: 300,
      leadInMs: 400,
    })
    const aligned = alignSeries(toChartSeries(1, samples), alignmentOffset(metrics))
    const curve = idealCurveFor(findExercise('fund-01-controle-pedal')!)

    expect(curve.kind).toBe('curve')
    if (curve.kind !== 'curve') return
    // A curva começa em 0, e 0 na série executada é o início da frenagem.
    expect(curve.points[0]!.tAligned).toBe(0)
    expect(aligned.tAligned).toContain(0)
  })

  it('perfil-alvo explícito é usado como está, sem derivação', () => {
    const curve = idealCurveFor(findExercise('int-05-pressao-desaceleracao')!)

    expect(curve.kind).toBe('curve')
    if (curve.kind !== 'curve') return
    expect(curve.points).toEqual([
      { tAligned: 0, value: 90 },
      { tAligned: 1000, value: 60 },
      { tAligned: 2000, value: 30 },
    ])
  })

  it('sequência de faixas vira curva em degraus', () => {
    const curve = idealCurveFor(findExercise('int-03-modulacao-pedal')!)

    expect(curve.kind).toBe('curve')
    if (curve.kind !== 'curve') return
    // Três segmentos, dois pontos cada: 40% → 70% → 50%.
    expect(curve.points).toHaveLength(6)
    expect(curve.points[0]!.value).toBe(40)
    expect(curve.points[2]!.value).toBe(70)
    expect(curve.points[4]!.value).toBe(50)
  })

  it('critério de desvio de alvo único vira marcador, não curva', () => {
    const curve = idealCurveFor(findExercise('fund-06-ponto-frenagem')!)

    expect(curve.kind).toBe('marker')
    if (curve.kind !== 'marker') return
    expect(curve.tAligned).toBe(400)
    expect(curve.label).toContain('400ms')
  })

  it('critério de forma ou relação não inventa curva', () => {
    // Melhor não exibir nada do que exibir uma referência que o exercício não
    // define.
    for (const id of [
      'fund-02-aplicacao-progressiva',
      'fund-03-frenagem-linha-reta',
      'int-04-liberacao-progressiva',
      'adv-04-frenagem-rotacao',
    ]) {
      const curve = idealCurveFor(findExercise(id)!)
      expect(curve.kind, id).toBe('none')
      if (curve.kind !== 'none') continue
      expect(curve.reason.length, id).toBeGreaterThan(10)
    }
  })

  it('todo exercício do catálogo tem uma decisão explícita de curva', () => {
    for (const id of [
      'fund-01-controle-pedal',
      'fund-04-controle-pressao',
      'fund-05-consistencia',
      'int-01-threshold-braking',
      'int-02-frenagem-maxima',
      'adv-01-trail-braking',
      'adv-02-brake-release',
      'adv-03-transferencia-peso',
      'adv-05-combinacao-completa',
    ]) {
      const curve = idealCurveFor(findExercise(id)!)
      expect(['curve', 'marker', 'none'], id).toContain(curve.kind)
    }
  })

  it('clampCurve resolve o Infinity do threshold braking', () => {
    const curve = idealCurveFor(findExercise('int-01-threshold-braking')!)
    expect(curve.kind).toBe('curve')
    if (curve.kind !== 'curve') return
    expect(curve.points[1]!.tAligned).toBe(Number.POSITIVE_INFINITY)

    const clamped = clampCurve(curve, 1800)
    if (clamped.kind !== 'curve') return
    expect(clamped.points[1]!.tAligned).toBe(1800)
    expect(clamped.points[0]!.value).toBe(90) // faixa 85–95
  })

  it('clampCurve deixa marcador e ausência intactos', () => {
    const marker = idealCurveFor(findExercise('fund-06-ponto-frenagem')!)
    expect(clampCurve(marker, 100)).toBe(marker)
  })
})
