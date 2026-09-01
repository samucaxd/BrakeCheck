/**
 * Driving Skill Profile — RF-404, RF-405 e TC-405 do PRD §10.4.
 */

import { describe, expect, it } from 'vitest'

import { formatSkillProfile } from '../../src/evaluation/format.js'
import {
  DIMENSION_SOURCES,
  computeDimensions,
  emptyProfile,
  updateProfile,
  weakestDimension,
} from '../../src/evaluation/skill-profile.js'
import { SKILL_DIMENSIONS } from '../../src/evaluation/types.js'
import type { ScoreResult } from '../../src/evaluation/types.js'
import { CATALOG } from '../../src/training/catalog.js'

function result(exerciseId: string, value: number, subScoreId = 'aplicacao_inicial'): ScoreResult {
  return {
    attemptRef: `${exerciseId}-a1`,
    exerciseId,
    subScores: [{ id: subScoreId as never, value, describes: 'teste', observed: value }],
    totalScore: value,
    level: 'gold',
  }
}

describe('mapeamento exercício → dimensão (RF-404)', () => {
  it('cobre as 7 dimensões do PRD §8', () => {
    expect(Object.keys(DIMENSION_SOURCES).sort()).toEqual([...SKILL_DIMENSIONS].sort())
  })

  it('todo exercício mapeado existe no catálogo', () => {
    // Um id errado aqui apagaria silenciosamente a contribuição do exercício
    // para a dimensão, e o perfil ficaria sistematicamente incompleto.
    const ids = new Set(CATALOG.map((exercise) => exercise.id))
    for (const [dimension, sources] of Object.entries(DIMENSION_SOURCES)) {
      for (const source of sources) {
        expect(ids.has(source), `${dimension} → ${source}`).toBe(true)
      }
    }
  })

  it('todo exercício alimenta ao menos uma dimensão', () => {
    const mapped = new Set(Object.values(DIMENSION_SOURCES).flat())
    for (const exercise of CATALOG) {
      expect(mapped.has(exercise.id), exercise.id).toBe(true)
    }
  })
})

describe('computeDimensions (RF-404)', () => {
  it('faz a média dos sub-scores dos exercícios que alimentam a dimensão', () => {
    const dimensions = computeDimensions([
      result('fund-01-controle-pedal', 80, 'controle_pressao'),
      result('fund-02-aplicacao-progressiva', 60),
    ])

    expect(dimensions.brakeControl).toBeCloseTo(70, 6)
  })

  it('dimensão sem exercício tentado fica null, nunca 0', () => {
    // Zero significaria "desempenho ruim"; ausência de dado é outra coisa, e
    // confundi-las faria o coach recomendar treino para uma fraqueza inexistente.
    const dimensions = computeDimensions([result('fund-01-controle-pedal', 80, 'controle_pressao')])

    expect(dimensions.brakeControl).not.toBeNull()
    expect(dimensions.trailBraking).toBeNull()
    expect(dimensions.throttleControl).toBeNull()
  })

  it('o sub-score "Consistência" alimenta a dimensão Consistency venha de onde vier', () => {
    // A skill §5 determina isso explicitamente: não é só o exercício dedicado.
    const dimensions = computeDimensions([
      result('int-01-threshold-braking', 70, 'consistencia'),
    ])

    expect(dimensions.consistency).toBeCloseTo(70, 6)
  })

  it('ignora sub-scores null na média', () => {
    const withNull: ScoreResult = {
      attemptRef: 'x',
      exerciseId: 'fund-01-controle-pedal',
      subScores: [
        { id: 'controle_pressao', value: 90, describes: '', observed: 90 },
        { id: 'aplicacao_inicial', value: null, describes: '', observed: null },
      ],
      totalScore: 90,
      level: 'master',
    }

    expect(computeDimensions([withNull]).brakeControl).toBeCloseTo(90, 6)
  })
})

