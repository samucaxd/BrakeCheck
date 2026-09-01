/**
 * RF-106 (calibração), RF-107 (deadzone) e RF-108 (normalização),
 * cobrindo TC-105 e TC-106 do PRD §10.1.
 */

import { describe, expect, it } from 'vitest'

import {
  CalibrationRecorder,
  defaultCalibration,
  isUsable,
  type AxisCalibration,
} from '../../src/input/calibration.js'
import {
  applyDeadzoneBipolar,
  applyDeadzoneUnipolar,
  normalizePedal,
  normalizeSteering,
} from '../../src/input/normalize.js'

const theoretical = defaultCalibration()

const pedal = (rawMin: number, rawMax: number): AxisCalibration => ({
  axis: 'brake',
  rawMin,
  rawMax,
  capturedAt: 0,
})

const wheel = (rawMin: number, rawMax: number): AxisCalibration => ({
  axis: 'steering',
  rawMin,
  rawMax,
  capturedAt: 0,
})

describe('normalizePedal (RF-108)', () => {
  it('mapeia a faixa teórica para 0–100%', () => {
    expect(normalizePedal(0, theoretical.brake)).toBe(0)
    expect(normalizePedal(0.5, theoretical.brake)).toBe(50)
    expect(normalizePedal(1, theoretical.brake)).toBe(100)
  })

  it('TC-105: usa o curso real calibrado, não o teórico', () => {
    // Pedal cujo curso físico real vai de 0.1 a 0.9: pisar até o fundo precisa
    // reportar 100%, senão o piloto nunca alcança "freio máximo" e o score de
    // threshold braking fica permanentemente penalizado por um erro de escala.
    const calibrated = pedal(0.1, 0.9)

    expect(normalizePedal(0.1, calibrated)).toBe(0)
    expect(normalizePedal(0.9, calibrated)).toBe(100)
    expect(normalizePedal(0.5, calibrated)).toBeCloseTo(50, 5)
  })

  it('trava nos limites quando o bruto extrapola a calibração', () => {
    const calibrated = pedal(0.1, 0.9)
    expect(normalizePedal(0.05, calibrated)).toBe(0)
    expect(normalizePedal(0.95, calibrated)).toBe(100)
  })

  it('não divide por zero com calibração degenerada', () => {
    expect(normalizePedal(0.5, pedal(0.5, 0.5))).toBe(0)
    expect(normalizePedal(Number.NaN, theoretical.brake)).toBe(0)
  })
})

describe('normalizeSteering (RF-108)', () => {
  it('reduz-se a (valor - 50) * 2 com a calibração teórica', () => {
    // Fórmula definida em `g29-input-layer` §2.
    expect(normalizeSteering(50, theoretical.steering)).toBe(0)
    expect(normalizeSteering(75, theoretical.steering)).toBe(50)
    expect(normalizeSteering(25, theoretical.steering)).toBe(-50)
  })

  it('bruto 100 (batente esquerdo) é +100 — positivo = esquerda', () => {
    // Convenção herdada do sentido do `wheel-turn` da lib (0 = direita,
    // 100 = esquerda). Registrada em STEERING_POSITIVE_DIRECTION.
    expect(normalizeSteering(100, theoretical.steering)).toBe(100)
    expect(normalizeSteering(0, theoretical.steering)).toBe(-100)
  })

  it('TC-105: mantém o zero no centro com calibração assimétrica', () => {
    // Um piloto raramente gira exatamente o mesmo tanto para cada lado. Se os
    // dois lados fossem escalados pelo curso total, o volante centrado
    // reportaria steering ≠ 0 e todo trail braking sairia enviesado.
    const calibrated = wheel(10, 90)

    expect(normalizeSteering(50, calibrated)).toBe(0)
    expect(normalizeSteering(90, calibrated)).toBe(100)
    expect(normalizeSteering(10, calibrated)).toBe(-100)
  })

  it('escala cada lado pelo seu próprio curso quando o centro não é o meio', () => {
    const calibrated = wheel(0, 80) // centro calibrado = 40
    expect(normalizeSteering(40, calibrated)).toBe(0)
    expect(normalizeSteering(80, calibrated)).toBe(100)
    expect(normalizeSteering(0, calibrated)).toBe(-100)
    expect(normalizeSteering(60, calibrated)).toBeCloseTo(50, 5)
  })
})

