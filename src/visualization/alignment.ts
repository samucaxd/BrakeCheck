/**
 * Alinhamento temporal entre tentativas (RF-704, RF-707).
 *
 * Duas tentativas quase nunca têm a mesma duração nem o mesmo tempo de
 * preparação antes da frenagem começar. Sobrepor pelo tempo relativo ao início
 * da tentativa alinharia coisas erradas: o piloto que demorou 2s para começar a
 * frear teria a frenagem inteira deslocada em relação à do dia em que começou
 * na hora.
 *
 * A referência é o **início do primeiro evento de frenagem** — o mesmo conceito
 * já definido em `telemetry-engine` §2. É o instante que importa comparar.
 *
 * O mesmo alinhamento serve ao gráfico estático (RF-704) e ao replay lado a lado
 * (RF-707): é o mesmo problema, e resolvê-lo duas vezes de formas diferentes
 * faria a UI mostrar uma coisa no gráfico e outra no replay.
 */

import type { DerivedMetrics } from '../telemetry/types.js'
import type { ChartSeries } from './series.js'

export interface AlignedSeries extends ChartSeries {
  /** Deslocamento aplicado, em ms. */
  offsetMs: number
  /** `tMs[i] − offsetMs`. Negativo antes do início da frenagem. */
  tAligned: number[]
}

/**
 * Deslocamento de alinhamento de uma tentativa.
 *
 * Sem evento de frenagem detectado (a tentativa em que o piloto não freou),
 * devolve 0 — alinha pelo início bruto da tentativa. É um fallback declarado na
 * skill §3, e continua sendo escolha razoável e não validada contra um caso
 * real: uma tentativa sem frenagem não tem instante de interesse a alinhar.
 */
export function alignmentOffset(metrics: DerivedMetrics): number {
  return metrics.brakingEvents[0]?.startMs ?? 0
}

export function alignSeries(series: ChartSeries, offsetMs: number): AlignedSeries {
  return {
    ...series,
    offsetMs,
    tAligned: series.tMs.map((t) => t - offsetMs),
  }
}

export interface OverlayInput {
  series: ChartSeries
  metrics: DerivedMetrics
}

export interface Overlay {
  series: AlignedSeries[]
  /** Extremos do eixo de tempo alinhado, cobrindo todas as séries. */
  domain: { minMs: number; maxMs: number }
}

/**
 * RF-704 — prepara N tentativas para sobreposição no mesmo eixo.
 *
 * O domínio devolvido cobre todas as séries para que a UI use **um** eixo
 * comum: deixar cada série escalar o próprio eixo faria duas frenagens de
 * durações diferentes parecerem iguais, que é o oposto do que a comparação
 * deveria mostrar.
 */
export function buildOverlay(inputs: readonly OverlayInput[]): Overlay {
  const series = inputs.map((input) =>
    alignSeries(input.series, alignmentOffset(input.metrics)),
  )

  let minMs = Infinity
  let maxMs = -Infinity
  for (const entry of series) {
    const first = entry.tAligned[0]
    const last = entry.tAligned[entry.tAligned.length - 1]
    if (first === undefined || last === undefined) continue
    minMs = Math.min(minMs, first)
    maxMs = Math.max(maxMs, last)
  }

  return {
    series,
    domain: Number.isFinite(minMs) ? { minMs, maxMs } : { minMs: 0, maxMs: 0 },
  }
}
