---
name: coach-engine
description: Orienta a geração de feedback textual estruturado e a recomendação adaptativa de próximo exercício do Brake Check, sempre a partir de dados reais da tentativa — nunca texto genérico (RF-501 a RF-505, RN-04, RN-05). Use esta skill sempre que for gerar o texto que o coach virtual mostra ao piloto, ou sempre que for decidir qual exercício recomendar em seguida — ela consome ScoreResult e SkillProfile já calculados, nunca recalcula pontuação.
---

# Coach Engine

Cobre RF-501 a RF-505, RN-04 e RN-05. Consome `ScoreResult` (da `evaluation-scoring-engine`), `Attempt.derived_metrics` (da `telemetry-engine`) e os campos `feedback_focus`/`explanation` de cada `Exercise` (da `braking-training-engine`).

**Onde esta skill para:** entrega texto de feedback e uma recomendação de próximo exercício. Não recalcula sub-scores nem score agregado — se um número parecer errado, o bug está na `evaluation-scoring-engine`, não aqui.

## 1. Estrutura obrigatória do feedback (RN-04, RF-502)

Todo feedback gerado segue exatamente esta sequência de 3 partes — nunca pular uma, nunca inverter a ordem:

1. **O que foi observado nos dados** — fato concreto, com número, não impressão geral.
2. **Qual o impacto técnico disso** — por que esse número importa na pilotagem.
3. **O que tentar na próxima tentativa** — ação específica e executável.

### Algoritmo de geração (mecânico, não "opinião" do sistema)

1. No `ScoreResult` da tentativa, identifique o sub-score **mais baixo**. É esse o assunto do feedback — não o conjunto inteiro, não o score agregado.
2. Puxe, em `derived_metrics`, o valor bruto por trás desse sub-score (ex.: se o sub-score baixo é "Liberação", o valor bruto é `brake.events[].release_speed_pct_per_s`) e compare com o `success_criteria` daquele exercício (`braking-training-engine`). Isso vira a parte 1 (observação), sempre com número real da tentativa, nunca uma descrição vaga.
3. Use o campo `explanation` (o porquê técnico da técnica, já registrado no catálogo da `braking-training-engine`) como base da parte 2 (impacto) — ele já existe justamente para isso, não duplique conhecimento de domínio aqui.
4. Construa a parte 3 (ação) referenciando o mesmo parâmetro numérico da parte 1, na direção que corrige o desvio (ex.: se a velocidade de liberação está acima da faixa-alvo, a ação é "solte mais devagar", com o valor-alvo).

**Isso garante RF-501 (nunca genérico) por construção:** como a parte 1 sempre vem de um valor real e específico daquela tentativa, dois pilotos (ou duas tentativas) com o mesmo sub-score baixo, mas causas diferentes, geram textos diferentes — porque o valor bruto por trás é diferente (ver TC-502, seção 6).

### Exemplo concreto (formato de referência, PRD RN-04)

> "Sua aplicação inicial de freio está consistente, mas você está mantendo pressão elevada por tempo demais. O principal ponto de melhoria neste exercício é trabalhar a liberação progressiva do pedal."

Decomposto: (1) observado = "pressão elevada por tempo demais" (viria de `time_in_pressure_range_ms` ou da velocidade de liberação baixa); (2) impacto = implícito na frase seguinte (liberação tardia atrasa a transferência de peso de volta para a dianteira); (3) ação = "trabalhar a liberação progressiva do pedal".

## 2. Identificar a maior deficiência (RF-503)

A partir do `SkillProfile` atual (7 dimensões, `evaluation-scoring-engine` §5):

```
deficiência_principal = dimensão com o menor valor numérico definido
```

**Regra de prioridade quando há dimensão sem dado (`null`):** se alguma dimensão ainda não tem dado e há exercícios que a alimentam já desbloqueados para o piloto, trate essa dimensão como prioritária mesmo sem número — não dá pra saber que é fraca, mas também não dá pra saber que está bem, e gerar dado é mais urgente que otimizar uma dimensão já medida. Só caia para "menor valor numérico entre as dimensões com dado" se todas as dimensões alcançáveis no momento já tiverem pelo menos uma medição.

## 3. Recomendação adaptativa de próximo exercício (RF-504, RN-05)

```
Skill Profile → dimensão mais fraca (seção 2)
   ↓
Lista de exercícios que alimentam essa dimensão (tabela de mapeamento, evaluation-scoring-engine §5)
   ↓
Filtrar: só exercícios já desbloqueados (gate da braking-training-engine §5 cumprido) e ainda não "dominados" (advance_condition não cumprida)
   ↓
Dentro desse subconjunto: recomendar o de menor sub-score médio recente (o que está puxando a dimensão pra baixo)
```

