/**
 * Feedback do coach — RN-04, RF-501, RF-502, e TC-501/TC-502 do PRD §10.5.
 *
 * O PRD §12 chama feedback genérico de "o maior risco de qualidade percebida do
 * produto". Estes testes existem para que "não é genérico" seja uma propriedade
 * verificada contra o dado que originou a frase, e não uma impressão de leitura.
 */

import { describe, expect, it } from 'vitest'

import { generateFeedback } from '../../src/coach/feedback.js'
import { scoreAttempt } from '../../src/evaluation/score-attempt.js'
import { findExercise } from '../../src/training/catalog.js'
import { computeExerciseMetrics } from '../../src/training/exercise-metrics.js'
import type { Exercise } from '../../src/training/types.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'
import { brakingTrace, metricsFor } from '../helpers/traces.js'

const progressiva = findExercise('fund-02-aplicacao-progressiva')!
const liberacao = findExercise('int-04-liberacao-progressiva')!
const controlePedal = findExercise('fund-01-controle-pedal')!

function feedbackFor(exercise: Exercise, samples: readonly TelemetrySample[]) {
  const metrics = metricsFor(samples, exercise.pressureBand)
  const exerciseMetrics = computeExerciseMetrics({ samples, metrics })
  const score = scoreAttempt({
    attemptRef: 'a1',
    exercise,
    metrics,
    exerciseMetrics,
    samples,
    blockMetrics: [metrics],
  })
  return { feedback: generateFeedback(exercise, score), score }
}

describe('estrutura obrigatória do feedback (RN-04)', () => {
  it('tem as três partes, na ordem: observação → impacto → ação', () => {
    const { feedback } = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }),
    )

    expect(feedback.observation).toBeTruthy()
    expect(feedback.impact).toBeTruthy()
    expect(feedback.action).toBeTruthy()

    // A ordem importa: a RN-04 proíbe pular ou inverter partes.
    expect(feedback.text.indexOf(feedback.observation)).toBe(0)
    expect(feedback.text.indexOf(feedback.impact)).toBeGreaterThan(
      feedback.text.indexOf(feedback.observation),
    )
    expect(feedback.text.indexOf(feedback.action)).toBeGreaterThan(
      feedback.text.indexOf(feedback.impact),
    )
  })

  it('a parte 2 usa a explicação técnica do catálogo, sem duplicar conhecimento', () => {
    // A skill §1 passo 3 é explícita: o `explanation` do exercício já existe
    // para isso.
    const { feedback } = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }),
    )
    expect(feedback.impact).toBe(progressiva.explanation)
  })

  it('a ação é física e executável, não o nome da métrica no imperativo', () => {
    const { feedback } = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }),
    )
    expect(feedback.action).toContain('Na próxima tentativa')
    expect(feedback.action.toLowerCase()).toContain('pedal')
  })
})

describe('TC-501: o padrão observado aparece no texto, com o número real', () => {
  it('aplicação abrupta é nomeada com a velocidade medida', () => {
    const samples = brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 })
    const { feedback, score } = feedbackFor(progressiva, samples)

    const observed = score.subScores[0]!.observed!
    // O teste compara a frase com o valor bruto que a originou — é essa
    // amarração que impede o texto de descolar do dado.
    expect(feedback.observedValue).toBeCloseTo(observed, 6)
    expect(feedback.observation).toContain(`${Math.round(observed)} %/s`)
    // E traz o alvo, para o piloto saber de quanto está longe.
    expect(feedback.observation).toContain('150')
    expect(feedback.observation).toContain('350')
  })

  it('liberação abrupta gera ação na direção de soltar mais devagar', () => {
    const samples = brakingTrace({ peak: 90, riseMs: 300, holdMs: 200, fallMs: 60 })
    const { feedback } = feedbackFor(liberacao, samples)

    expect(feedback.tone).toBe('correcao')
    expect(feedback.action).toContain('progressiva')
  })

  it('aplicação hesitante gera ação na direção OPOSTA à da abrupta', () => {
    // A mesma métrica fora da faixa pelos dois lados precisa gerar correções
    // opostas — senão o feedback estaria olhando só o score, não o valor.
    const abrupta = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 50, holdMs: 200, fallMs: 400 }),
    ).feedback
    const hesitante = feedbackFor(
      progressiva,
      brakingTrace({ peak: 40, riseMs: 900, holdMs: 200, fallMs: 400 }),
    ).feedback

    expect(abrupta.action).not.toBe(hesitante.action)
    expect(abrupta.action).toContain('gradual')
    expect(hesitante.action).toContain('decisão')
  })
})

