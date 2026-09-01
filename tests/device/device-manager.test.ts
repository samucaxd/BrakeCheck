/**
 * Cenários do PRD §10.1 (Device & Input Layer) que podem ser verificados sem
 * hardware físico, usando o `MockDeviceSource`.
 *
 * O que estes testes provam: a **lógica** de detecção, amostragem, desconexão e
 * reconexão está correta contra o contrato do port.
 * O que eles NÃO provam: que o G29 real se comporta como o port descreve —
 * isso é `npm run probe:g29`, e continua pendente.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DeviceManager } from '../../src/device/device-manager.js'
import { MockDeviceSource } from '../../src/device/mock-source.js'
import type { DeviceStatus, RawSample } from '../../src/device/types.js'

const SAMPLE_MS = 10
const HEARTBEAT_MS = 100
const RECONNECT_MS = 50

function build(source: MockDeviceSource) {
  const samples: RawSample[] = []
  const statuses: DeviceStatus[] = []
  const manager = new DeviceManager(source, {
    sampleIntervalMs: SAMPLE_MS,
    heartbeatTimeoutMs: HEARTBEAT_MS,
    reconnectIntervalMs: RECONNECT_MS,
  })
  manager.onSample((s) => samples.push(s))
  manager.onStatusChange((s) => statuses.push(s))
  return { manager, samples, statuses }
}

/** Avança o relógio falso deixando as promessas pendentes resolverem entre os ticks. */
async function advance(ms: number, step = SAMPLE_MS): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await vi.advanceTimersByTimeAsync(step)
  }
}

describe('DeviceManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('TC-101: detecta o dispositivo já conectado no boot e lista os eixos', async () => {
    const source = new MockDeviceSource()
    const { manager } = build(source)

    const status = await manager.start()

    expect(status).toBe('connected')
    expect(manager.describeInputs().map((i) => i.event)).toContain('pedals-brake')

    await manager.stop()
  })

  it('TC-104: sem dispositivo, reporta estado no_device em vez de lançar exceção', async () => {
    const source = new MockDeviceSource({ failToConnect: true })
    const { manager, statuses } = build(source)

    // RF-109: a ausência de dispositivo é um estado, não uma exceção.
    await expect(manager.start()).resolves.toBe('no_device')
    expect(statuses).toContain('no_device')

    await manager.stop()
  })

  it('TC-102: detecta hot-plug sem reiniciar a aplicação', async () => {
    const source = new MockDeviceSource()
    source.simulateUnplug() // dispositivo ausente quando o software abre
    const { manager } = build(source)

    expect(await manager.start()).toBe('no_device')

    source.simulateReplug()
    await advance(RECONNECT_MS * 3)

    expect(manager.status).toBe('connected')

    await manager.stop()
  })

  it('RF-103: amostra em taxa fixa mesmo com o pedal parado', async () => {
    // Regressão do achado em code/index.js:481 — os eventos da lib são
    // change-gated, então segurar o freio a 60% não gera evento nenhum. Sem o
    // sampler de taxa fixa, a Telemetry Engine veria um buraco no lugar de
    // pressão sustentada, e RF-206 (tempo em faixa) seria incalculável.
    const source = new MockDeviceSource()
    const { manager, samples } = build(source)
    await manager.start()

    source.emit({ brake: 0.6 })
    await advance(100) // 100ms sem nenhuma mudança nova

    expect(samples.length).toBeGreaterThanOrEqual(8)
    expect(samples.every((s) => s.brake === 0.6)).toBe(true)

    await manager.stop()
  })

  it('RF-104: silêncio sozinho não conta como desconexão', async () => {
    // O piloto pode ficar segundos sem tocar em nada numa reta. Se o silêncio
    // pausasse a sessão, o treino seria interrompido no meio.
    const source = new MockDeviceSource()
    const { manager } = build(source)
    await manager.start()

    await advance(HEARTBEAT_MS * 5) // muito silêncio, dispositivo presente

    expect(manager.status).toBe('connected')

    await manager.stop()
  })

  it('TC-103: desconexão física pausa a captura e não fabrica amostras', async () => {
    const source = new MockDeviceSource()
    const { manager, samples } = build(source)
    await manager.start()

    source.emit({ brake: 0.8 })
    await advance(50)
    const capturedBefore = samples.length
    expect(capturedBefore).toBeGreaterThan(0)

    source.simulateUnplug()
    await advance(HEARTBEAT_MS * 3)

    expect(manager.status).toBe('disconnected')

    // RNF-08: os dados já capturados continuam íntegros...
    expect(samples.slice(0, capturedBefore).every((s) => s.brake === 0.8)).toBe(true)

    // ...e nenhuma amostra nova foi inventada a partir do último estado conhecido.
    const afterDisconnect = samples.length
    await advance(HEARTBEAT_MS * 2)
    expect(samples.length).toBe(afterDisconnect)

    await manager.stop()
  })

  it('RF-105: reconecta sozinho e volta a amostrar depois de religar o cabo', async () => {
    const source = new MockDeviceSource()
    const { manager, samples } = build(source)
    await manager.start()

    source.simulateUnplug()
    await advance(HEARTBEAT_MS * 3)
    expect(manager.status).toBe('disconnected')

    const beforeReplug = samples.length
    source.simulateReplug()
    await advance(RECONNECT_MS * 4)

    expect(manager.status).toBe('connected')
    await advance(50)
    expect(samples.length).toBeGreaterThan(beforeReplug)

    await manager.stop()
  })

  it('stop() encerra o sampler e não deixa timer solto', async () => {
    const source = new MockDeviceSource()
    const { manager, samples } = build(source)
    await manager.start()
    await advance(50)

    await manager.stop()
    const afterStop = samples.length

    await advance(200)

    expect(samples.length).toBe(afterStop)
    expect(manager.status).toBe('idle')
  })
})
