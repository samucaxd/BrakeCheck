/**
 * Processo filho do teste de encerramento abrupto (TC-602).
 *
 * Abre o banco, grava tentativas de verdade, avisa o pai que está pronto e
 * fica vivo até levar SIGKILL. Não tem tratamento de sinal de propósito: o
 * cenário a testar é o processo morrer **sem** chance de fechar o banco.
 *
 * Não termina em `.test.ts`, então o vitest não o coleta como suíte.
 */

import { BrakeCheckStore } from '../../src/persistence/store.js'
import type { DerivedMetrics } from '../../src/telemetry/types.js'

const dbPath = process.argv[2]!
const attemptCount = Number(process.argv[3] ?? 3)

const metrics: DerivedMetrics = {
  durationMs: 900,
  sampleCount: 90,
  brake: { min: 0, max: 80 },
  throttle: { min: 0, max: 0 },
  steering: { min: 0, max: 0 },
  brakingEvents: [],
  brakingAggregate: {
    eventCount: 0,
    peakValue: null,
    timeToPeakMs: null,
    applicationSpeedPctPerS: null,
    releaseSpeedPctPerS: null,
  },
  timeInPressureRange: null,
  overlap: { durationMs: 0, pctOfDuration: null },
}

const store = new BrakeCheckStore({ path: dbPath })
const session = store.createSession('G29', 1000)

for (let i = 0; i < attemptCount; i++) {
  store.saveAttempt({
    sessionId: session.id,
    exerciseId: 'fund-01-controle-pedal',
    timestamp: 1100 + i,
    derivedMetrics: metrics,
    samples: Array.from({ length: 100 }, (_, s) => ({
      timestamp: 1_700_000_000_000 + s * 10,
      brake: s,
      throttle: 0,
      steering: 0,
    })),
  })
}

process.stdout.write(`READY ${session.id}\n`)

// Mantém o processo vivo até o pai matá-lo. Sem handler de sinal: o banco
// precisa ser abandonado sem close(), que é o que um crash faz.
setInterval(() => {}, 60_000)
