---
name: evaluation-scoring-engine
description: Orienta o cálculo de sub-scores, score agregado, classificação Bronze/Silver/Gold/Master, e a atualização do Driving Skill Profile do Brake Check (RF-401 a RF-405, RN-01, RN-02). Use esta skill sempre que for transformar métricas da telemetry-engine e critérios de sucesso da braking-training-engine em pontuação numérica, ou sempre que for atualizar o perfil de habilidades do piloto — ela não gera texto de feedback, isso é da coach-engine.
---

# Evaluation & Scoring Engine

Cobre RF-401 a RF-405 e as regras de formato RN-01/RN-02. Consome `Attempt.derived_metrics` (da `telemetry-engine`) e `Exercise.success_criteria`/`scoring_rules` (da `braking-training-engine`), produz `ScoreResult` e atualiza `SkillProfile`.

**Onde esta skill para:** entrega números (`ScoreResult`, `SkillProfile` atualizado). Não escreve nenhum texto de feedback — isso é da `coach-engine`, que consome esses números prontos.

## 1. Toolkit de funções de pontuação (0–100)

Cada exercício do catálogo (`braking-training-engine`) define seu `success_criteria` em um destes formatos. Esta skill converte cada formato em um sub-score 0–100 com uma destas fórmulas genéricas — não invente uma fórmula nova por exercício, encaixe no formato que já existe:

| Formato do critério | Fórmula | Uso típico (exemplos do catálogo) |
|---|---|---|
| **Faixa-alvo** `[low, high]` | Dentro da faixa → 100. Fora: `score = max(0, 100 − 100 × distância / tolerância)`, onde `distância` é a distância até a borda mais próxima da faixa e `tolerância` é a largura da própria faixa (`high − low`) | Faixa de pressão sustentada, velocidade de aplicação/liberação "boa" |
| **Proporção de tempo** | `score = min(100, (tempo_na_faixa_ms / tempo_exigido_ms) × 100)` | Tempo em faixa de pressão, modulação do pedal |
| **Desvio de um alvo único** | `score = max(0, 100 − 100 × \|valor − alvo\| / desvio_máx_tolerável)` | Delta de reação (ex. 6), intervalo de estabilização (ex. 14), overlap-alvo (ex. 12, 16) |
| **Correlação** `\|r\| ≥ r_min` | `score = max(0, min(100, (\|r\| / r_min) × 100))` | Relação frenagem × rotação (ex. 15) |
| **Consistência** (`coefficient_of_variation`) | `score = max(0, 100 − 100 × (cv / cv_máx_tolerável))` | Sub-score "Consistência" em qualquer exercício |

Todos os parâmetros (`tolerância`, `desvio_máx_tolerável`, `cv_máx_tolerável`) vêm do `success_criteria` já registrado no catálogo da `braking-training-engine` — esta skill não redefine limiares, só a fórmula que os transforma em score.

## 2. Sub-scores por tentativa (RF-401)

Para cada `Attempt`, calcular um sub-score 0–100 por item listado em `scoring_rules` daquele exercício (ex.: "Aplicação inicial", "Controle de pressão", "Liberação", "Consistência", "Consistência direcional" — conforme o catálogo), usando a função correspondente da seção 1 sobre a métrica relevante em `derived_metrics`.

## 3. Score agregado (RF-402)

```
score_total = média aritmética simples dos sub-scores da tentativa
```

Média simples é o padrão porque nenhum exercício do catálogo atual define pesos customizados por sub-score. Se uma versão futura de um exercício definir pesos em `scoring_rules`, usar média ponderada — mas isso é extensão futura, não o comportamento atual.

**Formato de exibição (RN-01):**

```
Threshold Braking — 82/100
  Aplicação inicial:     91/100
  Controle de pressão:   78/100
  Liberação:             74/100
  Consistência:          85/100
```

## 4. Classificação Bronze/Silver/Gold/Master (RF-403)

**Assunção provisória (o PRD deixa isso explicitamente em aberto — seção 16 — validar com uso real):**