describe('updateProfile (RF-405, TC-405)', () => {
  it('TC-405: cada atualização acrescenta um ponto, sem sobrescrever o anterior', () => {
    let profile = emptyProfile()
    expect(profile.history).toHaveLength(0)

    profile = updateProfile(profile, [result('fund-01-controle-pedal', 60, 'controle_pressao')], 1000)
    expect(profile.history).toHaveLength(1)
    expect(profile.current.brakeControl).toBeCloseTo(60, 6)

    profile = updateProfile(profile, [result('fund-01-controle-pedal', 85, 'controle_pressao')], 2000)
    expect(profile.history).toHaveLength(2)
    expect(profile.current.brakeControl).toBeCloseTo(85, 6)

    // O ponto antigo continua íntegro — é a evolução ao longo do tempo que o
    // RF-405 exige, e a única coisa aqui que não é recalculável se for perdida.
    expect(profile.history[0]!.values.brakeControl).toBeCloseTo(60, 6)
    expect(profile.history[0]!.timestamp).toBe(1000)
    expect(profile.history[1]!.timestamp).toBe(2000)
  })

  it('não muta o perfil recebido', () => {
    const original = emptyProfile()
    const updated = updateProfile(original, [result('fund-01-controle-pedal', 70, 'controle_pressao')], 1)

    expect(original.history).toHaveLength(0)
    expect(original.current.brakeControl).toBeNull()
    expect(updated).not.toBe(original)
  })

  it('dimensão não treinada na sessão preserva o valor anterior', () => {
    // Não ter treinado trail braking hoje não apaga o que o piloto já mostrou.
    let profile = emptyProfile()
    profile = updateProfile(profile, [result('adv-01-trail-braking', 55, 'liberacao')], 1000)
    expect(profile.current.trailBraking).toBeCloseTo(55, 6)

    profile = updateProfile(profile, [result('fund-01-controle-pedal', 90, 'controle_pressao')], 2000)

    expect(profile.current.trailBraking).toBeCloseTo(55, 6)
    expect(profile.current.brakeControl).toBeCloseTo(90, 6)
    // E o ponto do histórico registra o estado do perfil, não só o que a
    // sessão mediu.
    expect(profile.history[1]!.values.trailBraking).toBeCloseTo(55, 6)
  })
})

describe('weakestDimension (base para RN-05)', () => {
  it('aponta a dimensão de menor pontuação', () => {
    let profile = emptyProfile()
    profile = updateProfile(
      profile,
      [
        result('fund-01-controle-pedal', 80, 'controle_pressao'),
        result('adv-01-trail-braking', 45, 'liberacao'),
        result('int-04-liberacao-progressiva', 70, 'liberacao'),
      ],
      1000,
    )

    expect(weakestDimension(profile)).toBe('trailBraking')
  })

  it('ignora dimensões sem dado', () => {
    // O erro que a distinção null × 0 existe para evitar: recomendar treino
    // para a fraqueza que ninguém mediu.
    let profile = emptyProfile()
    profile = updateProfile(profile, [result('fund-01-controle-pedal', 80, 'controle_pressao')], 1000)

    expect(weakestDimension(profile)).toBe('brakeControl')
  })

  it('perfil vazio não tem ponto mais fraco', () => {
    expect(weakestDimension(emptyProfile())).toBeNull()
  })
})

describe('formato de exibição RN-02', () => {
  it('lista as dimensões da mais forte para a mais fraca', () => {
    let profile = emptyProfile()
    profile = updateProfile(
      profile,
      [
        result('fund-01-controle-pedal', 76, 'controle_pressao'),
        result('int-01-threshold-braking', 82, 'aplicacao_inicial'),
        result('adv-01-trail-braking', 58, 'liberacao'),
      ],
      1000,
    )

    const lines = formatSkillProfile(profile).split('\n')

    expect(lines[0]).toBe('DRIVING SKILL PROFILE')
    expect(lines[1]).toContain('Threshold Braking')
    expect(lines[1]).toContain('82')
    expect(lines[2]).toContain('Brake Control')
    expect(lines[3]).toContain('Trail Braking')
  })

  it('dimensões sem dado vão para o fim, com travessão', () => {
    // Ordená-las como zero criaria a leitura falsa de "pior habilidade".
    let profile = emptyProfile()
    profile = updateProfile(profile, [result('fund-01-controle-pedal', 76, 'controle_pressao')], 1000)

    const lines = formatSkillProfile(profile).split('\n')

    expect(lines[1]).toContain('Brake Control')
    expect(lines[lines.length - 1]).toContain('—')
  })
})
