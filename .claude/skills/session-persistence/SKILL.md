---
name: session-persistence
description: Orienta o ciclo de vida de sessão (criar/pausar/retomar/finalizar/salvar), o schema SQLite local, consulta de histórico, comparação entre sessões, e a resiliência a encerramento abrupto do Brake Check (RF-601 a RF-605, RNF-08). Use esta skill sempre que for implementar qualquer gravação/leitura em disco — sessões, tentativas, calibração de dispositivo, progresso de exercícios ou Skill Profile — ela é o único lugar que deve tocar o banco de dados diretamente.
---

# Session Persistence

Cobre RF-601 a RF-605. Stack decidida em `brake-check-foundations`: **`better-sqlite3`** (SQLite síncrono), local, sem dependência de rede (RNF-05).

**Onde esta skill para:** define e mantém o schema, o ciclo de vida de sessão, e as garantias de durabilidade. Nenhuma outra skill deve executar SQL diretamente — todas as outras camadas (telemetry-engine, evaluation-scoring-engine, coach-engine, braking-training-engine) entregam dados **para** esta skill persistir, no formato que já definiram.

## 1. Schema SQLite

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','paused','finished','incomplete')),
  device_info TEXT
);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  exercise_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  derived_metrics TEXT NOT NULL,   -- JSON (telemetry-engine)
  score_result TEXT,               -- JSON (evaluation-scoring-engine), NULL até ser calculado
  feedback TEXT                    -- JSON (coach-engine), NULL até ser gerado
);
CREATE INDEX idx_attempts_session ON attempts(session_id);
CREATE INDEX idx_attempts_exercise ON attempts(exercise_id, timestamp);

CREATE TABLE telemetry_samples (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  timestamp INTEGER NOT NULL,
  brake REAL NOT NULL,
  throttle REAL NOT NULL,
  steering REAL NOT NULL
);
CREATE INDEX idx_samples_attempt ON telemetry_samples(attempt_id, timestamp);

CREATE TABLE skill_profile_history (
  timestamp INTEGER PRIMARY KEY,
  brake_control REAL, threshold_braking REAL, brake_release REAL,
  trail_braking REAL, steering_control REAL, throttle_control REAL, consistency REAL
);

CREATE TABLE exercise_progress (
  exercise_id TEXT PRIMARY KEY,
  unlocked INTEGER NOT NULL DEFAULT 0,
  mastered INTEGER NOT NULL DEFAULT 0,
  mastered_at INTEGER
);