| Nível | Faixa de `score_total` |
|---|---|
| Bronze | `< 60` |
| Silver | `60 ≤ score < 75` |
| Gold | `75 ≤ score < 90` |
| Master | `≥ 90` |

Faixas são fechadas no limite inferior e abertas no superior, exatamente como acima — isso evita qualquer ambiguidade de borda (relevante para TC-404: um score de exatamente 75 é Gold, não Silver).

## 5. Driving Skill Profile (RF-404, RF-405)

O `SkillProfile` tem 7 dimensões fixas (PRD §8): Brake Control, Threshold Braking, Brake Release, Trail Braking, Steering Control, Throttle Control, Consistency. Cada exercício do catálogo alimenta 1–2 dimensões:

| Dimensão | Exercícios que alimentam |
|---|---|
| Brake Control | 1, 2, 3, 4, 6, 9 |
| Threshold Braking | 7, 8, 11 |
| Brake Release | 10, 11, 13 |
| Trail Braking | 12, 14, 15, 16 |
| Steering Control | 3, 13, 15, 16 |
| Throttle Control | 16 |
| Consistency | 5 (e o sub-score "Consistência" de qualquer exercício, quando presente) |

**Cálculo de cada dimensão (a cada atualização de perfil, tipicamente ao fim de uma sessão):**

```
dimensão = média dos sub-scores relevantes do bloco de tentativas mais recente
           de cada exercício mapeado para essa dimensão
```

Se nenhum exercício mapeado para uma dimensão foi tentado ainda, a dimensão fica `null` ("sem dado suficiente") — **nunca 0**. Zero implicaria "desempenho ruim"; ausência de dado é uma coisa diferente e não pode ser confundida com isso.

**Nota honesta sobre desbalanceamento (V1):** como o foco de conteúdo da V1 é frenagem (PRD §2, non-goal de outras técnicas), `Throttle Control` só é alimentado pelo exercício 16, e `Steering Control` é sempre secundário a exercícios de frenagem — essas duas dimensões vão ficar com base amostral mais fraca que as demais na V1. Isso é esperado, não é um bug do cálculo; o roadmap V2+ (PRD §13) é que resolve isso com mais técnicas.

**Persistência de histórico (RF-405):** cada atualização gera um novo ponto em `SkillProfile.history[]` — nunca sobrescreve o valor anterior, sempre adiciona (TC-405). O mecanismo real de armazenamento é da `session-persistence`; aqui só se define o formato do ponto: `{ timestamp, brake_control, threshold_braking, brake_release, trail_braking, steering_control, throttle_control, consistency }`.

**Formato de exibição (RN-02):**

```
DRIVING SKILL PROFILE
Threshold Braking   82
Brake Control       76
Brake Release       64
Trail Braking       58
Steering Control    71
Throttle Control    69
Consistency         84
```

## 6. Casos de borda obrigatórios (PRD §10.4)

- **TC-401/TC-402** (aplicação/liberação abrupta) — já cobertos naturalmente pela fórmula de "faixa-alvo" (seção 1): valores fora da faixa ideal recebem penalidade proporcional à distância, não um corte binário.
- **TC-403** (conjunto de sub-scores conhecido → agregado bate com a fórmula) — a fórmula é média simples (seção 3), determinística e testável diretamente.
- **TC-404** (scores nos limites de corte) — usar exatamente os limites fechados/abertos da tabela da seção 4, sem exceção.
- **TC-405** (nova sessão → perfil atualiza preservando histórico) — sempre `append`, nunca sobrescrever `history[]` (seção 5).

## 7. Assunções provisórias registradas (ajustáveis)

- **Faixas de corte Bronze/Silver/Gold/Master** (seção 4) — valores plausíveis, não validados com o usuário.
- **Tolerância da fórmula de "faixa-alvo"** (seção 1) — proposta como igual à própria largura da faixa-alvo (`high − low`); pode precisar de ajuste por exercício se se mostrar severa ou permissiva demais na prática.
- **Mapeamento exercício → dimensão do Skill Profile** (seção 5) — construído a partir da técnica de cada exercício no catálogo; é uma interpretação razoável, não uma definição literal do PRD (que não detalha esse mapeamento).