describe('deadzone (RF-107)', () => {
  it('TC-106: elimina o ruído de repouso', () => {
    expect(applyDeadzoneUnipolar(1.5, 2)).toBe(0)
    expect(applyDeadzoneBipolar(1.2, 2)).toBe(0)
    expect(applyDeadzoneBipolar(-1.2, 2)).toBe(0)
  })

  it('TC-106: preserva movimento pequeno intencional, sem degrau', () => {
    // O ponto do cenário: cortar ruído sem cortar o toque leve de freio do
    // trail braking. Logo acima do limiar a saída precisa ser contínua a partir
    // do zero — com corte puro haveria um salto de 0 para ~2%, artefato bem no
    // trecho do curso que mais importa para a técnica.
    const justAbove = applyDeadzoneUnipolar(2.5, 2)
    expect(justAbove).toBeGreaterThan(0)
    expect(justAbove).toBeLessThan(1)

    const higher = applyDeadzoneUnipolar(10, 2)
    expect(higher).toBeGreaterThan(justAbove)
  })

  it('preserva os extremos do curso', () => {
    expect(applyDeadzoneUnipolar(100, 2)).toBe(100)
    expect(applyDeadzoneBipolar(100, 2)).toBe(100)
    expect(applyDeadzoneBipolar(-100, 2)).toBe(-100)
  })

  it('é monotônica — mais curso nunca produz menos saída', () => {
    let previous = -1
    for (let v = 0; v <= 100; v += 0.5) {
      const out = applyDeadzoneUnipolar(v, 2)
      expect(out).toBeGreaterThanOrEqual(previous)
      previous = out
    }
  })

  it('deadzone 0 é passagem direta', () => {
    expect(applyDeadzoneUnipolar(37.5, 0)).toBe(37.5)
    expect(applyDeadzoneBipolar(-37.5, 0)).toBe(-37.5)
  })

  it('não estoura com deadzone absurda', () => {
    expect(applyDeadzoneUnipolar(50, 150)).toBe(0)
    expect(applyDeadzoneBipolar(-50, 150)).toBe(0)
  })
})

describe('CalibrationRecorder (RF-106)', () => {
  it('grava os extremos observados por eixo', () => {
    const recorder = new CalibrationRecorder(() => 1000)

    recorder.observe({ brake: 0.2, throttle: 0.0, steering: 50 })
    recorder.observe({ brake: 0.85, throttle: 0.95, steering: 12 })
    recorder.observe({ brake: 0.1, throttle: 0.4, steering: 88 })

    const calibration = recorder.build()

    expect(calibration.brake).toEqual({
      axis: 'brake',
      rawMin: 0.1,
      rawMax: 0.85,
      capturedAt: 1000,
    })
    expect(calibration.steering.rawMin).toBe(12)
    expect(calibration.steering.rawMax).toBe(88)
  })

  it('aponta os eixos que o piloto ainda não moveu', () => {
    const recorder = new CalibrationRecorder()
    recorder.observe({ brake: 0.2, throttle: 0.5, steering: 50 })
    recorder.observe({ brake: 0.9, throttle: 0.5, steering: 50 })

    // Só o freio percorreu curso; a UI precisa saber o que ainda falta pedir.
    expect(recorder.incompleteAxes()).toEqual(['throttle', 'steering'])
  })

  it('cai no default teórico em vez de produzir calibração inválida', () => {
    const recorder = new CalibrationRecorder(() => 500)
    recorder.observe({ brake: 0.3, throttle: 0.3, steering: 50 })

    const calibration = recorder.build()

    // Nenhum eixo percorreu curso: rawMax === rawMin faria a normalização
    // dividir por zero, então o fallback teórico é o comportamento seguro.
    expect(isUsable(calibration.brake)).toBe(true)
    expect(calibration.brake.rawMin).toBe(0)
    expect(calibration.brake.rawMax).toBe(1)
  })

  it('ignora leituras não-finitas', () => {
    const recorder = new CalibrationRecorder()
    recorder.observe({ brake: 0.2, throttle: 0.1, steering: 50 })
    recorder.observe({ brake: Number.NaN, throttle: 0.9, steering: 90 })

    expect(recorder.rangeFor('brake')).toEqual({ min: 0.2, max: 0.2 })
  })
})