**Exemplo concreto, com o catálogo real da `braking-training-engine`:**

```
Skill Profile → dimensão mais fraca: Trail Braking (58)
   ↓
Exercícios que alimentam Trail Braking, desbloqueados e não dominados: #12, #14, #15, #16
   ↓
Sub-score médio recente mais baixo entre eles: #12 — Trail Braking (sub-score "Liberação": 61)
   ↓
Próximo exercício recomendado: #12 — Trail Braking
```

Isso é **sempre** a base da recomendação — nunca "próximo da lista" por padrão. A ordem sequencial do catálogo (`braking-training-engine` §5) só serve para desbloqueio, não para recomendação.

## 4. Nunca liberar avanço por "completar uma vez" (RF-505)

A decisão de **o que está desbloqueado** já é feita pela `braking-training-engine` (gate de nível + `advance_condition` por exercício, que exige domínio sustentado + consistência — nunca uma tentativa isolada). Esta skill **respeita esse gate cegamente**: o filtro do passo 3 da seção 3 ("só exercícios desbloqueados e não dominados") já impede, por construção, recomendar um exercício de nível mais avançado que o piloto não tenha direito de acessar ainda — mesmo que a dimensão mais fraca aponte tecnicamente para lá.

**Se a dimensão mais fraca não tem nenhum exercício desbloqueado que a alimente** (ex.: `Trail Braking` é a mais fraca, mas o piloto ainda está em Fundamentos): não force uma recomendação fora de alcance. Caia para o próximo exercício não dominado na ordem sequencial normal do nível atual — a forma honesta de dizer "ainda não dá pra atacar isso diretamente, mas seguir o caminho normal aproxima disso".

## 5. Casos de borda obrigatórios (PRD §10.5)

- **TC-501:** um padrão específico nos dados (ex.: "pressão mantida por tempo demais") precisa aparecer explicitamente no texto gerado, seguindo a estrutura da seção 1 — teste isso comparando o texto contra o valor bruto que originou a observação, não só "parece razoável".
- **TC-502:** dois exercícios com o mesmo score final, causas técnicas diferentes → textos diferentes. Isso é garantido pelo algoritmo da seção 1 (passo 2 sempre usa o valor bruto real, não o score) — se dois casos gerarem o mesmo texto, é sinal de que a implementação caiu de volta a usar só o score agregado, o que é um bug.
- **TC-503:** dimensão claramente mais fraca no Skill Profile → recomendação aponta para essa dimensão (seção 3).
- **TC-504:** exercício avançado completado mas Skill Profile mostra baixa consistência → não recomendar técnica ainda mais avançada em seguida. Isso é coberto pela seção 4: consistência baixa significa que `advance_condition` daquele exercício não foi cumprida (a condição sempre inclui consistência, `braking-training-engine` §1), logo ele continua no filtro "não dominado" e nada além dele é liberado.

## 6. Nota sobre implementação do texto

Esta skill define **o que** o texto precisa conter e **de onde** vêm os dados — não exige uma técnica de geração específica (templates fixos com interpolação de valores, ou um modelo de linguagem gerando a frase final a partir dos mesmos 3 dados). Qualquer abordagem escolhida na implementação real precisa, ainda assim, respeitar o algoritmo da seção 1: a entrada sempre inclui o valor bruto específico da tentativa, nunca só "score baixo em X" sem o número por trás. Se a abordagem escolhida for um modelo de linguagem, o prompt deve **incluir os 3 dados já resolvidos** (observação numérica, explicação técnica, ação sugerida) e pedir só a costura da frase — nunca deixar o modelo "decidir" o conteúdo técnico sozinho, isso reabriria o risco de feedback genérico que RF-501 existe para evitar.

## 7. Assunções provisórias registradas (ajustáveis)

- **Janela de "sub-score médio recente"** usada nos passos 2/3 das seções 2 e 3: proposta como a média do último bloco de tentativas (mesmas 5 tentativas usadas em `braking-training-engine`/`evaluation-scoring-engine`), não o histórico inteiro — mais sensível a progresso recente.
- **Critério de desempate** quando dois exercícios do subconjunto filtrado (seção 3) têm o mesmo sub-score médio: proposto usar o de menor `difficulty` (mais cedo no catálogo) como desempate, por ser o mais imediatamente acionável.
