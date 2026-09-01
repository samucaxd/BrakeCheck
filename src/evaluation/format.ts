/**
 * Formatos de exibição da RN-01 (pontuação) e RN-02 (Skill Profile).
 *
 * O PRD especifica estes dois formatos com exemplos literais, então eles são
 * código e teste, não decisão de UI. A `simulator-ui-design` decide cor,
 * tipografia e layout; a **estrutura** do que é exibido é regra de negócio.
 */

import type { SubScoreId } from '../training/types.js'
import { DIMENSION_LABELS, SKILL_DIMENSIONS } from './types.js'
import type { ScoreResult, SkillProfile } from './types.js'

/** Rótulos dos sub-scores (RN-01). Em português por RNF-10. */
export const SUBSCORE_LABELS: Readonly<Record<SubScoreId, string>> = {
  aplicacao_inicial: 'Aplicação inicial',
  controle_pressao: 'Controle de pressão',
  liberacao: 'Liberação',
  consistencia: 'Consistência',
  consistencia_direcional: 'Consistência direcional',
  ponto_frenagem: 'Ponto de frenagem',
}

/** `null` vira travessão: sem dado é diferente de zero, e a tela precisa mostrar isso. */
function renderScore(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}/100`
}

/**
 * RN-01 — score total mais a decomposição em sub-scores.
 *
 * Formato de referência do PRD §9:
 *
 * ```
 * Threshold Braking — 82/100
 *   Aplicação inicial:     91/100
 *   Controle de pressão:   78/100
 * ```
 */
export function formatScoreResult(result: ScoreResult, exerciseName: string): string {
  const lines = [`${exerciseName} — ${renderScore(result.totalScore)}`]

  const labelWidth = Math.max(
    ...result.subScores.map((subScore) => SUBSCORE_LABELS[subScore.id].length + 1),
    0,
  )

  for (const subScore of result.subScores) {
    const label = `${SUBSCORE_LABELS[subScore.id]}:`.padEnd(labelWidth + 1)
    lines.push(`  ${label} ${renderScore(subScore.value)}`)
  }

  return lines.join('\n')
}

/**
 * RN-02 — perfil como lista de dimensões com pontuação.
 *
 * Ordenado do mais forte para o mais fraco, como no exemplo do PRD §9. As
 * dimensões sem dado vão para o fim, com travessão: elas não são fraquezas, são
 * ausências, e ordená-las como se fossem zero criaria uma leitura falsa de
 * "pior habilidade do piloto".
 */
export function formatSkillProfile(profile: SkillProfile): string {
  const rows = SKILL_DIMENSIONS.map((dimension) => ({
    label: DIMENSION_LABELS[dimension],
    value: profile.current[dimension],
  })).sort((a, b) => {
    if (a.value === null && b.value === null) return 0
    if (a.value === null) return 1
    if (b.value === null) return -1
    return b.value - a.value
  })

  const labelWidth = Math.max(...rows.map((row) => row.label.length))

  return [
    'DRIVING SKILL PROFILE',
    ...rows.map(
      (row) =>
        `${row.label.padEnd(labelWidth + 2)}${row.value === null ? '—' : Math.round(row.value)}`,
    ),
  ].join('\n')
}
