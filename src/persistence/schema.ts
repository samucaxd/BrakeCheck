/**
 * Schema SQLite (`session-persistence` §1).
 *
 * Esta camada é a **única** que executa SQL. As demais entregam dados prontos,
 * no formato que já definiram, e nunca tocam o banco diretamente.
 */

/**
 * Versão do schema, gravada em `PRAGMA user_version`.
 *
 * Não está na skill, mas o banco é o único artefato do projeto que sobrevive a
 * um deploy: sem um número de versão gravado no próprio arquivo, a primeira
 * mudança de schema vira adivinhação sobre o que o arquivo do piloto contém.
 */
export const SCHEMA_VERSION = 1

/**
 * `derived_metrics`, `score_result` e `feedback` ficam como texto JSON, e não
 * como colunas normalizadas, porque seus formatos são definidos e evoluem em
 * outras skills. Normalizar aqui criaria um acoplamento que quebraria a cada
 * mudança lá (`session-persistence` §1).
 *
 * O catálogo de exercícios não tem tabela: ele é dado estático da
 * `braking-training-engine`. Só o **progresso** do piloto sobre ele é persistido.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','paused','finished','incomplete')),
  device_info TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  exercise_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  derived_metrics TEXT NOT NULL,
  score_result TEXT,
  feedback TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exercise ON attempts(exercise_id, timestamp);

CREATE TABLE IF NOT EXISTS telemetry_samples (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  timestamp INTEGER NOT NULL,
  brake REAL NOT NULL,
  throttle REAL NOT NULL,
  steering REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_attempt ON telemetry_samples(attempt_id, timestamp);

CREATE TABLE IF NOT EXISTS skill_profile_history (
  timestamp INTEGER PRIMARY KEY,
  brake_control REAL, threshold_braking REAL, brake_release REAL,
  trail_braking REAL, steering_control REAL, throttle_control REAL, consistency REAL
);

CREATE TABLE IF NOT EXISTS exercise_progress (
  exercise_id TEXT PRIMARY KEY,
  unlocked INTEGER NOT NULL DEFAULT 0,
  mastered INTEGER NOT NULL DEFAULT 0,
  mastered_at INTEGER
);

CREATE TABLE IF NOT EXISTS device_calibration (
  axis TEXT PRIMARY KEY,
  raw_min REAL NOT NULL,
  raw_max REAL NOT NULL,
  captured_at INTEGER NOT NULL
);
`
