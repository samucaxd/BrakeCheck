/**
 * Geração de feedback estruturado (RF-501, RF-502, RN-04).
 *
 * A RN-04 fixa a sequência de três partes, sem pular nem inverter:
 *
 *   1. o que foi observado nos dados — fato com número, não impressão
 *   2. qual o impacto técnico disso
 *   3. o que tentar na próxima tentativa — ação executável
 *
 * **Por que templates e não um modelo de linguagem.** A `coach-engine` §6 admite
 * as duas abordagens, mas o RNF-11 proíbe transmitir qualquer dado de
 * telemetria, sessão ou Skill Profile para servidores externos, e o RNF-05 exige
 * funcionamento local. Isso descarta um LLM na nuvem. Templates determinísticos
 * ainda têm uma vantagem sobre um modelo local: o texto é **verificável contra o
 * número que o originou**, que é exatamente o que o TC-501 cobra — o teste
 * compara a frase com o valor bruto, não com "parece razoável".
 *
 * **Onde esta camada para:** ela não recalcula nada. Todo número vem do
 * `ScoreResult` já pronto. Se um valor parecer errado, o bug está na
 * `evaluation-scoring-engine`.
 */

import type { ScoreResult, SubScore } from '../evaluation/types.js'
import type { Exercise, SubScoreDefinition, SubScoreId } from '../training/types.js'
import { CONSISTENCY_VOCABULARY, METRIC_VOCABULARY } from './vocabulary.js'
import type { MetricVocabulary } from './vocabulary.js'

export type FeedbackTone = 'correcao' | 'consolidacao' | 'sem_dado'

export interface CoachFeedback {
  /** Sub-score que motivou o feedback — o mais baixo da tentativa. */
  focus: SubScoreId | null
  /** Parte 1 da RN-04. */
  observation: string
  /** Parte 2 da RN-04. */
  impact: string
  /** Parte 3 da RN-04. */
  action: string
  /** As três partes costuradas, na ordem obrigatória. */
  text: string
  /** Valor bruto que originou a observação. Permite testar o texto contra o dado. */
  observedValue: number | null
  tone: FeedbackTone
}

/** Acima disso, o sub-score não é problema a corrigir e sim ponto a consolidar. */
const CONSOLIDATION_THRESHOLD = 90

function vocabularyFor(definition: SubScoreDefinition): MetricVocabulary {
  return definition.spec.formula === 'consistency'
    ? CONSISTENCY_VOCABULARY
    : METRIC_VOCABULARY[definition.spec.metric]
}

/**
 * Descreve o alvo e diz para que lado o valor precisa se mover.
 *
 * `direction` é `null` quando o valor já está onde deveria — nesse caso a ação
 * vira consolidação, não correção.
 */
function targetOf(
  definition: SubScoreDefinition,
  observed: number,
  vocabulary: MetricVocabulary,
): { description: string; direction: 'increase' | 'decrease' | null } {
  const spec = definition.spec

  switch (spec.formula) {
    case 'target_range': {
      const [low, high] = spec.range
      const description = `a faixa ideal é ${vocabulary.format(low)} a ${vocabulary.format(high)}`
      if (observed < low) return { description, direction: 'increase' }
      if (observed > high) return { description, direction: 'decrease' }
      return { description, direction: null }
    }
    case 'proportion': {
      const description = `o alvo é ${vocabulary.format(spec.required)}`
      return { description, direction: observed < spec.required ? 'increase' : null }
    }
    case 'target_value': {
      const description = `o alvo é ${vocabulary.format(spec.target)}`
      if (observed > spec.target) return { description, direction: 'decrease' }
      if (observed < spec.target) return { description, direction: 'increase' }
      return { description, direction: null }
    }
    case 'correlation': {
      const description = `o alvo é uma relação de ao menos ${spec.minAbsolute.toFixed(2)} em magnitude`
      return {
        description,
        direction: Math.abs(observed) < spec.minAbsolute ? 'increase' : null,
      }
    }
    case 'consistency': {
      const description = `o aceitável é até ${vocabulary.format(spec.maxCoefficientOfVariation)}`
      return {
        description,
        direction: observed > spec.maxCoefficientOfVariation ? 'decrease' : null,
      }
    }
  }
}

/** O sub-score mais baixo da tentativa — o assunto do feedback (skill §1, passo 1). */
function lowestSubScore(subScores: readonly SubScore[]): SubScore | null {
  let lowest: SubScore | null = null
  for (const subScore of subScores) {
    if (subScore.value === null) continue
    if (lowest === null || subScore.value < lowest.value!) lowest = subScore
  }
  return lowest
}

function join(observation: string, impact: string, action: string): string {
  return `${observation} ${impact} ${action}`
}

/**
 * RF-501/RF-502 — feedback de uma tentativa.
 *
 * Genérico por construção é impossível aqui: a parte 1 sempre interpola o valor
 * bruto **daquela** tentativa. Duas tentativas com o mesmo score agregado, mas
 * causas técnicas diferentes, têm sub-scores baixos diferentes e valores brutos
 * diferentes — logo textos diferentes (TC-502).
 */
export function generateFeedback(exercise: Exercise, score: ScoreResult): CoachFeedback {
  const lowest = lowestSubScore(score.subScores)

  /**
   * Nenhum sub-score mensurável: a tentativa não produziu dado.
   *
   * Dizer "sua frenagem foi lenta" aqui seria inventar um fato. O honesto é
   * nomear a ausência — e é por isso que a camada de scoring preserva a
   * distinção entre `null` e zero.
   */
  if (lowest === null || lowest.observed === null) {
    const observation =
      'Esta tentativa não registrou uma frenagem mensurável — nenhuma métrica do exercício pôde ser calculada.'
    const impact = exercise.explanation
    const action = `Na próxima, execute a frenagem descrita: ${exercise.instructions}`
    return {
      focus: lowest?.id ?? null,
      observation,
      impact,
      action,
      text: join(observation, impact, action),
      observedValue: null,
      tone: 'sem_dado',
    }
  }

  const definition = exercise.scoringRules.subScores.find((d) => d.id === lowest.id)!
  const vocabulary = vocabularyFor(definition)
  const observed = lowest.observed
  const { description, direction } = targetOf(definition, observed, vocabulary)

  const observation = `${capitalize(vocabulary.subject)} nesta tentativa foi ${vocabulary.format(observed)} — ${description}.`
  const impact = exercise.explanation

  /**
   * Sub-score alto e dentro do alvo: o feedback vira consolidação em vez de
   * inventar um defeito. Ainda respeita as três partes da RN-04 — observar,
   * explicar por que importa, e dizer o que fazer a seguir.
   */
  if (direction === null && lowest.value !== null && lowest.value >= CONSOLIDATION_THRESHOLD) {
    const action = `Mantenha essa referência e repita o mesmo gesto nas próximas tentativas para consolidá-la.`
    return {
      focus: lowest.id,
      observation,
      impact,
      action,
      text: join(observation, impact, action),
      observedValue: observed,
      tone: 'consolidacao',
    }
  }

  const action = `Na próxima tentativa, ${direction === 'increase' ? vocabulary.increase : vocabulary.decrease}.`

  return {
    focus: lowest.id,
    observation,
    impact,
    action,
    text: join(observation, impact, action),
    observedValue: observed,
    tone: direction === null ? 'consolidacao' : 'correcao',
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
