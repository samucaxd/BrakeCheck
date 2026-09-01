/**
 * Geradores de traços sintéticos de input, compartilhados pelos testes.
 *
 * Um humano não consegue repetir uma frenagem byte a byte, e vários cenários do
 * PRD dependem exatamente disso — TC-201 pede um "padrão conhecido (gabarito)",
 * TC-205/TC-206 pedem tentativas idênticas versus muito diferentes. Traços
 * sintéticos são a única forma de escrever esses testes de forma determinística.
 */

import type { TelemetrySample } from '../../src/shared/contracts.js'
import { AttemptRecorder } from '../../src/telemetry/attempt-recorder.js'
import type { DerivedMetrics } from '../../src/telemetry/types.js'
import type { Band } from '../../src/training/types.js'

export const EPOCH = 1_700_000_000_000

export interface BrakingTraceOptions {
  peak: number
  riseMs: number
  holdMs: number
  fallMs: number
  /** Intervalo entre amostras. 10ms = os 100 Hz assumidos pelo sampler. */
  stepMs?: number
  startEpoch?: number
  /** Silêncio antes da frenagem começar, em ms. */
  leadInMs?: number
  /** Acelerador em função do tempo relativo, para cenários de overlap. */
  throttleAt?: (relativeMs: number) => number
  /** Volante em função do tempo relativo, para cenários de trail braking. */
  steeringAt?: (relativeMs: number) => number
}

/** Frenagem trapezoidal: sobe até o pico, segura, e solta. */
export function brakingTrace(options: BrakingTraceOptions): TelemetrySample[] {
  const {
    peak,
    riseMs,
    holdMs,
    fallMs,
    stepMs = 10,
    startEpoch = EPOCH,
    leadInMs = 0,
    throttleAt = () => 0,
    steeringAt = () => 0,
  } = options

  const samples: TelemetrySample[] = []
  let relativeMs = 0

  const push = (brake: number) => {
    samples.push({
      timestamp: startEpoch + relativeMs,
      brake,
      throttle: throttleAt(relativeMs),
      steering: steeringAt(relativeMs),
    })
    relativeMs += stepMs
  }

  for (let elapsed = 0; elapsed < leadInMs; elapsed += stepMs) push(0)

  push(0)
  for (let elapsed = stepMs; elapsed <= riseMs; elapsed += stepMs) {
    push((elapsed / riseMs) * peak)
  }
  for (let elapsed = 0; elapsed < holdMs; elapsed += stepMs) push(peak)
  for (let elapsed = stepMs; elapsed <= fallMs; elapsed += stepMs) {
    push(peak * (1 - elapsed / fallMs))
  }
  push(0)

  return samples
}

/** Segura o freio num valor constante pela janela pedida. */
export function holdTrace(value: number, holdMs: number, stepMs = 10): TelemetrySample[] {
  const samples: TelemetrySample[] = []
  for (let elapsed = 0; elapsed <= holdMs; elapsed += stepMs) {
    samples.push({ timestamp: EPOCH + elapsed, brake: value, throttle: 0, steering: 0 })
  }
  return samples
}

/** Passa um traço pelo `AttemptRecorder` e devolve as métricas derivadas. */
export function metricsFor(
  samples: readonly TelemetrySample[],
  pressureBand?: Band,
): DerivedMetrics {
  const recorder = new AttemptRecorder({
    rawSamplesRef: 'fixture',
    ...(pressureBand ? { pressureBand } : {}),
  })
  for (const sample of samples) recorder.add(sample)
  return recorder.finish().derivedMetrics
}
