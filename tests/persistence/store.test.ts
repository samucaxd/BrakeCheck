/**
 * Cenários do PRD §10.6 (Sessions & Persistence).
 *
 * Rodam contra SQLite de verdade (`:memory:` ou arquivo temporário), não contra
 * mock: o que está sendo testado aqui é justamente o comportamento do banco —
 * atomicidade de transação, constraints, recuperação no boot. Um mock testaria
 * a minha suposição sobre o SQLite em vez do SQLite.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BrakeCheckStore } from '../../src/persistence/store.js'
import { emptyProfile, updateProfile } from '../../src/evaluation/skill-profile.js'
import type { ScoreResult } from '../../src/evaluation/types.js'
import type { TelemetrySample } from '../../src/shared/contracts.js'
import { brakingTrace, metricsFor } from '../helpers/traces.js'

const METRICS = metricsFor(brakingTrace({ peak: 80, riseMs: 300, holdMs: 200, fallMs: 400 }))

function scoreOf(exerciseId: string, total: number): ScoreResult {
  return {
    attemptRef: 'ref',
    exerciseId,
    subScores: [
      { id: 'aplicacao_inicial', value: total, describes: 'teste', observed: total },
    ],
    totalScore: total,
    level: 'gold',
  }
}

function samples(count = 5): TelemetrySample[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 10,
    brake: i * 10,
    throttle: 0,
    steering: 0,
  }))
}

describe('BrakeCheckStore — ciclo de vida (RF-601, TC-601)', () => {
  let store: BrakeCheckStore

  beforeEach(() => {
    store = new BrakeCheckStore({ path: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('TC-601: criar → pausar → retomar → finalizar preserva o estado a cada passo', () => {
    const session = store.createSession('G29', 1000)
    expect(session.status).toBe('active')
    expect(session.startTime).toBe(1000)
    expect(session.endTime).toBeNull()
    expect(session.deviceInfo).toBe('G29')

    store.pauseSession(session.id)
    expect(store.getSession(session.id)!.status).toBe('paused')

    store.resumeSession(session.id)
    expect(store.getSession(session.id)!.status).toBe('active')

    store.finishSession(session.id, 5000)
    const finished = store.getSession(session.id)!
    expect(finished.status).toBe('finished')
    expect(finished.endTime).toBe(5000)
  })

  it('pausar mantém as tentativas já persistidas', () => {
    const session = store.createSession(undefined, 1000)
    store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-01-controle-pedal',
      timestamp: 1100,
      derivedMetrics: METRICS,
      samples: samples(),
    })

    store.pauseSession(session.id)
    expect(store.listAttempts(session.id)).toHaveLength(1)

    store.resumeSession(session.id)
    store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-01-controle-pedal',
      timestamp: 1200,
      derivedMetrics: METRICS,
      samples: samples(),
    })
    // Retomar continua no mesmo session_id, não abre outra sessão.
    expect(store.listAttempts(session.id)).toHaveLength(2)
  })

  it('rejeita transições inválidas em vez de aceitar em silêncio', () => {
    const session = store.createSession()

    expect(() => store.resumeSession(session.id)).toThrow() // já ativa
    store.finishSession(session.id)
    expect(() => store.pauseSession(session.id)).toThrow() // já finalizada
    expect(() => store.pauseSession(9999)).toThrow() // não existe
  })

  it('finalizar duas vezes é idempotente, não erro', () => {
    const session = store.createSession(undefined, 1000)
    store.finishSession(session.id, 5000)
    store.finishSession(session.id, 9999)
    expect(store.getSession(session.id)!.endTime).toBe(5000)
  })

  it('as chaves estrangeiras são realmente aplicadas', () => {
    // O SQLite não aplica REFERENCES por padrão. Sem o pragma, uma tentativa
    // órfã entraria calada e só apareceria como sessão vazia no histórico.
    expect(() =>
      store.saveAttempt({
        sessionId: 9999,
        exerciseId: 'x',
        timestamp: 1,
        derivedMetrics: METRICS,
        samples: samples(),
      }),
    ).toThrow()
  })
})

describe('BrakeCheckStore — escrita incremental (RF-605, RNF-08)', () => {
  let store: BrakeCheckStore

  beforeEach(() => {
    store = new BrakeCheckStore({ path: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('a tentativa e suas amostras entram na mesma transação', () => {
    const session = store.createSession()
    const attemptId = store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-02-aplicacao-progressiva',
      timestamp: 2000,
      derivedMetrics: METRICS,
      samples: samples(300),
    })

    expect(store.getSamples(attemptId)).toHaveLength(300)
    expect(store.listAttempts(session.id)).toHaveLength(1)
  })

  it('as métricas derivadas sobrevivem à ida e volta do JSON', () => {
    const session = store.createSession()
    const attemptId = store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-02-aplicacao-progressiva',
      timestamp: 2000,
      derivedMetrics: METRICS,
      samples: samples(),
    })

    const stored = store.listAttempts(session.id)[0]!
    expect(stored.id).toBe(attemptId)
    expect(stored.derivedMetrics).toEqual(METRICS)
    // E os null continuam null — não viram 0 nem undefined na serialização.
    expect(stored.derivedMetrics.brakingEvents[0]!.truncated).toBe(false)
  })

  it('score e feedback entram depois, sem reescrever a tentativa', () => {
    const session = store.createSession()
    const attemptId = store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-02-aplicacao-progressiva',
      timestamp: 2000,
      derivedMetrics: METRICS,
      samples: samples(),
    })

    // A tentativa é gravada assim que termina; scoring e coach vêm depois.
    expect(store.listAttempts(session.id)[0]!.scoreResult).toBeNull()

    store.setAttemptScore(attemptId, scoreOf('fund-02-aplicacao-progressiva', 82))
    store.setAttemptFeedback(attemptId, {
      focus: 'aplicacao_inicial',
      observation: 'obs',
      impact: 'impacto',
      action: 'ação',
      text: 'obs impacto ação',
      observedValue: 265,
      tone: 'correcao',
    })

    const stored = store.listAttempts(session.id)[0]!
    expect(stored.scoreResult!.totalScore).toBe(82)
    expect(stored.feedback!.observedValue).toBe(265)
    expect(stored.derivedMetrics).toEqual(METRICS)
  })

  it('amostras só são buscadas sob demanda, não junto com a tentativa', () => {
    const session = store.createSession()
    store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'x',
      timestamp: 1,
      derivedMetrics: METRICS,
      samples: samples(100),
    })

    const attempt = store.listAttempts(session.id)[0]!
    expect(Object.keys(attempt)).not.toContain('samples')
    expect(store.getSamples(attempt.id)).toHaveLength(100)
  })
})

describe('BrakeCheckStore — recuperação de sessão órfã (TC-602)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brakecheck-'))
    dbPath = join(dir, 'test.db')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('TC-602: sessão ativa em encerramento abrupto reabre como incompleta, com dados íntegros', () => {
    // Primeira execução: grava tentativas e "morre" sem finalizar a sessão.
    const first = new BrakeCheckStore({ path: dbPath })
    const session = first.createSession('G29', 1000)
    first.saveAttempt({
      sessionId: session.id,
      exerciseId: 'fund-01-controle-pedal',
      timestamp: 1100,
      derivedMetrics: METRICS,
      samples: samples(50),
    })
    first.close() // sem finishSession — é o que um crash deixa para trás

    // Segunda execução: o boot varre sessões órfãs.
    const second = new BrakeCheckStore({ path: dbPath })
    const recovered = second.getSession(session.id)!

    expect(recovered.status).toBe('incomplete')
    // As tentativas já concluídas continuam íntegras e consultáveis.
    const attempts = second.listAttempts(session.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.derivedMetrics).toEqual(METRICS)
    expect(second.getSamples(attempts[0]!.id)).toHaveLength(50)

    second.close()
  })

  it('sessão incompleta não é retomável nem finalizável', () => {
    const first = new BrakeCheckStore({ path: dbPath })
    const session = first.createSession()
    first.close()

    const second = new BrakeCheckStore({ path: dbPath })
    // "Continuar" algo que pode ter parado no meio de uma tentativa é ambíguo.
    expect(() => second.resumeSession(session.id)).toThrow()
    expect(() => second.finishSession(session.id)).toThrow()
    second.close()
  })

  it('sessão pausada também vira incompleta ao reabrir', () => {
    // Consequência conhecida da regra da skill: a pausa vale dentro da execução,
    // não sobrevive a fechar o app.
    const first = new BrakeCheckStore({ path: dbPath })
    const session = first.createSession()
    first.pauseSession(session.id)
    first.close()

    const second = new BrakeCheckStore({ path: dbPath })
    expect(second.getSession(session.id)!.status).toBe('incomplete')
    second.close()
  })

  it('sessão finalizada normalmente não é tocada pela recuperação', () => {
    const first = new BrakeCheckStore({ path: dbPath })
    const session = first.createSession(undefined, 1000)
    first.finishSession(session.id, 2000)
    first.close()

    const second = new BrakeCheckStore({ path: dbPath })
    const reopened = second.getSession(session.id)!
    expect(reopened.status).toBe('finished')
    expect(reopened.endTime).toBe(2000)
    second.close()
  })

  it('TC-903: sessões e Skill Profile sobrevivem ao reinício', () => {
    const first = new BrakeCheckStore({ path: dbPath })
    const session = first.createSession(undefined, 1000)
    first.finishSession(session.id, 2000)
    const profile = updateProfile(
      emptyProfile(),
      [scoreOf('fund-01-controle-pedal', 76)],
      2500,
    )
    first.appendSkillProfilePoint(profile.history[0]!)
    first.close()

    const second = new BrakeCheckStore({ path: dbPath })
    expect(second.countSessions()).toBe(1)
    expect(second.loadSkillProfile().history).toHaveLength(1)
    expect(second.loadSkillProfile().current.brakeControl).toBeCloseTo(76, 6)
    second.close()
  })
})

describe('BrakeCheckStore — histórico (RF-603, TC-604)', () => {
  let store: BrakeCheckStore

  beforeEach(() => {
    store = new BrakeCheckStore({ path: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('TC-604: listar 120 sessões não carrega tentativas nem amostras', () => {
    for (let i = 0; i < 120; i++) {
      const session = store.createSession(undefined, 1000 + i)
      store.saveAttempt({
        sessionId: session.id,
        exerciseId: 'fund-01-controle-pedal',
        timestamp: 1000 + i,
        derivedMetrics: METRICS,
        samples: samples(100),
      })
      store.finishSession(session.id, 2000 + i)
    }

    const startedAt = Date.now()
    const page = store.listSessions({ limit: 20 })
    const elapsed = Date.now() - startedAt

    expect(store.countSessions()).toBe(120)
    expect(page).toHaveLength(20)
    // A contagem vem agregada; as linhas de tentativa e amostra ficam no banco.
    expect(page[0]!.attemptsCount).toBe(1)
    expect(elapsed).toBeLessThan(1000)
  })

  it('ordena da mais recente para a mais antiga e pagina', () => {
    for (let i = 0; i < 5; i++) store.createSession(undefined, 1000 + i)

    const firstPage = store.listSessions({ limit: 2 })
    expect(firstPage.map((s) => s.startTime)).toEqual([1004, 1003])

    const secondPage = store.listSessions({ limit: 2, offset: 2 })
    expect(secondPage.map((s) => s.startTime)).toEqual([1002, 1001])
  })

  it('busca tentativas de um exercício ao longo de várias sessões', () => {
    for (let i = 0; i < 3; i++) {
      const session = store.createSession(undefined, 1000 + i)
      store.saveAttempt({
        sessionId: session.id,
        exerciseId: 'fund-02-aplicacao-progressiva',
        timestamp: 1000 + i,
        derivedMetrics: METRICS,
        samples: samples(),
      })
      store.saveAttempt({
        sessionId: session.id,
        exerciseId: 'outro',
        timestamp: 2000 + i,
        derivedMetrics: METRICS,
        samples: samples(),
      })
    }

    const attempts = store.listAttemptsForExercise('fund-02-aplicacao-progressiva')
    expect(attempts).toHaveLength(3)
    expect(attempts.map((a) => a.timestamp)).toEqual([1000, 1001, 1002])
  })
})

describe('BrakeCheckStore — comparação de sessões (RF-604, TC-603)', () => {
  let store: BrakeCheckStore

  beforeEach(() => {
    store = new BrakeCheckStore({ path: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  /** Sessão com tentativas pontuadas e um ponto de perfil ao final. */
  function seedSession(
    startTime: number,
    endTime: number,
    scores: Record<string, number[]>,
    profileValue: number,
  ): number {
    const session = store.createSession(undefined, startTime)
    let t = startTime
    for (const [exerciseId, values] of Object.entries(scores)) {
      for (const value of values) {
        const attemptId = store.saveAttempt({
          sessionId: session.id,
          exerciseId,
          timestamp: ++t,
          derivedMetrics: METRICS,
          samples: samples(),
        })
        store.setAttemptScore(attemptId, scoreOf(exerciseId, value))
      }
    }
    store.finishSession(session.id, endTime)
    store.appendSkillProfilePoint(
      updateProfile(emptyProfile(), [scoreOf('fund-01-controle-pedal', profileValue)], endTime)
        .history[0]!,
    )
    return session.id
  }

  it('TC-603: calcula a evolução por exercício entre duas sessões', () => {
    const a = seedSession(1000, 2000, { 'int-01-threshold-braking': [70, 72] }, 70)
    const b = seedSession(3000, 4000, { 'int-01-threshold-braking': [84, 84] }, 83)

    const comparison = store.compareSessions(a, b)

    expect(comparison.sessionA.id).toBe(a)
    expect(comparison.sessionA.attemptsCount).toBe(2)
    expect(comparison.sessionB.attemptsCount).toBe(2)

    const threshold = comparison.byExercise.find(
      (e) => e.exerciseId === 'int-01-threshold-braking',
    )!
    expect(threshold.avgScoreA).toBeCloseTo(71, 6)
    expect(threshold.avgScoreB).toBeCloseTo(84, 6)
    expect(threshold.delta).toBeCloseTo(13, 6)

    expect(comparison.skillProfileDelta.brakeControl).toBeCloseTo(13, 6)
  })

  it('exercício presente em só uma das sessões não vira delta zero', () => {
    // Delta zero significaria "não evoluiu"; ausência é outra coisa.
    const a = seedSession(1000, 2000, { 'exercicio-a': [60] }, 60)
    const b = seedSession(3000, 4000, { 'exercicio-b': [90] }, 90)

    const comparison = store.compareSessions(a, b)

    const onlyA = comparison.byExercise.find((e) => e.exerciseId === 'exercicio-a')!
    expect(onlyA.avgScoreA).toBe(60)
    expect(onlyA.avgScoreB).toBeNull()
    expect(onlyA.delta).toBeNull()
  })

  it('dimensão sem medição nos dois lados sai como sem dado', () => {
    const a = seedSession(1000, 2000, { 'int-01-threshold-braking': [70] }, 70)
    const b = seedSession(3000, 4000, { 'int-01-threshold-braking': [84] }, 83)

    const comparison = store.compareSessions(a, b)

    // Só brakeControl foi alimentado pelos pontos de perfil semeados.
    expect(comparison.skillProfileDelta.brakeControl).not.toBeNull()
    expect(comparison.skillProfileDelta.trailBraking).toBeNull()
    expect(comparison.skillProfileDelta.throttleControl).toBeNull()
  })

  it('sessão sem ponto de perfil correspondente não inventa delta', () => {
    const a = store.createSession(undefined, 1000)
    store.finishSession(a.id, 2000)
    const b = store.createSession(undefined, 3000)
    store.finishSession(b.id, 4000)

    const comparison = store.compareSessions(a.id, b.id)
    for (const value of Object.values(comparison.skillProfileDelta)) {
      expect(value).toBeNull()
    }
  })

  it('tentativas sem score não entram na média', () => {
    const session = store.createSession(undefined, 1000)
    const scored = store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'x',
      timestamp: 1001,
      derivedMetrics: METRICS,
      samples: samples(),
    })
    store.setAttemptScore(scored, scoreOf('x', 80))
    store.saveAttempt({
      sessionId: session.id,
      exerciseId: 'x',
      timestamp: 1002,
      derivedMetrics: METRICS,
      samples: samples(),
    })
    store.finishSession(session.id, 2000)

    const other = store.createSession(undefined, 3000)
    store.finishSession(other.id, 4000)

    const comparison = store.compareSessions(session.id, other.id)
    // Média de 80 apenas, não (80 + 0) / 2.
    expect(comparison.byExercise.find((e) => e.exerciseId === 'x')!.avgScoreA).toBe(80)
  })
})

