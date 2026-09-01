/**
 * Persistência local em SQLite (RF-601 a RF-605, RNF-05, RNF-08).
 *
 * **Esta classe é o único lugar do projeto que executa SQL.** As outras camadas
 * entregam dados prontos, no formato que já definiram, e nunca tocam o banco.
 *
 * Tudo é local: nenhuma operação aqui depende de rede (RNF-05), e nada sai da
 * máquina (RNF-11).
 */

import Database from 'better-sqlite3'

import type { CoachFeedback } from '../coach/feedback.js'
import { SKILL_DIMENSIONS } from '../evaluation/types.js'
import type {
  ScoreResult,
  SkillDimension,
  SkillProfile,
  SkillProfilePoint,
} from '../evaluation/types.js'
import type { TelemetrySample } from '../shared/contracts.js'
import type { DerivedMetrics } from '../telemetry/types.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'
import type {
  CalibrationRow,
  ExerciseComparison,
  ExerciseProgressRow,
  SessionComparison,
  SessionRecord,
  SessionSummary,
  SessionStatus,
  StoredAttempt,
  StoredSample,
} from './types.js'

/** Coluna do banco ↔ dimensão do Skill Profile. */
const DIMENSION_COLUMNS: Readonly<Record<SkillDimension, string>> = {
  brakeControl: 'brake_control',
  thresholdBraking: 'threshold_braking',
  brakeRelease: 'brake_release',
  trailBraking: 'trail_braking',
  steeringControl: 'steering_control',
  throttleControl: 'throttle_control',
  consistency: 'consistency',
}

export interface StoreOptions {
  /** Caminho do arquivo, ou `:memory:` nos testes. */
  path: string
  /**
   * Se a recuperação de sessões órfãs roda na abertura. Default `true`.
   * Os testes de TC-602 desligam para simular o estado deixado por um crash
   * antes de reabrir.
   */
  recoverOnOpen?: boolean
}

export class BrakeCheckStore {
  #db: Database.Database

  constructor(options: StoreOptions) {
    this.#db = new Database(options.path)

    /**
     * O schema declara `REFERENCES`, mas o SQLite **não** os aplica por padrão.
     * Sem este pragma as chaves estrangeiras seriam decorativas e uma tentativa
     * órfã (apontando para sessão inexistente) entraria calada.
     */
    this.#db.pragma('foreign_keys = ON')

    /**
     * WAL reduz a chance de corromper o arquivo em um encerramento abrupto e
     * permite a UI ler o histórico enquanto uma sessão ativa grava
     * (`session-persistence` §3). Em `:memory:` o SQLite ignora e mantém
     * `memory` — não é erro.
     */
    this.#db.pragma('journal_mode = WAL')

    /**
     * `synchronous = FULL` em vez do `NORMAL` usual com WAL.
     *
     * Com NORMAL, a transação mais recente pode se perder em uma queda de
     * energia (não em um crash de processo). O custo de FULL é um fsync por
     * transação — e aqui há **uma transação por tentativa**, a cada poucos
     * segundos, não milhares por segundo. Trocar durabilidade por uma vazão que
     * este app nunca vai usar seria um mau negócio (RNF-08).
     */
    this.#db.pragma('synchronous = FULL')

    this.#db.exec(SCHEMA_SQL)
    this.#db.pragma(`user_version = ${SCHEMA_VERSION}`)

    if (options.recoverOnOpen !== false) this.recoverOrphanSessions()
  }

  close(): void {
    this.#db.close()
  }

  get schemaVersion(): number {
    return this.#db.pragma('user_version', { simple: true }) as number
  }

  // --- Ciclo de vida de sessão (RF-601) --------------------------------------

