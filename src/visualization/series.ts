/**
 * Transformação de amostras brutas em séries de gráfico (RF-701 a RF-703).
 *
 * **Onde esta camada para:** entrega dados alinhados no tempo, prontos para um
 * componente de gráfico plotar. Cor, tipografia, layout e estilo são da
 * `simulator-ui-design`. Por isso nada aqui importa `uPlot` — a biblioteca de
 * renderização entra com a UI, não com a transformação dos dados.
 */

import type { StoredSample } from '../persistence/types.js'

/**
 * Séries em formato de colunas paralelas: `tMs[i]` corresponde a `brake[i]`,
 * `throttle[i]` e `steering[i]`.
 *
 * É o formato que bibliotecas de gráfico de linha consomem diretamente, sem
 * precisar re-mapear um array de objetos ponto a ponto a cada render.
 */
export interface ChartSeries {
  attemptId: number | string
  /** Milissegundos desde a **primeira amostra da tentativa**. */
  tMs: number[]
  brake: number[]
  throttle: number[]
  steering: number[]
}

/**
 * RF-701/702/703 — a mesma transformação para os três canais.
 *
 * O tempo é relativizado ao início da tentativa: timestamp de epoch não tem
 * utilidade nenhuma para o piloto olhando um gráfico.
 *
 * TC-701 exige fidelidade 1:1 com o bruto — nenhuma interpolação, suavização ou
 * reamostragem acontece aqui, nem como otimização. Com `uPlot` nas taxas deste
 * projeto não há necessidade disso; se um dia houver, precisa ser uma opção
 * explícita, nunca o comportamento padrão.
 */
export function toChartSeries(
  attemptId: number | string,
  samples: readonly StoredSample[],
): ChartSeries {
  const first = samples[0]
  const series: ChartSeries = {
    attemptId,
    tMs: [],
    brake: [],
    throttle: [],
    steering: [],
  }
  if (!first) return series

  for (const sample of samples) {
    series.tMs.push(sample.timestamp - first.timestamp)
    series.brake.push(sample.brake)
    series.throttle.push(sample.throttle)
    series.steering.push(sample.steering)
  }
  return series
}

export type Channel = 'brake' | 'throttle' | 'steering'

/** Extrai um par `(x, y)` de um canal — o que um gráfico de linha única precisa. */
export function channelPair(series: ChartSeries, channel: Channel): [number[], number[]] {
  return [series.tMs, series[channel]]
}