describe('BrakeCheckStore — Skill Profile, progresso e calibração', () => {
  let store: BrakeCheckStore

  beforeEach(() => {
    store = new BrakeCheckStore({ path: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('TC-405: cada ponto é acrescentado, nunca sobrescreve o anterior', () => {
    let profile = emptyProfile()
    profile = updateProfile(profile, [scoreOf('fund-01-controle-pedal', 60)], 1000)
    store.appendSkillProfilePoint(profile.history[0]!)
    profile = updateProfile(profile, [scoreOf('fund-01-controle-pedal', 85)], 2000)
    store.appendSkillProfilePoint(profile.history[1]!)

    const history = store.skillProfileHistory()
    expect(history).toHaveLength(2)
    expect(history[0]!.values.brakeControl).toBeCloseTo(60, 6)
    expect(history[1]!.values.brakeControl).toBeCloseTo(85, 6)
    expect(store.loadSkillProfile().current.brakeControl).toBeCloseTo(85, 6)
  })

  it('colisão de timestamp desloca em vez de derrubar o app', () => {
    const profile = updateProfile(emptyProfile(), [scoreOf('fund-01-controle-pedal', 60)], 1000)
    const first = store.appendSkillProfilePoint(profile.history[0]!)
    const second = store.appendSkillProfilePoint(profile.history[0]!)

    expect(first).toBe(1000)
    expect(second).toBe(1001)
    expect(store.skillProfileHistory()).toHaveLength(2)
  })

  it('dimensão sem dado é gravada como null, não como zero', () => {
    const profile = updateProfile(emptyProfile(), [scoreOf('fund-01-controle-pedal', 76)], 1000)
    store.appendSkillProfilePoint(profile.history[0]!)

    const stored = store.skillProfileHistory()[0]!
    expect(stored.values.brakeControl).toBeCloseTo(76, 6)
    expect(stored.values.trailBraking).toBeNull()
  })

  it('perfil vazio devolve todas as dimensões sem dado', () => {
    const profile = store.loadSkillProfile()
    expect(profile.history).toEqual([])
    expect(profile.current.brakeControl).toBeNull()
  })

  it('progresso de exercício é gravado e atualizado', () => {
    store.setExerciseProgress({
      exerciseId: 'fund-01-controle-pedal',
      unlocked: true,
      mastered: false,
      masteredAt: null,
    })
    expect(store.listExerciseProgress()[0]!.mastered).toBe(false)

    store.setExerciseProgress({
      exerciseId: 'fund-01-controle-pedal',
      unlocked: true,
      mastered: true,
      masteredAt: 5000,
    })

    const rows = store.listExerciseProgress()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.mastered).toBe(true)
    expect(rows[0]!.masteredAt).toBe(5000)
  })

  it('calibração do dispositivo persiste por eixo', () => {
    store.saveCalibration([
      { axis: 'brake', rawMin: 0.1, rawMax: 0.9, capturedAt: 1000 },
      { axis: 'steering', rawMin: 5, rawMax: 95, capturedAt: 1000 },
    ])

    const loaded = store.loadCalibration()
    expect(loaded).toHaveLength(2)
    expect(loaded.find((c) => c.axis === 'brake')!.rawMax).toBeCloseTo(0.9, 6)

    store.saveCalibration([{ axis: 'brake', rawMin: 0.05, rawMax: 0.95, capturedAt: 2000 }])
    expect(store.loadCalibration()).toHaveLength(2)
    expect(store.loadCalibration().find((c) => c.axis === 'brake')!.rawMin).toBeCloseTo(0.05, 6)
  })

  it('o schema grava sua versão no próprio arquivo', () => {
    expect(store.schemaVersion).toBe(1)
  })
})
