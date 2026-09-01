/**
 * Input Processing — deadzone (RF-107) e normalização para canais lógicos
 * (RF-108). Tudo aqui é função pura, para ser testável sem dispositivo.
 */

import { STEERING_POSITIVE_DIRECTION } from '../config/provisional.js'
import type { AxisCalibration } from './calibration.js'

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Pedal bruto → 0–100% de curso, respeitando a calibração do eixo (RF-106/108).
 *
 * Lembrete permanente (`g29-input-layer` §0): isto é **curso do pedal**, não
 * força. A pedaleira do G29 é potenciômetro, não célula de carga.
 */
export function normalizePedal(raw: number, calibration: AxisCalibration): number {
  const span = calibration.rawMax - calibration.rawMin
  if (!(span > 0) || !Number.isFinite(raw)) return 0
  return clamp(((raw - calibration.rawMin) / span) * 100, 0, 100)
}

/**
 * Volante bruto → escala simétrica -100 a +100, 0 = centro (RF-108).
 *
 * Os dois lados são escalados separadamente a partir do centro calibrado. Isso
 * importa porque uma calibração real quase nunca é simétrica (o piloto raramente
 * gira exatamente o mesmo tanto para cada lado), e escalar pelo curso total
 * deslocaria o zero — o volante centrado reportaria steering ≠ 0.
 *
 * Com a calibração teórica (0–100), reduz-se exatamente à fórmula
 * `(valor - 50) * 2` definida em `g29-input-layer` §2.
 *
 * SENTIDO DO SINAL: o bruto do `wheel-turn` é 0 = direita, 100 = esquerda, então
 * a fórmula da skill produz **positivo = esquerda**. Ver
 * `STEERING_POSITIVE_DIRECTION`.
 */
export function normalizeSteering(raw: number, calibration: AxisCalibration): number {
  const { rawMin, rawMax } = calibration
  if (!(rawMax > rawMin) || !Number.isFinite(raw)) return 0

  const center = (rawMin + rawMax) / 2
  const halfSpan = raw >= center ? rawMax - center : center - rawMin
  if (!(halfSpan > 0)) return 0

  const normalized = clamp(((raw - center) / halfSpan) * 100, -100, 100)
  return STEERING_POSITIVE_DIRECTION === 'left' ? normalized : -normalized
}

/**
 * Deadzone de um eixo unipolar (pedal, repouso em 0).
 *
 * Reescala a faixa restante em vez de simplesmente zerar abaixo do limiar.
 * Com corte puro, um pedal em 2.1% saltaria de 0 para 2.1 — um degrau
 * artificial bem no início do curso, que é justamente onde o trail braking
 * acontece. Reescalando, a saída é contínua a partir do limiar e o toque leve
 * intencional sobrevive, que é o que o TC-106 cobra ("sem cortar movimentos
 * pequenos intencionais").
 */
export function applyDeadzoneUnipolar(value: number, deadzonePercent: number): number {
  const dz = clamp(deadzonePercent, 0, 99)
  if (dz === 0) return clamp(value, 0, 100)

  const v = clamp(value, 0, 100)
  if (v <= dz) return 0
  return clamp(((v - dz) / (100 - dz)) * 100, 0, 100)
}

/**
 * Deadzone de um eixo bipolar (volante, repouso em 0), simétrica nos dois lados.
 * Mesma reescala contínua da versão unipolar.
 */
export function applyDeadzoneBipolar(value: number, deadzonePercent: number): number {
  const dz = clamp(deadzonePercent, 0, 99)
  const v = clamp(value, -100, 100)
  if (dz === 0) return v

  const magnitude = Math.abs(v)
  if (magnitude <= dz) return 0

  const scaled = ((magnitude - dz) / (100 - dz)) * 100
  return clamp(Math.sign(v) * scaled, -100, 100)
}
