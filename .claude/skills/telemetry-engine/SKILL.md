---
name: telemetry-engine
description: Orienta o cálculo e a estruturação de métricas de telemetria do Brake Check a partir dos canais normalizados do G29 — duração, mín/máx por canal, velocidade de aplicação/liberação do freio, tempo em faixa de pressão, tempo até pico, overlap brake×throttle, e consistência entre tentativas (RF-201 a RF-210). Use esta skill sempre que for calcular, armazenar em memória ou definir o schema de qualquer métrica derivada de telemetria — ela não faz scoring nem persistência real em disco.
---

# Telemetry Engine

Consome a saída da `g29-input-layer` (`TelemetrySample` normalizado) e produz duas coisas por tentativa: a série temporal bruta (para replay/gráficos) e as métricas derivadas (para scoring). Cobre RF-201 a RF-210.

**Onde esta skill para:** entrega `Attempt.derived_metrics` prontas. Não calcula sub-scores nem score agregado (isso é da `evaluation-scoring-engine`) e não grava nada em disco/SQLite (isso é da `session-persistence`) — aqui só se define **o que** é calculado e **em que formato**.

## 1. Entrada e schema base (PRD §8)

Entrada: um stream de `TelemetrySample { timestamp, brake, throttle, steering }` (já normalizados pela `g29-input-layer`), agrupados por tentativa (`Attempt`).

```
TelemetrySample { timestamp: number (ms), brake: number (0-100), throttle: number (0-100), steering: number (-100..100) }
Attempt { id, session_id, exercise_id, timestamp, raw_samples_ref, derived_metrics, score_result, feedback }
```

Nesta skill, `raw_samples_ref` e `derived_metrics` são o que se produz. `score_result` e `feedback` ficam vazios/nulos aqui — são preenchidos por camadas posteriores.

## 2. Conceito base: "evento de frenagem"

Várias métricas (RF-204, RF-205, RF-207) dependem de identificar quando uma frenagem começa e termina dentro de uma tentativa. Defina assim:

- **Início do evento:** primeira amostra em que `brake` cruza acima de um limiar (`brake_threshold`, ver assunção provisória §7) vindo de um valor abaixo dele.
- **Pico do evento:** amostra com o maior valor de `brake` entre o início do evento e o momento em que `brake` volta a cair abaixo do limiar (ou o fim da tentativa, o que vier primeiro).
- **Fim do evento:** primeira amostra após o pico em que `brake` cruza abaixo do limiar novamente, ou o fim da tentativa.

Uma tentativa pode ter mais de um evento de frenagem (ex.: exercícios com múltiplas frenagens). Quando um exercício define isso, calcule as métricas de aplicação/liberação/pico por evento e agregue (ex.: média) — a forma de agregação exata é definida pela `braking-training-engine`, que sabe o que cada exercício espera; esta skill só expõe a métrica por evento e uma agregação-padrão razoável (média) quando não houver outra instrução.

## 3. Fórmulas das métricas (RF-201 a RF-209)

| RF | Métrica | Fórmula | Unidade |
|---|---|---|---|
| RF-202 | Duração da tentativa | `timestamp` da última amostra − `timestamp` da primeira amostra | ms |
| RF-203 | Mín/máx por canal | `min()`/`max()` de `brake`, `throttle`, `steering` sobre todas as amostras da tentativa | valor do canal |
| RF-204 | Velocidade de aplicação do freio | `(brake_pico − brake_início) / (t_pico − t_início)`, por evento de frenagem (§2) | %/s |
| RF-205 | Velocidade de liberação do freio | `(brake_pico − brake_fim) / (t_fim − t_pico)`, por evento | %/s |
| RF-206 | Tempo em faixa de pressão | soma de `Δt` entre amostras consecutivas onde `brake` está dentro de `[low, high]` (faixa vem do exercício, via `braking-training-engine`) | ms |
| RF-207 | Tempo até pressão máxima | `t_pico − t_início`, por evento (mesmo intervalo usado na velocidade de aplicação) | ms |
| RF-208 | Overlap brake×throttle | soma de `Δt` entre amostras consecutivas onde `brake > threshold` **e** `throttle > threshold` simultaneamente | ms (e opcionalmente `% da duração da tentativa`) |

