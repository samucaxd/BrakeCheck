/**
 * Toolkit de funções de pontuação (`evaluation-scoring-engine` §1).
 *
 * São cinco fórmulas genéricas, e a skill é explícita: *"não invente uma fórmula
 * nova por exercício, encaixe no formato que já existe"*. Por isso este arquivo
 * não conhece exercício nenhum — só recebe valor e parâmetros.
 *
 * Todos os parâmetros vêm do `scoringRules` do catálogo. Esta camada não define
 * limiar nenhum: ela só transforma limiar em score.
 */

import { clamp } from '../input/normalize.js'
import type { Band } from '../training/types.js'

/**
 * Faixa-alvo `[low, high]`.
 *
 * Dentro da faixa → 100. Fora, penalidade proporcional à distância até a borda
 * mais próxima, com tolerância igual à largura da própria faixa.
 *
 * É esta fórmula que atende TC-401 e TC-402: uma aplicação abrupta ou uma
 * liberação sem trail-off não levam corte binário, levam penalidade proporcional
 * a **quanto** passaram do ideal.
 *
 * Característica conhecida: dentro da faixa o score é achatado em 100, sem
 * gradação. É consequência direta da fórmula que a skill define — se na prática
 * isso se mostrar permissivo demais, o ajuste é na tolerância (§7 da skill a
 * registra como provisória).
 */
export function scoreTargetRange(value: number, range: Band): number {
  const [low, high] = range
  if (value >= low && value <= high) return 100

  const tolerance = high - low
  if (!(tolerance > 0)) return value === low ? 100 : 0

  const distance = value < low ? low - value : value - high
  return clamp(100 - (100 * distance) / tolerance, 0, 100)
}

/**
 * Proporção de tempo/cobertura: `valor / exigido`, saturando em 100.
 *
 * `required` é a janela **inteira** pedida ao exercício, não a fração mínima do
 * critério de sucesso. Assim o sub-score é a cobertura real alcançada (ficar 80%
 * da janela na faixa vale 80), em vez de dar 100 a quem apenas passou raspando —
 * o critério de sucesso já responde "passou?"; o sub-score responde "quão bem?".
 */
export function scoreProportion(value: number, required: number): number {
  if (!(required > 0)) return 0
  return clamp((value / required) * 100, 0, 100)
}

/**
 * Desvio em relação a um alvo único.
 *
 * `score = max(0, 100 − 100 × |valor − alvo| / desvio_máx_tolerável)`
 */
export function scoreTargetValue(value: number, target: number, maxDeviation: number): number {
  if (!(maxDeviation > 0)) return value === target ? 100 : 0
  return clamp(100 - (100 * Math.abs(value - target)) / maxDeviation, 0, 100)
}

/**
 * Correlação: `|r| / r_mín`, saturando em 100.
 *
 * Usa o valor absoluto porque o exercício que consome isso (relação frenagem ×
 * rotação) espera correlação **negativa** forte — o que importa é a magnitude da
 * relação, e o sinal já é verificado pelo critério de sucesso.
 */
export function scoreCorrelation(r: number, minAbsolute: number): number {
  if (!(minAbsolute > 0)) return 0
  return clamp((Math.abs(r) / minAbsolute) * 100, 0, 100)
}

/**
 * Consistência a partir do coeficiente de variação.
 *
 * `score = max(0, 100 − 100 × (cv / cv_máx))`. CV zero → 100; CV no limite
 * tolerado → 0.
 */
export function scoreConsistency(
  coefficientOfVariation: number,
  maxCoefficientOfVariation: number,
): number {
  if (!(maxCoefficientOfVariation > 0)) return coefficientOfVariation === 0 ? 100 : 0
  return clamp(100 - (100 * coefficientOfVariation) / maxCoefficientOfVariation, 0, 100)
}
