/**
 * Curva ideal × executada (RF-705).
 *
 * A curva ideal não existe pronta no catálogo: ela é **derivada** do tipo de
 * `success_criteria` de cada exercício (`telemetry-visualization-replay` §4),
 * reaproveitando as mesmas categorias da `evaluation-scoring-engine` §1.
 *
 * A curva é expressa no eixo **alinhado** (`tAligned`, com 0 no início da
 * frenagem), o mesmo da série executada — é isso que o TC-702 cobra: os dois
 * eixos batendo exatamente, sem deslocamento acidental entre eles.
 */

import type { Exercise, SuccessCriterion } from '../training/types.js'

/** Ponto da curva ideal, no eixo de tempo alinhado. */
export interface CurvePoint {
  tAligned: number
  value: number
}

export type IdealCurve =
  /** Curva contínua a sobrepor à série executada. */
  | { kind: 'curve'; channel: 'brake'; points: CurvePoint[] }
  /**
   * Instante-alvo, sem curva.
   *
   * Critérios de "desvio de alvo único" (atraso de reação, intervalo de
   * estabilização, overlap-alvo) não produzem uma curva contínua útil — a skill
   * §4 é explícita nisso. O que faz sentido exibir é uma marca no tempo
   * esperado, e a UI decide se desenha linha vertical, bandeira ou outra coisa.
   */
  | { kind: 'marker'; tAligned: number; label: string }
  /**
   * O exercício não tem curva ideal derivável.
   *
   * Vale para critérios sobre **forma** ou **relação** (velocidade de aplicação
   * ou liberação, estabilidade de volante, correlação, consistência entre
   * tentativas): o alvo deles não é um nível de pedal em cada instante, então
   * qualquer curva desenhada seria inventada. Melhor não exibir nada do que
   * exibir uma referência que o exercício não define.
   */
  | { kind: 'none'; reason: string }

/**
 * RF-705 — deriva a curva ideal de um exercício.
 *
 * As três primeiras categorias vêm direto da tabela da skill §4. `band_sequence`
 * é a mesma regra da faixa-alvo aplicada por segmento, produzindo uma curva em
 * degraus — não é uma categoria nova, é a linha 1 repetida.
 */
export function idealCurveFor(exercise: Exercise): IdealCurve {
  const criterion: SuccessCriterion = exercise.successCriteria

  switch (criterion.kind) {
    /** Faixa-alvo sustentada → linha reta no ponto médio, ao longo da janela. */
    case 'pressure_hold': {
      const value = midpoint(criterion.band)
      return {
        kind: 'curve',
        channel: 'brake',
        points: [
          { tAligned: 0, value },
          { tAligned: criterion.windowMs, value },
        ],
      }
    }

    /**
     * Threshold braking: mesma regra, mas a janela é o evento de frenagem, cuja
     * duração só é conhecida na tentativa. A curva sai como um segmento a partir
     * do início da frenagem, e a UI a estende até o fim do evento executado.
     */
    case 'peak_sustained': {
      const value = midpoint(criterion.band)
      return {
        kind: 'curve',
        channel: 'brake',
        points: [
          { tAligned: 0, value },
          { tAligned: Number.POSITIVE_INFINITY, value },
        ],
      }
    }

    /** Sequência de faixas → curva em degraus, um patamar por segmento. */
    case 'band_sequence': {
      const points: CurvePoint[] = []
      for (const segment of criterion.segments) {
        const value = midpoint(segment.band)
        points.push({ tAligned: segment.startMs, value })
        points.push({ tAligned: segment.endMs, value })
      }
      return { kind: 'curve', channel: 'brake', points }
    }

    /** Perfil-alvo explícito → usar como está, sem derivar nada. */
    case 'profile_tracking':
      return {
        kind: 'curve',
        channel: 'brake',
        points: criterion.profile.map((point) => ({
          tAligned: point.atMs,
          value: point.target,
        })),
      }

    case 'reaction_delta':
      return {
        kind: 'marker',
        // 0 no eixo alinhado É o início da frenagem; o alvo é reagir antes do
        // limite, então a marca vai no limite tolerado.
        tAligned: criterion.maxDeltaMs,
        label: `Limite de reação: ${criterion.maxDeltaMs}ms`,
      }

    case 'stabilization_interval':
      return {
        kind: 'marker',
        tAligned: criterion.minIntervalMs,
        label: `Estabilização mínima: ${criterion.minIntervalMs}ms`,
      }

    case 'trail_overlap':
      return {
        kind: 'marker',
        tAligned: criterion.minOverlapMs,
        label: `Overlap mínimo: ${criterion.minOverlapMs}ms`,
      }

    case 'clean_handoff':
      return {
        kind: 'marker',
        tAligned: criterion.maxBrakeThrottleOverlapMs,
        label: `Overlap máximo na retomada: ${criterion.maxBrakeThrottleOverlapMs}ms`,
      }

    case 'application_speed_range':
    case 'release_speed_range':
      return {
        kind: 'none',
        reason:
          'O critério é a taxa de variação do pedal, não um nível em cada instante — não há curva de referência definida pelo exercício.',
      }

    case 'steering_stability':
      return {
        kind: 'none',
        reason: 'O critério é a amplitude do volante durante a frenagem, não uma curva no tempo.',
      }

    case 'brake_steering_correlation':
      return {
        kind: 'none',
        reason: 'O critério é a relação entre dois canais, não uma curva de um deles.',
      }

    case 'inter_attempt_consistency':
      return {
        kind: 'none',
        reason: 'O critério é a variação entre tentativas — o overlay das próprias tentativas já é a visualização.',
      }

    case 'peak_and_application':
      return {
        kind: 'none',
        reason: 'O critério combina pico e taxa de subida, sem definir o nível do pedal ao longo do tempo.',
      }
  }
}

function midpoint(band: readonly [number, number]): number {
  return (band[0] + band[1]) / 2
}

/**
 * Recorta uma curva ideal ao domínio real do gráfico.
 *
 * Existe por causa do `Infinity` do `peak_sustained`, que representa "até o fim
 * do evento executado" — só a tentativa sabe onde isso é.
 */
export function clampCurve(curve: IdealCurve, maxTAligned: number): IdealCurve {
  if (curve.kind !== 'curve') return curve
  return {
    ...curve,
    points: curve.points.map((point) => ({
      ...point,
      tAligned: Number.isFinite(point.tAligned)
        ? Math.min(point.tAligned, maxTAligned)
        : maxTAligned,
    })),
  }
}