**RF-201** (capturar por amostra `brake, throttle, steering, timestamp`) não é uma métrica calculada — é o próprio `TelemetrySample` de entrada, já garantido pela `g29-input-layer`.

### RF-209 — Consistência entre tentativas

Diferente das métricas acima (calculadas **por tentativa**), consistência é calculada **entre tentativas** de um mesmo exercício. Entrada: lista de `derived_metrics` de N tentativas. Para cada métrica-chave (definida pelo exercício via `braking-training-engine` — tipicamente `application_speed`, `release_speed`, `peak_value`), calcule:

- `mean` — média entre as N tentativas.
- `stddev` — desvio padrão amostral.
- `coefficient_of_variation` — `stddev / mean` (adimensional; mais robusto que stddev sozinho para comparar métricas em escalas diferentes). Se `mean` for 0, retorne `null` em vez de dividir por zero (ver §6, TC-203).

Esse resultado **não decide** avanço de nível — isso é da `evaluation-scoring-engine`/RN-03. Esta skill só entrega o número; a decisão de "isso é consistente o suficiente" é de quem consome.

## 4. Armazenamento (em memória/estrutura) — RF-210

Cada `Attempt` processada deve carregar as duas coisas lado a lado, nunca uma sem a outra:

```json
{
  "raw_samples_ref": "attempt_7291_samples",
  "derived_metrics": {
    "duration_ms": 2340,
    "brake": {
      "min": 0,
      "max": 87.4,
      "events": [
        { "start_ms": 180, "peak_ms": 410, "end_ms": 900, "peak_value": 87.4, "application_speed_pct_per_s": 380.0, "release_speed_pct_per_s": 178.4 }
      ]
    },
    "throttle": { "min": 0, "max": 100 },
    "time_in_pressure_range_ms": { "band": [70, 85], "duration_ms": 640 },
    "overlap_ms": 45,
    "overlap_pct_of_duration": 1.9
  }
}
```

`raw_samples_ref` é uma referência (não o array inteiro embutido) porque sessões longas (TC-204) não devem manter toda a série bruta em memória de uma vez — o mecanismo real de referência/streaming para disco é definido pela `session-persistence`; aqui só se define que a métrica derivada **não duplica** os dados brutos, só referencia onde estão.

## 5. Casos de borda obrigatórios (ligados aos cenários de teste do PRD §10.2)

- **TC-203 — tentativa extremamente curta:** se não houver amostras suficientes para formar um evento de frenagem completo (ex.: só a subida, sem pico claro, ou zero amostras), as métricas de evento devem retornar `null`/`0` explicitamente, nunca lançar exceção por divisão por zero ou por acessar um array vazio.
- **TC-204 — sessão longa (~1h):** processar em streaming/incremental, não acumular a série bruta inteira em memória antes de calcular — calcule métricas incrementalmente por tentativa (as tentativas são naturalmente limitadas em duração, mesmo dentro de uma sessão longa).
- **TC-205/TC-206 — consistência alta/baixa:** validar a fórmula de RF-209 com um conjunto de tentativas quase idênticas (deve dar `coefficient_of_variation` baixo) e um conjunto bem diferente entre si (deve dar `coefficient_of_variation` alto) antes de considerar a métrica pronta.

## 6. Assunções provisórias registradas (ajustáveis)

- **`brake_threshold` para detectar início/fim de evento de frenagem:** proposto 5% (acima da deadzone default de 2% definida em `g29-input-layer`, para não confundir ruído residual com início de frenagem real). Ajustável por exercício, se necessário.
- **`throttle_threshold` para overlap (RF-208):** proposto o mesmo valor, 5%.
- **Agregação padrão de eventos múltiplos numa tentativa:** proposta a média simples entre eventos, quando o exercício não especificar outra coisa. A `braking-training-engine` pode sobrepor isso por exercício.