  /**
   * TC-602 — marca como `incomplete` toda sessão que ficou `active` ou `paused`.
   *
   * Uma sessão nesse estado na abertura só pode existir porque o processo
   * anterior morreu sem finalizar. Ela continua visível no histórico, com as
   * tentativas já persistidas íntegras, mas deixa de ser retomável: "continuar"
   * algo que pode ter sido interrompido no meio de uma tentativa é ambíguo.
   *
   * Consequência a conhecer: pausar **não sobrevive** a fechar o app. A pausa é
   * dentro da execução; ao reabrir, a sessão pausada vira `incomplete`. É o que
   * `session-persistence` §3 determina, ao incluir `paused` na varredura.
   */
  recoverOrphanSessions(): number {
    const result = this.#db
      .prepare(`UPDATE sessions SET status = 'incomplete' WHERE status IN ('active','paused')`)
      .run()
    return result.changes
  }

  createSession(deviceInfo?: string, now: number = Date.now()): SessionRecord {
    const result = this.#db
      .prepare(`INSERT INTO sessions (start_time, status, device_info) VALUES (?, 'active', ?)`)
      .run(now, deviceInfo ?? null)
    return this.getSession(Number(result.lastInsertRowid))!
  }

  pauseSession(id: number): void {
    this.#transition(id, 'paused', ['active'])
  }

  /** Só uma sessão pausada volta a ativa — `incomplete` e `finished` não retomam. */
  resumeSession(id: number): void {
    this.#transition(id, 'active', ['paused'])
  }

  finishSession(id: number, now: number = Date.now()): void {
    const session = this.getSession(id)
    if (!session) throw new Error(`Sessão ${id} não existe`)
    if (session.status === 'finished') return
    if (session.status === 'incomplete') {
      throw new Error(`Sessão ${id} está incompleta e não pode ser finalizada`)
    }
    this.#db
      .prepare(`UPDATE sessions SET status = 'finished', end_time = ? WHERE id = ?`)
      .run(now, id)
  }

