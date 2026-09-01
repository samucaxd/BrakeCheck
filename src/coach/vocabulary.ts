/**
 * Vocabulário do coach: como cada métrica é nomeada, formatada e corrigida.
 *
 * É o que transforma um número em uma instrução executável. Cada entrada
 * responde três perguntas que a RN-04 exige: **o quê** foi medido (`subject`),
 * **quanto** foi (`format`), e **o que fazer** para corrigir em cada direção
 * (`increase`/`decrease`).
 *
 * As ações são frases físicas — "solte o pedal mais devagar" —, nunca
 * "melhore sua liberação". A parte 3 da RN-04 pede ação concreta e executável;
 * repetir o nome da métrica em modo imperativo não é uma ação.
 */

import type { ScorableMetric } from '../training/types.js'

export interface MetricVocabulary {
  /** Sujeito da frase de observação. */
  subject: string
  /** Como o valor bruto é exibido, com unidade. */
  format: (value: number) => string
  /** Ação quando o valor precisa aumentar. */
  increase: string
  /** Ação quando o valor precisa diminuir. */
  decrease: string
}

const ms = (value: number): string => `${Math.round(value)}ms`
const pctPerS = (value: number): string => `${Math.round(value)} %/s`
const pct = (value: number): string => `${Math.round(value)}%`
const fraction = (value: number): string => `${Math.round(value * 100)}%`

export const METRIC_VOCABULARY: Readonly<Record<ScorableMetric, MetricVocabulary>> = {
  applicationSpeed: {
    subject: 'sua velocidade de aplicação do freio',
    format: pctPerS,
    increase: 'ataque o pedal com mais decisão no início da frenagem',
    decrease: 'construa a pressão de forma mais gradual, sem chutar o pedal',
  },
  releaseSpeed: {
    subject: 'sua velocidade de liberação do freio',
    format: pctPerS,
    increase: 'libere o pedal com mais fluidez, sem ficar preso nele',
    decrease: 'solte o pedal de forma mais progressiva, aliviando aos poucos',
  },
  peakValue: {
    subject: 'seu pico de pressão no pedal',
    format: pct,
    increase: 'busque um pico mais alto, confiando um pouco mais no limite',
    decrease: 'alivie o pico, você está passando do ponto útil',
  },
  timeToPeak: {
    subject: 'seu tempo até a pressão máxima',
    format: ms,
    increase: 'demore um pouco mais para chegar ao pico',
    decrease: 'chegue ao pico mais cedo dentro da frenagem',
  },
  brakeMax: {
    subject: 'o curso máximo que você usou do pedal',
    format: pct,
    increase: 'use mais do curso disponível do pedal',
    decrease: 'reduza o curso máximo usado',
  },
  pressureRangeMs: {
    subject: 'seu tempo dentro da faixa-alvo',
    format: ms,
    increase: 'segure o pedal parado dentro da faixa por mais tempo',
    decrease: 'reduza o tempo na faixa',
  },
  eventBandCoverage: {
    subject: 'a fração da frenagem que você sustentou dentro da faixa de threshold',
    format: fraction,
    increase: 'sustente a pressão na faixa por mais tempo, em vez de só encostar nela',
    decrease: 'reduza o tempo sustentado nessa faixa',
  },
  worstSubBandCoverage: {
    subject: 'sua cobertura na sub-faixa em que você menos acertou',
    format: fraction,
    increase: 'antecipe a mudança de pressão para chegar na próxima faixa antes',
    decrease: 'reduza o tempo nessa sub-faixa',
  },
  steeringRangeDuringBraking: {
    subject: 'a variação do volante durante a frenagem',
    format: (value) => `${Math.round(value)} pontos`,
    increase: 'permita mais movimento de volante',
    decrease: 'mantenha as mãos firmes e o volante parado enquanto freia',
  },
  reactionDelta: {
    subject: 'seu atraso entre o marcador e o início da frenagem',
    format: ms,
    increase: 'espere um pouco mais antes de frear',
    decrease: 'antecipe o movimento do pé, começando a frear assim que o marcador aparecer',
  },
  stabilizationInterval: {
    subject: 'seu intervalo entre o pico de freio e o esterçamento',
    format: ms,
    increase: 'espere o carro assentar antes de começar a girar o volante',
    decrease: 'reduza a espera entre o pico e a entrada da curva',
  },
  brakeSteeringOverlap: {
    subject: 'sua sobreposição entre freio residual e volante',
    format: ms,
    increase: 'comece a girar o volante enquanto ainda solta o freio, sem soltá-lo todo antes',
    decrease: 'termine a liberação um pouco mais cedo em relação ao esterçamento',
  },
  brakeThrottleOverlap: {
    subject: 'sua sobreposição entre freio e acelerador',
    format: ms,
    increase: 'sobreponha um pouco mais os dois pedais',
    decrease: 'termine de soltar o freio antes de começar a acelerar',
  },
  brakeSteeringCorrelation: {
    subject: 'a relação entre o freio residual e o ângulo do volante',
    format: (value) => value.toFixed(2),
    increase: 'reduza o freio de forma proporcional conforme o volante gira mais',
    decrease: 'mantenha o freio mais estável em relação ao ângulo',
  },
  profileDeviation: {
    subject: 'seu desvio médio em relação ao perfil-alvo',
    format: (value) => `${value.toFixed(1)} pontos percentuais`,
    increase: 'permita mais desvio do perfil',
    decrease: 'acompanhe o perfil-alvo mais de perto ao longo da frenagem',
  },
}

/** Vocabulário do sub-score de consistência, cuja métrica é o CV do bloco. */
export const CONSISTENCY_VOCABULARY: MetricVocabulary = {
  subject: 'a variação entre as suas tentativas',
  format: (value) => `${Math.round(value * 100)}%`,
  increase: 'varie mais entre as tentativas',
  decrease: 'busque repetir o mesmo gesto em todas as tentativas, sem mudar a referência',
}