describe('TC-502: mesmo score, causas diferentes → textos diferentes', () => {
  it('duas tentativas com o mesmo score agregado geram feedbacks distintos', () => {
    // Aplicação lenta demais e rápida demais podem cair no mesmo score pela
    // simetria da fórmula de faixa-alvo. Se o texto fosse derivado do score, os
    // dois sairiam idênticos — que é exatamente o bug que este cenário caça.
    const rapida = feedbackFor(
      progressiva,
      brakingTrace({ peak: 90, riseMs: 200, holdMs: 200, fallMs: 400 }),
    )
    const lenta = feedbackFor(
      progressiva,
      brakingTrace({ peak: 45, riseMs: 500, holdMs: 200, fallMs: 400 }),
    )

    expect(rapida.feedback.text).not.toBe(lenta.feedback.text)
    expect(rapida.feedback.observedValue).not.toBe(lenta.feedback.observedValue)
  })

  it('exercícios diferentes com a mesma nota falam de coisas diferentes', () => {
    const aplicacao = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }),
    )
    const release = feedbackFor(
      liberacao,
      brakingTrace({ peak: 90, riseMs: 300, holdMs: 200, fallMs: 600 }),
    )

    expect(aplicacao.score.totalScore).toBe(release.score.totalScore)
    expect(aplicacao.feedback.text).not.toBe(release.feedback.text)
    expect(aplicacao.feedback.observation).toContain('aplicação')
    expect(release.feedback.observation).toContain('liberação')
  })

  it('o feedback muda quando só o valor bruto muda', () => {
    // Duas tentativas abruptas, ambas com score 0, mas com graus diferentes de
    // abruptez: o texto tem que refletir isso.
    const a = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 40, holdMs: 200, fallMs: 400 }),
    ).feedback
    const b = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 20, holdMs: 200, fallMs: 400 }),
    ).feedback

    expect(a.observedValue).not.toBe(b.observedValue)
    expect(a.observation).not.toBe(b.observation)
  })
})

describe('casos em que não há defeito a apontar', () => {
  it('tentativa dentro do alvo vira consolidação, não um defeito inventado', () => {
    const { feedback } = feedbackFor(
      progressiva,
      brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }),
    )

    expect(feedback.tone).toBe('consolidacao')
    // Continua respeitando as três partes da RN-04.
    expect(feedback.observation).toBeTruthy()
    expect(feedback.impact).toBe(progressiva.explanation)
    expect(feedback.action).toContain('Mantenha')
  })

  it('tentativa sem frenagem nomeia a ausência, não inventa um número', () => {
    // Dizer "sua frenagem foi lenta" aqui seria afirmar um fato que não existe.
    const flat: TelemetrySample[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 10,
      brake: 0,
      throttle: 0,
      steering: 0,
    }))
    const { feedback } = feedbackFor(progressiva, flat)

    expect(feedback.tone).toBe('sem_dado')
    expect(feedback.observedValue).toBeNull()
    expect(feedback.observation).toContain('não registrou')
    expect(feedback.action).toContain(progressiva.instructions)
  })
})

describe('o feedback acompanha o sub-score mais baixo, não o agregado', () => {
  it('escolhe o pior sub-score como assunto', () => {
    // Exercício com dois sub-scores: um perfeito, um ruim. O assunto tem que
    // ser o ruim (skill §1, passo 1).
    const linhaReta = findExercise('fund-03-frenagem-linha-reta')!
    const samples = brakingTrace({
      peak: 80,
      riseMs: 300,
      holdMs: 200,
      fallMs: 400,
      steeringAt: (t) => (t > 300 ? 60 : 0), // volante muito instável
    })

    const { feedback, score } = feedbackFor(linhaReta, samples)

    const aplicacao = score.subScores.find((s) => s.id === 'aplicacao_inicial')!
    const direcional = score.subScores.find((s) => s.id === 'consistencia_direcional')!
    expect(direcional.value!).toBeLessThan(aplicacao.value!)
    expect(feedback.focus).toBe('consistencia_direcional')
    expect(feedback.observation).toContain('volante')
  })

  it('sub-score de tempo em faixa é narrado em ms, com o alvo', () => {
    const samples = brakingTrace({ peak: 35, riseMs: 200, holdMs: 900, fallMs: 300 })
    const { feedback } = feedbackFor(controlePedal, samples)

    expect(feedback.observation).toContain('ms')
    expect(feedback.observation).toContain('2500ms')
    expect(feedback.action).toContain('faixa')
  })
})
