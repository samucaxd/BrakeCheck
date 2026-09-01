/**
 * Telemetry Engine — schema das métricas derivadas (RF-210).
 *
 * Estrutura definida em `telemetry-engine` §4. Os nomes de campo aqui estão em
 * camelCase, e não no snake_case do exemplo JSON da skill, para ficarem
 * consistentes com o resto do código TypeScript (a camada 1 já usa camelCase em
 * `AxisCalibration`). É a mesma estrutura, com a mesma semântica — se a
 * `session-persistence` precisar do JSON no formato exato da skill, a conversão
 * é dela, na fronteira com o disco.
 *
 * **Onde esta camada para:** aqui saem métricas. Sub-scores e score agregado são
 * da `evaluation-scoring-engine`; gravar em disco é da `session-persistence`.
 */

/** Mín/máx de um canal ao longo da tentativa (RF-203). `null` = tentativa sem amostras. */
export interface ChannelStats {
  min: number | null
  max: number | null
}

/**
 * Um evento de frenagem dentro da tentativa (`telemetry-engine` §2).
 *
 * Todos os tempos são **relativos ao início da tentativa**, em ms. É aqui que
 * se resolve a pergunta deixada em aberto em `g29-input-layer` §7: a amostra
 * carrega timestamp de epoch, e é esta camada que deriva o tempo relativo.
 */
export interface BrakingEvent {
  /** Primeira amostra acima do limiar. */
  startMs: number
  /** Amostra de maior `brake` dentro do evento. */
  peakMs: number
  /** Primeira amostra após o pico abaixo do limiar, ou o fim da tentativa. */
  endMs: number
  /** Valor de `brake` na abertura do evento. */
  startValue: number
  /** Maior valor de `brake` no evento. */
  peakValue: number
  /** Valor de `brake` no fechamento do evento. */
  endValue: number
  /** RF-207 — tempo até a pressão máxima, em ms. */
  timeToPeakMs: number
  /** RF-204 — velocidade de aplicação, em %/s. `null` se pico e início coincidem. */
  applicationSpeedPctPerS: number | null
  /** RF-205 — velocidade de liberação, em %/s. `null` se fim e pico coincidem. */
  releaseSpeedPctPerS: number | null
  /**
   * `true` quando a tentativa acabou com o pedal ainda pressionado, então o
   * fechamento é o fim da tentativa e não uma liberação de verdade.
   *
   * Quem for pontuar precisa saber disso: a velocidade de liberação de um evento
   * truncado descreve onde a captura parou, não a técnica do piloto.
   */
  truncated: boolean
}

/** Agregação das métricas de evento da tentativa (`telemetry-engine` §2). */
export interface BrakingAggregate {
  eventCount: number
  /** Média entre eventos. `null` quando nenhum evento produziu o valor. */
  peakValue: number | null
  timeToPeakMs: number | null
  applicationSpeedPctPerS: number | null
  releaseSpeedPctPerS: number | null
}

/** RF-206 — tempo dentro de uma faixa de pressão definida pelo exercício. */
export interface PressureRangeMetric {
  /** Faixa `[low, high]` em % de curso, inclusiva nos dois extremos. */
  band: readonly [number, number]
  durationMs: number
}

/** RF-208 — sobreposição temporal entre freio e acelerador. */
export interface OverlapMetric {
  durationMs: number
  /** Fração da tentativa, em %. `null` quando a tentativa tem duração zero. */
  pctOfDuration: number | null
}

/** Conjunto completo de métricas derivadas de uma tentativa. */
export interface DerivedMetrics {
  /** RF-202 — duração da tentativa, em ms. */
  durationMs: number
  sampleCount: number
  /** RF-203 */
  brake: ChannelStats
  throttle: ChannelStats
  steering: ChannelStats
  /** RF-204, RF-205, RF-207 — por evento. */
  brakingEvents: BrakingEvent[]
  brakingAggregate: BrakingAggregate
  /** RF-206. `null` quando o exercício não define faixa de pressão. */
  timeInPressureRange: PressureRangeMetric | null
  /** RF-208 */
  overlap: OverlapMetric
}

/**
 * RF-210 — série bruta e métricas derivadas lado a lado, nunca uma sem a outra.
 *
 * `rawSamplesRef` é uma **referência**, não o array: sessões longas (TC-204) não
 * podem manter a série inteira em memória, e duplicar os brutos dentro das
 * métricas derivadas seria exatamente isso. Onde os brutos realmente vivem é
 * decisão da `session-persistence`.
 */
export interface AttemptTelemetry {
  rawSamplesRef: string
  derivedMetrics: DerivedMetrics
}