CREATE TABLE device_calibration (
  axis TEXT PRIMARY KEY,
  raw_min REAL NOT NULL,
  raw_max REAL NOT NULL,
  captured_at INTEGER NOT NULL
);
```

Notas de schema:
- `sessions.status = 'incomplete'` é um estado que **nenhum código normal define diretamente** — só a rotina de recuperação no boot (seção 4) o atribui, a sessões órfãs de um crash anterior.
- `derived_metrics`, `score_result`, `feedback` ficam como texto JSON (não colunas normalizadas) porque seus schemas são definidos e evoluem em outras skills (`telemetry-engine`, `evaluation-scoring-engine`, `coach-engine`) — normalizar aqui criaria acoplamento que quebraria a cada mudança lá.
- `exercise_progress` é o que a `braking-training-engine` (§5) lê/escreve para decidir gates de desbloqueio — não existe em memória entre execuções do app, precisa estar aqui.
- O catálogo de exercícios em si (nome, técnica, critérios etc.) é dado estático da `braking-training-engine`, não fica em tabela — só o **progresso** do piloto sobre ele.

## 2. Ciclo de vida de sessão (RF-601)

| Transição | Efeito |
|---|---|
| **Criar** | `INSERT INTO sessions (start_time, status) VALUES (now, 'active')` |
| **Pausar** | `UPDATE sessions SET status = 'paused' WHERE id = ?` |
| **Retomar** | `UPDATE sessions SET status = 'active' WHERE id = ?` |
| **Finalizar** | `UPDATE sessions SET status = 'finished', end_time = now WHERE id = ?` |
| **Salvar** | Não é uma transição separada — cada `Attempt` já é persistida de forma durável no momento em que é capturada (seção 3), não só ao finalizar a sessão. "Salvar" a sessão é, na prática, `UPDATE sessions SET end_time = now`. |

Uma sessão `paused` mantém suas tentativas já persistidas intactas; retomar só volta o status para `active` e permite novas tentativas no mesmo `session_id`.

## 3. Escrita incremental e resiliência a crash (RF-605, RNF-08)

**Princípio central: nunca segurar dados de uma tentativa já concluída só em memória até o fim da sessão.** Cada `Attempt` (com seus `telemetry_samples`) é gravada no SQLite assim que a tentativa termina, dentro de uma única transação:

```sql
BEGIN;
INSERT INTO attempts (session_id, exercise_id, timestamp, derived_metrics) VALUES (...);
INSERT INTO telemetry_samples (attempt_id, timestamp, brake, throttle, steering) VALUES (...), (...), ...;
COMMIT;
```

Se o processo morrer no meio dessa transação, o SQLite garante atomicidade — ou a tentativa inteira está lá, ou nenhuma parte dela está. O único dado que pode ser perdido em um crash é o da **tentativa em andamento no exato momento do crash** (ainda não commitada), nunca tentativas já concluídas.

**Modo de journaling:** ativar `PRAGMA journal_mode = WAL` na conexão — reduz a chance de corrupção do arquivo de banco em caso de encerramento abrupto (comparado ao modo padrão) e permite leitura concorrente enquanto uma escrita está em andamento (relevante para a UI consultar histórico enquanto uma sessão ativa está gravando tentativas).

**Detecção de sessão órfã no boot (TC-602):** toda inicialização do app, antes de qualquer nova sessão ser criada, rodar:

```sql
UPDATE sessions SET status = 'incomplete' WHERE status IN ('active', 'paused');
```

Qualquer sessão nesse estado só pode existir porque o processo anterior terminou sem chamar "Finalizar" — sinal direto de fechamento abrupto. Ela vira `incomplete`: visível no histórico, com todas as tentativas já persistidas íntegras e consultáveis, mas não é retomável como sessão ativa (evita a ambiguidade de "continuar" algo que pode ter sido interrompido no meio de uma tentativa).

## 4. Consulta de histórico (RF-603)

Listagem padrão: `SELECT * FROM sessions ORDER BY start_time DESC` com paginação (não carregar as 100+ sessões de uma vez — TC-604). Ao abrir uma sessão específica, só então buscar suas `attempts`; ao abrir uma tentativa específica (ex.: para replay), só então buscar seus `telemetry_samples`. Esse carregamento em camadas (sessão → tentativas → amostras, sob demanda) é o que mantém TC-604 aceitável sem exigir nenhuma otimização exótica — os índices da seção 1 já cobrem as três consultas.

## 5. Comparação entre sessões (RF-604)

Dadas duas sessões (ex.: #12 e #18), o resultado de comparação é:

```json
{
  "session_a": { "id": 12, "start_time": "...", "attempts_count": 25 },
  "session_b": { "id": 18, "start_time": "...", "attempts_count": 30 },
  "by_exercise": [
    { "exercise_id": "threshold-braking", "avg_score_a": 71, "avg_score_b": 84, "delta": 13 }
  ],
  "skill_profile_delta": {
    "brake_control": 4, "threshold_braking": 13, "brake_release": -2,
    "trail_braking": 0, "steering_control": 1, "throttle_control": null, "consistency": 6
  }
}
```

`avg_score_X` é a média de `score_result.total_score` das tentativas daquele exercício dentro da sessão. `skill_profile_delta` usa o ponto de `skill_profile_history` mais próximo (mas não anterior) ao fim de cada sessão — `null` se nenhum dos dois pontos tinha aquela dimensão medida ainda (ver `evaluation-scoring-engine` §5 sobre não confundir "sem dado" com zero).

## 6. Casos de borda obrigatórios (PRD §10.6)

- **TC-601** (criar → pausar → retomar → finalizar → salvar): cada transição da seção 2 deve ser testada em sequência, verificando que `status` e `end_time` refletem exatamente a transição esperada a cada passo.
- **TC-602** (encerramento abrupto): coberto pela seção 3 — testar matando o processo (não fechamento normal) no meio de uma sessão ativa e verificando, no próximo boot, que a sessão aparece como `incomplete` com as tentativas já concluídas intactas.
- **TC-603** (comparação #12 × #18): validar contra a seção 5 com sessões de teste com valores conhecidos.
- **TC-604** (100+ sessões, tempo de carregamento aceitável): validar que a listagem de histórico não busca `attempts`/`telemetry_samples` antecipadamente (seção 4).

## 7. Assunções provisórias registradas (ajustáveis)

- **Ponto de `skill_profile_history` usado na comparação de sessões** (seção 5): proposto "o mais próximo, mas não anterior, ao fim da sessão" — pode não existir exatamente nesse timestamp; usar o primeiro ponto com `timestamp >= session.end_time`, e se não houver nenhum (sessão ainda não gerou atualização de perfil), tratar a dimensão como sem dado (`null`) para aquela sessão.
- **Sem número-alvo de volume de histórico travado** (o PRD, seção 12, deixa isso como pergunta em aberto explicitamente) — o design desta skill (carregamento em camadas, índices por `session_id`/`exercise_id`) é pensado para escalar sem exigir esse número agora, mas não foi testado contra um volume real.