  #transition(id: number, next: SessionStatus, allowedFrom: readonly SessionStatus[]): void {
    const session = this.getSession(id)
    if (!session) throw new Error(`Sessão ${id} não existe`)
    if (!allowedFrom.includes(session.status)) {
      throw new Error(
        `Sessão ${id} está "${session.status}"; transição para "${next}" exige ${allowedFrom.join(' ou ')}`,
      )
    }
    this.#db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(next, id)
  }

  getSession(id: number): SessionRecord | null {
    const row = this.#db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | SessionRow
      | undefined
    return row ? toSessionRecord(row) : null
  }

  /**
   * RF-603 — histórico paginado.
   *
   * Devolve só a linha da sessão mais a contagem de tentativas; nada de
   * `attempts` nem `telemetry_samples`. É esse carregamento em camadas
   * (sessão → tentativas → amostras, sob demanda) que mantém o TC-604 aceitável
   * sem otimização exótica.
   */
  listSessions(options: { limit?: number; offset?: number } = {}): SessionSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT s.*, COUNT(a.id) AS attempts_count
           FROM sessions s
           LEFT JOIN attempts a ON a.session_id = s.id
          GROUP BY s.id
          ORDER BY s.start_time DESC
          LIMIT ? OFFSET ?`,
      )
      .all(options.limit ?? 50, options.offset ?? 0) as (SessionRow & {
      attempts_count: number
    })[]

    return rows.map((row) => ({ ...toSessionRecord(row), attemptsCount: row.attempts_count }))
  }

  countSessions(): number {
    return (this.#db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n
  }

  // --- Tentativas e amostras (RF-605) ---------------------------------------

  /**
   * Grava uma tentativa concluída com suas amostras, em **uma** transação.
   *
   * O princípio central da resiliência (RF-605/RNF-08): nunca segurar em memória
   * uma tentativa já concluída até o fim da sessão. Se o processo morrer no meio
   * desta transação, o SQLite garante que ou tudo entrou ou nada entrou — o
   * único dado perdível é o da tentativa em andamento no instante do crash,
   * nunca uma já concluída.
   */
  saveAttempt(input: {
    sessionId: number
    exerciseId: string
    timestamp: number
    derivedMetrics: DerivedMetrics
    samples: readonly TelemetrySample[]
    scoreResult?: ScoreResult | null
    feedback?: CoachFeedback | null
  }): number {
    const insertAttempt = this.#db.prepare(
      `INSERT INTO attempts (session_id, exercise_id, timestamp, derived_metrics, score_result, feedback)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertSample = this.#db.prepare(
      `INSERT INTO telemetry_samples (attempt_id, timestamp, brake, throttle, steering)
       VALUES (?, ?, ?, ?, ?)`,
    )

    const run = this.#db.transaction(() => {
      const result = insertAttempt.run(
        input.sessionId,
        input.exerciseId,
        input.timestamp,
        JSON.stringify(input.derivedMetrics),
        input.scoreResult ? JSON.stringify(input.scoreResult) : null,
        input.feedback ? JSON.stringify(input.feedback) : null,
      )
      const attemptId = Number(result.lastInsertRowid)
      for (const sample of input.samples) {
        insertSample.run(attemptId, sample.timestamp, sample.brake, sample.throttle, sample.steering)
      }
      return attemptId
    })

    return run()
  }

  /** Anexa o resultado de pontuação a uma tentativa já gravada. */
  setAttemptScore(attemptId: number, scoreResult: ScoreResult): void {
    this.#db
      .prepare(`UPDATE attempts SET score_result = ? WHERE id = ?`)
      .run(JSON.stringify(scoreResult), attemptId)
  }

  /** Anexa o feedback do coach a uma tentativa já gravada. */
  setAttemptFeedback(attemptId: number, feedback: CoachFeedback): void {
    this.#db
      .prepare(`UPDATE attempts SET feedback = ? WHERE id = ?`)
      .run(JSON.stringify(feedback), attemptId)
  }

  listAttempts(sessionId: number): StoredAttempt[] {
    const rows = this.#db
      .prepare(`SELECT * FROM attempts WHERE session_id = ? ORDER BY timestamp ASC`)
      .all(sessionId) as AttemptRow[]
    return rows.map(toStoredAttempt)
  }

  /** Tentativas de um exercício ao longo de todas as sessões, mais recentes por último. */
  listAttemptsForExercise(exerciseId: string, limit = 50): StoredAttempt[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM attempts WHERE exercise_id = ? ORDER BY timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
      )
      .all(exerciseId, limit) as AttemptRow[]
    return rows.map(toStoredAttempt)
  }

  /** Série bruta de uma tentativa — só buscada sob demanda (replay/gráfico). */
  getSamples(attemptId: number): StoredSample[] {
    return this.#db
      .prepare(
        `SELECT timestamp, brake, throttle, steering FROM telemetry_samples
          WHERE attempt_id = ? ORDER BY timestamp ASC`,
      )
      .all(attemptId) as StoredSample[]
  }

  // --- Skill Profile (RF-405) -----------------------------------------------

  /**
   * Acrescenta um ponto ao histórico do perfil. Nunca sobrescreve (TC-405).
   *
   * O `timestamp` é chave primária no schema da skill. Dois pontos no mesmo
   * milissegundo exigiriam duas sessões terminando no mesmo instante — mas a
   * colisão faria o `INSERT` lançar, então o timestamp é deslocado em 1ms até
   * ficar livre, preservando a garantia de append em vez de derrubar o app.
   */
  appendSkillProfilePoint(point: SkillProfilePoint): number {
    const columns = SKILL_DIMENSIONS.map((d) => DIMENSION_COLUMNS[d]).join(', ')
    const insert = this.#db.prepare(
      `INSERT INTO skill_profile_history (timestamp, ${columns})
       VALUES (?, ${SKILL_DIMENSIONS.map(() => '?').join(', ')})`,
    )
    const exists = this.#db.prepare(`SELECT 1 FROM skill_profile_history WHERE timestamp = ?`)

    let timestamp = point.timestamp
    while (exists.get(timestamp) !== undefined) timestamp++

    insert.run(timestamp, ...SKILL_DIMENSIONS.map((d) => point.values[d]))
    return timestamp
  }

  skillProfileHistory(): SkillProfilePoint[] {
    const rows = this.#db
      .prepare(`SELECT * FROM skill_profile_history ORDER BY timestamp ASC`)
      .all() as Record<string, number | null>[]
    return rows.map(toProfilePoint)
  }

  /** Perfil corrente, reconstruído do último ponto do histórico. */
  loadSkillProfile(): SkillProfile {
    const history = this.skillProfileHistory()
    const last = history[history.length - 1]
    const current = last
      ? last.values
      : (Object.fromEntries(SKILL_DIMENSIONS.map((d) => [d, null])) as Record<
          SkillDimension,
          number | null
        >)
    return { current, history }
  }

  // --- Progresso de exercícios ----------------------------------------------

  /**
   * Progresso do piloto sobre o catálogo.
   *
   * A `braking-training-engine` recalcula domínio a partir do histórico de
   * tentativas a cada avaliação; esta tabela é o cache dessa decisão, para a UI
   * montar a trilha sem reprocessar tudo. O histórico continua sendo a fonte da
   * verdade.
   */
  setExerciseProgress(row: ExerciseProgressRow): void {
    this.#db
      .prepare(
        `INSERT INTO exercise_progress (exercise_id, unlocked, mastered, mastered_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(exercise_id) DO UPDATE SET
           unlocked = excluded.unlocked,
           mastered = excluded.mastered,
           mastered_at = excluded.mastered_at`,
      )
      .run(row.exerciseId, row.unlocked ? 1 : 0, row.mastered ? 1 : 0, row.masteredAt)
  }

  listExerciseProgress(): ExerciseProgressRow[] {
    const rows = this.#db.prepare(`SELECT * FROM exercise_progress`).all() as {
      exercise_id: string
      unlocked: number
      mastered: number
      mastered_at: number | null
    }[]
    return rows.map((row) => ({
      exerciseId: row.exercise_id,
      unlocked: row.unlocked === 1,
      mastered: row.mastered === 1,
      masteredAt: row.mastered_at,
    }))
  }

  // --- Calibração do dispositivo (RF-106) -----------------------------------

  saveCalibration(rows: readonly CalibrationRow[]): void {
    const statement = this.#db.prepare(
      `INSERT INTO device_calibration (axis, raw_min, raw_max, captured_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(axis) DO UPDATE SET
         raw_min = excluded.raw_min,
         raw_max = excluded.raw_max,
         captured_at = excluded.captured_at`,
    )
    const run = this.#db.transaction(() => {
      for (const row of rows) statement.run(row.axis, row.rawMin, row.rawMax, row.capturedAt)
    })
    run()
  }

  loadCalibration(): CalibrationRow[] {
    const rows = this.#db.prepare(`SELECT * FROM device_calibration`).all() as {
      axis: string
      raw_min: number
      raw_max: number
      captured_at: number
    }[]
    return rows.map((row) => ({
      axis: row.axis,
      rawMin: row.raw_min,
      rawMax: row.raw_max,
      capturedAt: row.captured_at,
    }))
  }

  // --- Comparação entre sessões (RF-604) ------------------------------------

  /**
   * RF-604 — diferença de desempenho entre duas sessões.
   *
   * O ponto de perfil usado por sessão é o primeiro com `timestamp >= end_time`
   * (`session-persistence` §7): o perfil é atualizado **ao fim** da sessão, então
   * o ponto que a representa é o primeiro que existe a partir dali. Sessão sem
   * ponto correspondente entra como sem dado, não como zero.
   */
  compareSessions(idA: number, idB: number): SessionComparison {
    const sessionA = this.#summaryOf(idA)
    const sessionB = this.#summaryOf(idB)

    const avgA = this.#averageScoresByExercise(idA)
    const avgB = this.#averageScoresByExercise(idB)

    const exerciseIds = [...new Set([...avgA.keys(), ...avgB.keys()])].sort()
    const byExercise: ExerciseComparison[] = exerciseIds.map((exerciseId) => {
      const a = avgA.get(exerciseId) ?? null
      const b = avgB.get(exerciseId) ?? null
      return {
        exerciseId,
        avgScoreA: a,
        avgScoreB: b,
        // Delta só existe com os dois lados medidos; ausência não é delta zero.
        delta: a !== null && b !== null ? b - a : null,
      }
    })

    const pointA = this.#profilePointFor(sessionA.endTime)
    const pointB = this.#profilePointFor(sessionB.endTime)
    const skillProfileDelta = {} as Record<SkillDimension, number | null>
    for (const dimension of SKILL_DIMENSIONS) {
      const a = pointA?.values[dimension] ?? null
      const b = pointB?.values[dimension] ?? null
      skillProfileDelta[dimension] = a !== null && b !== null ? b - a : null
    }

    return { sessionA, sessionB, byExercise, skillProfileDelta }
  }

  #summaryOf(id: number): SessionSummary {
    const session = this.getSession(id)
    if (!session) throw new Error(`Sessão ${id} não existe`)
    const { n } = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM attempts WHERE session_id = ?`)
      .get(id) as { n: number }
    return { ...session, attemptsCount: n }
  }

  /**
   * Média de `score_result.total_score` por exercício.
   *
   * O score mora em JSON, então a média é feita em memória e não em SQL — as
   * tentativas de uma sessão são dezenas, não milhões, e extrair via
   * `json_extract` acoplaria o SQL ao formato interno de outra camada, que é
   * exatamente o que o schema evita ao guardar JSON.
   */
  #averageScoresByExercise(sessionId: number): Map<string, number> {
    const rows = this.#db
      .prepare(`SELECT exercise_id, score_result FROM attempts WHERE session_id = ?`)
      .all(sessionId) as { exercise_id: string; score_result: string | null }[]

    const totals = new Map<string, { sum: number; count: number }>()
    for (const row of rows) {
      if (!row.score_result) continue
      const score = JSON.parse(row.score_result) as ScoreResult
      if (score.totalScore === null) continue
      const entry = totals.get(row.exercise_id) ?? { sum: 0, count: 0 }
      entry.sum += score.totalScore
      entry.count++
      totals.set(row.exercise_id, entry)
    }

    return new Map([...totals].map(([id, { sum, count }]) => [id, sum / count]))
  }

  #profilePointFor(endTime: number | null): SkillProfilePoint | null {
    if (endTime === null) return null
    const row = this.#db
      .prepare(`SELECT * FROM skill_profile_history WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT 1`)
      .get(endTime) as Record<string, number | null> | undefined
    return row ? toProfilePoint(row) : null
  }
}

// --- Mapeamento linha → objeto ---------------------------------------------

interface SessionRow {
  id: number
  start_time: number
  end_time: number | null
  status: SessionStatus
  device_info: string | null
}

interface AttemptRow {
  id: number
  session_id: number
  exercise_id: string
  timestamp: number
  derived_metrics: string
  score_result: string | null
  feedback: string | null
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    deviceInfo: row.device_info,
  }
}

function toStoredAttempt(row: AttemptRow): StoredAttempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    timestamp: row.timestamp,
    derivedMetrics: JSON.parse(row.derived_metrics) as DerivedMetrics,
    scoreResult: row.score_result ? (JSON.parse(row.score_result) as ScoreResult) : null,
    feedback: row.feedback ? (JSON.parse(row.feedback) as CoachFeedback) : null,
  }
}

function toProfilePoint(row: Record<string, number | null>): SkillProfilePoint {
  const values = {} as Record<SkillDimension, number | null>
  for (const dimension of SKILL_DIMENSIONS) {
    values[dimension] = row[DIMENSION_COLUMNS[dimension]] ?? null
  }
  return { timestamp: row['timestamp'] as number, values }
}
