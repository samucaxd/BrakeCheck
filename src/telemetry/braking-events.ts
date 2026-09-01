/**
 * Detecção de eventos de frenagem (`telemetry-engine` §2).
 *
 * Máquina de estados que consome amostras uma a uma e fecha eventos conforme
 * eles terminam. É streaming por exigência do TC-204: uma sessão de 1h a 100 Hz
 * são 360 mil amostras, e nada aqui pode depender de ter a série inteira em
 * memória. O que fica retido são só os eventos fechados — dezenas, não milhares.
 */

import { BRAKE_EVENT_THRESHOLD_PERCENT } from '../config/provisional.js'
import type { BrakingEvent } from './types.js'

interface OpenEvent {
  startMs: number
  startValue: number
  peakMs: number
  peakValue: number
}

export class BrakingEventDetector {
  #threshold: number
  #events: BrakingEvent[] = []
  #open: OpenEvent | null = null

  constructor(threshold: number = BRAKE_EVENT_THRESHOLD_PERCENT) {
    this.#threshold = threshold
  }

  /**
   * Consome uma amostra.
   *
   * @param relativeMs tempo desde o início da tentativa
   * @param brake curso do pedal de freio, 0–100
   */
  push(relativeMs: number, brake: number): void {
    const above = brake > this.#threshold

    if (this.#open === null) {
      if (above) {
        /**
         * A skill define início como o cruzamento "vindo de um valor abaixo".
         * Uma tentativa que já começa com o pedal pressionado não tem esse
         * cruzamento — e ainda assim abre evento aqui, de propósito: descartá-la
         * jogaria fora a frenagem inteira. O `startValue` registrado deixa
         * visível que a captura pegou o evento já em curso.
         */
        this.#open = {
          startMs: relativeMs,
          startValue: brake,
          peakMs: relativeMs,
          peakValue: brake,
        }
      }
      return
    }

    if (above) {
      if (brake > this.#open.peakValue) {
        this.#open.peakValue = brake
        this.#open.peakMs = relativeMs
      }
      return
    }

    // Cruzou para baixo do limiar: fecha o evento nesta amostra.
    this.#events.push(finalize(this.#open, relativeMs, brake, false))
    this.#open = null
  }

  /**
   * Fecha a detecção no fim da tentativa.
   *
   * Um evento ainda aberto é fechado como `truncated`, e não descartado: o
   * piloto freou de verdade, a captura é que acabou antes da liberação.
   */
  finish(lastRelativeMs: number, lastBrake: number): BrakingEvent[] {
    if (this.#open !== null) {
      this.#events.push(finalize(this.#open, lastRelativeMs, lastBrake, true))
      this.#open = null
    }
    return this.#events
  }
}

function finalize(
  open: OpenEvent,
  endMs: number,
  endValue: number,
  truncated: boolean,
): BrakingEvent {
  const riseMs = open.peakMs - open.startMs
  const fallMs = endMs - open.peakMs

  return {
    startMs: open.startMs,
    peakMs: open.peakMs,
    endMs,
    startValue: open.startValue,
    peakValue: open.peakValue,
    endValue,
    timeToPeakMs: riseMs,
    /**
     * `null` em vez de Infinity quando o intervalo é zero (TC-203): um pico na
     * mesma amostra do início significa que a captura não tem resolução para
     * medir a subida, não que a aplicação foi infinitamente rápida. Deixar
     * Infinity vazaria para o scoring como se fosse uma técnica excepcional.
     */
    applicationSpeedPctPerS:
      riseMs > 0 ? ((open.peakValue - open.startValue) / riseMs) * 1000 : null,
    releaseSpeedPctPerS:
      fallMs > 0 ? ((open.peakValue - endValue) / fallMs) * 1000 : null,
    truncated,
  }
}
