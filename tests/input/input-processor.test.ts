/**
 * Contrato de saída da camada 1 (`g29-input-layer` §7): o `TelemetrySample`
 * que a Telemetry Engine vai consumir.
 */

import { describe, expect, it } from 'vitest'

import { DeviceManager } from '../../src/device/device-manager.js'
import { MockDeviceSource } from '../../src/device/mock-source.js'
import { InputProcessor } from '../../src/input/input-processor.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'

describe('InputProcessor', () => {
  it('entrega o contrato de saída da camada, e só ele', () => {
    const processor = new InputProcessor({ deadzones: { brake: 0, throttle: 0, steering: 0 } })

    const sample = processor.process({
      timestamp: 1_732_550_400_123,
      brake: 0.425,
      throttle: 0,
      steering: 43.5,
    })

    expect(sample).toEqual<TelemetrySample>({
      timestamp: 1_732_550_400_123,
      brake: 42.5,
      throttle: 0,
      steering: -13,
    })
    // A camada para aqui: nada de duração, taxa ou consistência (telemetry-engine).
    expect(Object.keys(sample).sort()).toEqual(['brake', 'steering', 'throttle', 'timestamp'])
  })

  it('preserva o timestamp da amostra bruta sem reescrevê-lo', () => {
    // A Telemetry Engine deriva tempo relativo à tentativa a partir deste valor;
    // reescrever aqui destruiria o espaçamento real entre amostras.
    const processor = new InputProcessor()
    const t = 1_700_000_000_000
    expect(processor.process({ timestamp: t, brake: 0, throttle: 0, steering: 50 }).timestamp).toBe(t)
  })

  it('recalibrar muda a interpretação das amostras seguintes (RF-106)', () => {
    const processor = new InputProcessor({ deadzones: { brake: 0, throttle: 0, steering: 0 } })
    const raw = { timestamp: 0, brake: 0.9, throttle: 0, steering: 50 }

    expect(processor.process(raw).brake).toBeCloseTo(90, 5)

    processor.setCalibration({
      ...processor.getCalibration(),
      brake: { axis: 'brake', rawMin: 0, rawMax: 0.9, capturedAt: 1 },
    })

    expect(processor.process(raw).brake).toBe(100)
  })

  it('a deadzone é configurável por eixo (RF-107)', () => {
    const processor = new InputProcessor({ deadzones: { brake: 0, throttle: 0, steering: 0 } })
    const raw = { timestamp: 0, brake: 0.01, throttle: 0, steering: 50 }

    expect(processor.process(raw).brake).toBeCloseTo(1, 5)

    processor.setDeadzone('brake', 5)
    expect(processor.process(raw).brake).toBe(0)
    expect(processor.getDeadzones().throttle).toBe(0)
  })

  it('repouso do dispositivo vira zero em todos os canais', () => {
    const processor = new InputProcessor()
    const sample = processor.process({ timestamp: 0, brake: 0, throttle: 0, steering: 50 })

    expect(sample.brake).toBe(0)
    expect(sample.throttle).toBe(0)
    expect(sample.steering).toBe(0)
  })
})

describe('Device Layer → Input Processing (fronteira de camadas)', () => {
  it('a amostra bruta do manager atravessa para TelemetrySample', async () => {
    // Prova que as duas camadas se encaixam pelo contrato, sem a de cima
    // conhecer a lib nem a escala nativa do dispositivo.
    const source = new MockDeviceSource()
    const manager = new DeviceManager(source, { sampleIntervalMs: 5 })
    const processor = new InputProcessor({ deadzones: { brake: 0, throttle: 0, steering: 0 } })

    const samples: TelemetrySample[] = []
    manager.onSample((raw) => samples.push(processor.process(raw)))

    await manager.start()
    source.emit({ brake: 1, throttle: 0, steering: 100 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await manager.stop()

    expect(samples.length).toBeGreaterThan(0)
    const last = samples[samples.length - 1]!
    expect(last.brake).toBe(100)
    expect(last.steering).toBe(100)
  })
})
