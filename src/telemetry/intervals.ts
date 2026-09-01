/**
 * Primitiva de medida por intervalo, compartilhada.
 *
 * RF-206 (tempo em faixa) e RF-208 (overlap) medem a mesma coisa com predicados
 * diferentes: quanto tempo uma condição valeu ao longo da série. A
 * `braking-training-engine` §4 aplica a mesma lógica a outros pares de canais
 * (freio×volante, no trail braking) e manda **reaproveitar a primitiva em vez de
 * duplicá-la** — por isso ela mora aqui, e não dentro do `AttemptRecorder`.
 *
 * **A convenção, em um lugar só:** o Δt entre duas amostras é creditado ao
 * estado da amostra **anterior**, que é o que se sabe ter valido durante aquele
 * intervalo. Atribuir ao estado seguinte contaria como "dentro da condição" um
 * trecho em que o pedal ainda não tinha chegado lá.
 */

import type { TelemetrySample } from '../shared/contracts.js'

export type SamplePredicate = (sample: TelemetrySample) => boolean

/** Versão incremental, para quem consome a série em streaming (TC-204). */
export class IntervalAccumulator {
  #totalMs = 0

  /** Credita ao acumulador o intervalo entre duas amostras consecutivas. */
  step(previous: TelemetrySample, current: TelemetrySample, holds: SamplePredicate): void {
    const deltaMs = current.timestamp - previous.timestamp
    if (!(deltaMs > 0)) return
    if (holds(previous)) this.#totalMs += deltaMs
  }

  get totalMs(): number {
    return this.#totalMs
  }
}

/**
 * Versão sobre um array já materializado.
 *
 * Só para quem já tem a série de **uma tentativa** em mãos — as métricas
 * específicas de exercício, que precisam olhar amostra a amostra. Uma tentativa
 * dura segundos, então isso não conflita com o TC-204, cuja preocupação é a
 * sessão inteira.
 */
export function intervalDurationMs(
  samples: readonly TelemetrySample[],
  holds: SamplePredicate,
): number {
  const accumulator = new IntervalAccumulator()
  for (let i = 1; i < samples.length; i++) {
    accumulator.step(samples[i - 1]!, samples[i]!, holds)
  }
  return accumulator.totalMs
}
