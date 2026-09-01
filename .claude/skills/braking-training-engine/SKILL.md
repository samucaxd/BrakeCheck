---
name: braking-training-engine
description: Define o catálogo completo de exercícios de frenagem do Brake Check (Fundamentos/Intermediário/Avançado), o schema obrigatório de cada exercício, o fluxo de execução de uma tentativa, e a regra de avanço de nível baseada em domínio + consistência (RF-301 a RF-307, RN-03). Use esta skill sempre que for implementar a trilha de treinamento, adicionar/editar um exercício, ou decidir se um usuário pode acessar determinado exercício ou avançar de nível — ela não calcula scores, só define o que cada exercício exige e como o fluxo de execução funciona.
---

# Braking Training Engine

Cobre RF-301 a RF-307 e RN-03. Consome métricas da `telemetry-engine` (via `Attempt.derived_metrics`) para definir critérios de sucesso e o que cada exercício mede — mas **não calcula scores**. Sub-scores e score agregado são da `evaluation-scoring-engine`; texto de feedback é da `coach-engine`.

## 1. Schema obrigatório de exercício (RF-305)

Todo exercício do catálogo (seção 3) preenche estes 11 campos, sem exceção:

| Campo | O que descreve |
|---|---|
| `name` | Nome do exercício |
| `level` | `fundamentos` \| `intermediario` \| `avancado` |
| `technique` | Técnica específica treinada (uma das listadas em RF-302/303/304) |
| `objective` | O que o piloto deve conseguir fazer ao final |
| `explanation` | Conceito técnico por trás da técnica, em 1-3 frases |
| `instructions` | O que o piloto deve fazer fisicamente durante a tentativa |
| `difficulty` | Posição do exercício dentro do nível (1 = introdutório do nível, crescente) |
| `metrics_used` | Quais métricas da `telemetry-engine` (§4 daquela skill) alimentam este exercício |
| `success_criteria` | Limiares objetivos que definem uma tentativa bem-sucedida |
| `scoring_rules` | Quais sub-scores (RN-01) esse exercício produz, e o que cada um mede |
| `feedback_focus` | Pontos técnicos que a `coach-engine` deve observar ao gerar feedback (não é o texto em si — é o que olhar) |
| `advance_condition` | Condição de domínio + consistência para este exercício contar como "dominado" (RN-03) |

**Todos os limiares numéricos no catálogo (seção 3) são assunções provisórias** — o PRD registra explicitamente (seção 16) que valores numéricos exatos ficam para a fase de design desta skill, sem travar o documento. Ajuste-os com uso real; a lista completa está resumida na seção 6 para facilitar revisão.

## 2. Fluxo de execução de um exercício (RF-306)

```
Preparação/Instruções → Contagem regressiva → N tentativas → Encerramento + Resultado
```

1. **Preparação/instruções:** exibir `objective`, `explanation` e `instructions` do exercício antes de iniciar.
2. **Contagem regressiva:** 3 segundos (assunção provisória) antes de começar a capturar a primeira tentativa.
3. **N tentativas:** captura sequencial de tentativas, cada uma virando um `Attempt`. `N = 5` por sessão de exercício é a assunção provisória — mesmo valor usado como referência em `telemetry-engine` (RF-209/TC-205/TC-206) para consistência.
4. **Encerramento:** ao fim da N-ésima tentativa, apresentar o resultado agregado (scores vêm da `evaluation-scoring-engine`, mas esta skill é responsável por sinalizar que o bloco de tentativas terminou e disparar o cálculo).

## 3. Catálogo de exercícios

### Nível: Fundamentos (RF-302)

#### 1. Controle do Pedal de Freio

| Campo | Conteúdo |
|---|---|
| Objetivo | Reconhecer a faixa de curso do pedal e sustentar um valor de pressão constante por um tempo determinado |
| Explicação | Antes de qualquer técnica de frenagem, o piloto precisa sentir a relação entre o curso do pedal e o resultado — a base de tudo que vem depois |
| Instruções | Aplicar o freio até atingir uma faixa-alvo indicada (ex.: 30–40%) e mantê-lo dentro dela pelo tempo pedido |
| Dificuldade | 1 |
| Métricas usadas | `time_in_pressure_range_ms`, `brake.min/max` |
| Critérios de sucesso | Permanecer na faixa-alvo por ≥ 80% da janela pedida (ex.: 2s de 2,5s pedidos) |
| Forma de pontuação | Sub-score único: "Controle de pressão" |
| Foco de feedback | Se o piloto oscila (entra/sai da faixa) ou não atinge a faixa de forma alguma |
| Condição de avanço | 3 tentativas consecutivas cumprindo o critério de sucesso, com `coefficient_of_variation` do tempo-na-faixa ≤ 0,25 |

#### 2. Aplicação Progressiva

| Campo | Conteúdo |
|---|---|
| Objetivo | Aplicar o freio de forma suave e crescente, sem degrau/pico abrupto no início |
| Explicação | Aplicação abrupta transfere peso bruscamente e reduz a aderência disponível logo no início da frenagem |
| Instruções | Iniciar a frenagem a partir de zero e chegar à pressão-alvo de forma gradual, sem "chute" no pedal |
| Dificuldade | 2 |
| Métricas usadas | `brake.events[].application_speed_pct_per_s` |
| Critérios de sucesso | Velocidade de aplicação dentro de uma faixa-alvo (nem rápido demais — chute — nem devagar demais): ex. 150–350 %/s |
| Forma de pontuação | Sub-score: "Aplicação inicial" |
| Foco de feedback | Se a aplicação foi abrupta (acima da faixa) ou hesitante (abaixo da faixa) |
| Condição de avanço | Score sustentado ≥ 70 em 3 de 5 tentativas + `coefficient_of_variation` da velocidade de aplicação ≤ 0,3 |

#### 3. Frenagem em Linha Reta

| Campo | Conteúdo |
|---|---|
| Objetivo | Executar uma frenagem completa (início ao fim) mantendo o carro em linha reta (proxy: `steering` estável) |
| Explicação | Combina aplicação, sustentação e liberação em uma sequência única, ainda sem a complexidade de curva |
| Instruções | Frear do início ao fim de uma reta simulada, minimizando correções de volante durante a frenagem |
| Dificuldade | 3 |
| Métricas usadas | `brake.events[]` completo, `steering.min/max` durante o evento de frenagem |
| Critérios de sucesso | Variação de `steering` durante o evento de frenagem dentro de ±10 (escala -100 a 100) |
| Forma de pontuação | Sub-scores: "Aplicação inicial" + "Consistência direcional" |
| Foco de feedback | Se houve correção de volante perceptível durante a frenagem, e em que ponto da frenagem isso ocorreu |
| Condição de avanço | 3 de 5 tentativas dentro do critério de sucesso |

#### 4. Controle da Pressão

| Campo | Conteúdo |
|---|---|
| Objetivo | Sustentar uma pressão de freio constante por uma janela mais longa que o exercício 1, sob leve variação de exigência |
| Explicação | Consolida o controle fino do exercício 1 antes de introduzir modulação (nível intermediário) |
| Instruções | Manter o freio dentro de uma faixa-alvo estreita (ex.: ±5%) por 3-4 segundos |
| Dificuldade | 4 |
| Métricas usadas | `time_in_pressure_range_ms`, `brake.min/max` |
| Critérios de sucesso | Permanecer na faixa-alvo por ≥ 85% da janela pedida |
| Forma de pontuação | Sub-score: "Controle de pressão" |
| Foco de feedback | Padrão de oscilação (se existe, e se cresce ou diminui ao longo da tentativa) |
| Condição de avanço | 3 de 5 tentativas cumprindo o critério + `coefficient_of_variation` ≤ 0,2 |

#### 5. Consistência

| Campo | Conteúdo |
|---|---|
| Objetivo | Repetir a mesma frenagem (mesma aplicação, mesmo pico, mesma liberação) várias vezes seguidas |
| Explicação | É o primeiro exercício em que "consistência" é o próprio objetivo, não um efeito colateral — prepara o piloto para RN-03 |
| Instruções | Executar 5 frenagens buscando reproduzir o mesmo padrão em todas |
| Dificuldade | 5 |
| Métricas usadas | consistência entre tentativas (`telemetry-engine` §3, RF-209) sobre `application_speed_pct_per_s` e `brake.max` |
| Critérios de sucesso | `coefficient_of_variation` ≤ 0,15 entre as 5 tentativas, em ambas as métricas |
| Forma de pontuação | Sub-score: "Consistência" |
| Foco de feedback | Qual das 5 tentativas mais destoou das demais, e em que métrica |
| Condição de avanço | Critério de sucesso cumprido no bloco de 5 tentativas (não precisa repetir bloco, já é uma medida de repetição) |

#### 6. Ponto de Frenagem

| Campo | Conteúdo |
|---|---|
| Objetivo | Iniciar a frenagem em um momento/local consistente, não aleatório |
| Explicação | Fecha os Fundamentos conectando "quando frear" a tudo que já foi treinado sobre "como frear" |
| Instruções | Iniciar a frenagem assim que um marcador (visual/sonoro, definido pela `simulator-ui-design`) aparecer, minimizando o atraso de reação |
| Dificuldade | 6 |
| Métricas usadas | tempo entre o marcador e o início do evento de frenagem (`brake.events[].start_ms` relativo ao timestamp do marcador — este delta é calculado aqui, na `braking-training-engine`, pois é específico deste exercício, não uma métrica genérica da `telemetry-engine`) |
| Critérios de sucesso | Delta de reação ≤ 400ms (assunção provisória — depende de teste real de percepção humana) e `coefficient_of_variation` do delta ≤ 0,25 entre tentativas |
| Forma de pontuação | Sub-score: "Ponto de frenagem" |
| Foco de feedback | Se o piloto está reagindo tarde (delta alto) ou de forma inconsistente (delta variável) |
| Condição de avanço | 3 de 5 tentativas dentro do critério + consistência do delta |

**Gate de nível (Fundamentos → Intermediário):** os 6 exercícios acima precisam estar todos com `advance_condition` cumprida (ver seção 5) — não só o último da lista.

### Nível: Intermediário (RF-303)

#### 7. Threshold Braking

| Campo | Conteúdo |
|---|---|
| Objetivo | Frear no limite máximo de aderência sem travar as rodas (definição do glossário, PRD §14) |
| Explicação | O ponto ótimo de frenagem fica logo abaixo do travamento — treinar a sensibilidade para ficar perto desse limite sem ultrapassá-lo |
| Instruções | Aplicar o freio buscando o valor mais alto sustentável sem "bloqueio" (proxy de bloqueio: definido pela integração de física do simulador, fora de escopo desta skill — ver nota abaixo) |
| Dificuldade | 1 |
| Métricas usadas | `brake.events[].peak_value`, `time_in_pressure_range_ms` na faixa alvo (ex.: 85–95%) |
| Critérios de sucesso | Pico dentro da faixa 85–95% sustentado por ≥ 60% do evento de frenagem |
| Forma de pontuação | Sub-scores: "Aplicação inicial" + "Controle de pressão" |
| Foco de feedback | Se o piloto está frenando abaixo do limite (conservador) ou ultrapassando (agressivo demais) |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

> Nota: o V1 não tem telemetria de jogo (non-goal, PRD §3), então "travamento de roda" real não é observável por este sistema — o critério de sucesso usa a faixa de pico do pedal como proxy. Isso é uma limitação conhecida, não um erro desta skill.

#### 8. Frenagem Máxima

| Campo | Conteúdo |
|---|---|
| Objetivo | Atingir e sustentar a maior pressão de freio possível pelo maior tempo útil |
| Explicação | Trabalha o extremo superior da faixa de threshold braking, com foco em não hesitar |
| Instruções | Frear o mais forte possível assim que o sinal de início aparecer, sustentando o pico |
| Dificuldade | 2 |
| Métricas usadas | `brake.events[].peak_value`, `application_speed_pct_per_s` |
| Critérios de sucesso | Pico ≥ 90% e velocidade de aplicação ≥ 300 %/s |
| Forma de pontuação | Sub-score: "Aplicação inicial" |
| Foco de feedback | Se o piloto hesitou antes de atingir o pico (velocidade de aplicação baixa apesar do pico alto) |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

#### 9. Modulação do Pedal

| Campo | Conteúdo |
|---|---|
| Objetivo | Ajustar a pressão do freio de forma contínua e fina, não binária (glossário, PRD §14) |
| Explicação | Contrapõe a frenagem máxima do exercício anterior — aqui o ponto é variar a pressão sob comando, não só chegar ao pico |
| Instruções | Seguir uma sequência de faixas-alvo de pressão que mudam durante a mesma tentativa (ex.: 40% → 70% → 50%) |
| Dificuldade | 3 |
| Métricas usadas | `time_in_pressure_range_ms` por sub-faixa da sequência |
| Critérios de sucesso | ≥ 70% de tempo dentro de cada sub-faixa da sequência |
| Forma de pontuação | Sub-score: "Controle de pressão" |
| Foco de feedback | Em qual transição da sequência o piloto perdeu mais tempo fora da faixa |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

#### 10. Liberação Progressiva do Freio

| Campo | Conteúdo |
|---|---|
| Objetivo | Soltar o pedal de forma controlada, não abrupta (glossário: brake release) |
| Explicação | Prepara para trail braking no nível avançado — liberação abrupta desestabiliza o carro na entrada de curva |
| Instruções | Após atingir o pico, soltar o freio de forma gradual até zero |
| Dificuldade | 4 |
| Métricas usadas | `brake.events[].release_speed_pct_per_s` |
| Critérios de sucesso | Velocidade de liberação dentro de uma faixa-alvo (nem solta de uma vez nem trava sustentando): ex. 100–250 %/s |
| Forma de pontuação | Sub-score: "Liberação" |
| Foco de feedback | Se a liberação foi abrupta (acima da faixa) ou o piloto ficou "preso" no pedal (abaixo da faixa) |
| Condição de avanço | 3 de 5 tentativas dentro do critério + `coefficient_of_variation` da velocidade de liberação ≤ 0,3 |

#### 11. Controle da Pressão Durante a Desaceleração

| Campo | Conteúdo |
|---|---|
| Objetivo | Ajustar a pressão do freio conforme a velocidade (simulada) cai ao longo da frenagem, não manter valor fixo do início ao fim |
| Explicação | Fecha o Intermediário simulando a necessidade real de reduzir pressão gradualmente conforme a aderência disponível muda com a desaceleração |
| Instruções | Iniciar no pico de threshold braking e reduzir a pressão de forma acompanhada de um perfil-alvo decrescente ao longo do evento |
| Dificuldade | 5 |
| Métricas usadas | comparação amostra-a-amostra entre `brake` observado e o perfil-alvo decrescente do exercício (curva de referência definida no próprio exercício, não uma métrica genérica de `telemetry-engine`) |
| Critérios de sucesso | Desvio médio em relação ao perfil-alvo ≤ 10 pontos percentuais ao longo do evento |
| Forma de pontuação | Sub-scores: "Controle de pressão" + "Liberação" |
| Foco de feedback | Em que fase da frenagem (início/meio/fim) o desvio do perfil-alvo foi maior |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

**Gate de nível (Intermediário → Avançado):** os 5 exercícios acima precisam estar todos com `advance_condition` cumprida.

### Nível: Avançado (RF-304)

#### 12. Trail Braking

| Campo | Conteúdo |
|---|---|
| Objetivo | Manter parte da frenagem enquanto já se inicia o giro do volante na entrada da curva (glossário, PRD §14) |
| Explicação | Combina liberação progressiva (exercício 10) com início de esterçamento sobreposto no tempo |
| Instruções | Iniciar a liberação do freio e, antes de soltar completamente, começar a girar o volante em direção à curva |
| Dificuldade | 1 |
| Métricas usadas | `overlap_ms`/`overlap_pct_of_duration` — reaproveitado aqui como overlap entre `brake` residual e início de `steering` (não brake×throttle; a `braking-training-engine` reusa a mesma lógica de overlap da `telemetry-engine` §3 aplicada a outro par de canais) |
| Critérios de sucesso | Overlap entre liberação de freio e início de esterçamento ≥ 200ms, com velocidade de liberação ainda dentro da faixa "progressiva" do exercício 10 |
| Forma de pontuação | Sub-scores: "Liberação" + "Consistência direcional" |
| Foco de feedback | Se o piloto solta o freio totalmente antes de esterçar (zero overlap) ou esterça antes de começar a soltar (ordem invertida) |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

#### 13. Brake Release

| Campo | Conteúdo |
|---|---|
| Objetivo | Refinar a liberação do freio especificamente no contexto de entrada em curva (vs. o exercício 10, que era em linha reta) |
| Explicação | Mesma habilidade de liberação progressiva, mas agora sob a exigência adicional de coordenação com o volante |
| Instruções | Repetir o padrão do trail braking (exercício 12), mas com foco avaliativo na suavidade da liberação, não no overlap em si |
| Dificuldade | 2 |
| Métricas usadas | `brake.events[].release_speed_pct_per_s` durante um evento com `steering` não-neutro |
| Critérios de sucesso | Velocidade de liberação dentro da mesma faixa-alvo do exercício 10, mesmo com volante em movimento |
| Forma de pontuação | Sub-score: "Liberação" |
| Foco de feedback | Se a presença de esterçamento simultâneo piora a suavidade da liberação em relação ao exercício 10 (comparação entre os dois exercícios, se histórico disponível) |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

#### 14. Transferência de Peso

| Campo | Conteúdo |
|---|---|
| Objetivo | Reconhecer, na própria técnica de pedal, o timing que respeita a transferência de peso dinâmica do carro (glossário, PRD §14) |
| Explicação | Não mede a física do carro diretamente (fora de escopo, sem telemetria de jogo) — mede se o padrão de aplicação/liberação do piloto é compatível com o timing que a transferência de peso exige (aplicação não muito súbita, sustentação estável antes de qualquer esterçamento maior) |
| Instruções | Executar uma frenagem completa seguida de entrada em curva, respeitando um intervalo mínimo de estabilização entre o pico de frenagem e o início do esterçamento mais acentuado |
| Dificuldade | 3 |
| Métricas usadas | `brake.events[].application_speed_pct_per_s`, tempo entre `brake` pico e início de variação acentuada de `steering` |
| Critérios de sucesso | Intervalo de estabilização ≥ 150ms (assunção provisória) entre pico de freio e esterçamento acentuado |
| Forma de pontuação | Sub-scores: "Aplicação inicial" + "Consistência direcional" |
| Foco de feedback | Se o piloto está esterçando antes do carro "assentar" (intervalo curto demais) |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

> Nota: como no exercício 7, este é um proxy comportamental (timing de pedal/volante), não uma medição física real do carro — reforça a limitação registrada no PRD §12 sobre não depender de telemetria de jogo.

#### 15. Relação entre Frenagem e Rotação do Carro

| Campo | Conteúdo |
|---|---|
| Objetivo | Ajustar a intensidade da frenagem residual (trail braking) proporcionalmente ao quanto o volante está girado |
| Explicação | Trail braking avançado: quanto mais o carro está girando, menos freio residual é seguro manter — o piloto deve reduzir o freio conforme o volante gira mais |
| Instruções | Durante a fase de trail braking, reduzir a pressão de freio residual de forma proporcional ao aumento do ângulo de volante |
| Dificuldade | 4 |
| Métricas usadas | correlação amostra-a-amostra entre `brake` (decrescente) e `abs(steering)` (crescente) durante a fase de overlap identificada no exercício 12 |
| Critérios de sucesso | Correlação negativa com `|r| ≥ 0.6` entre `brake` e `abs(steering)` na janela de overlap |
| Forma de pontuação | Sub-scores: "Liberação" + "Consistência direcional" |
| Foco de feedback | Se o piloto mantém freio residual constante independente do ângulo de volante (correlação fraca) em vez de reduzir proporcionalmente |
| Condição de avanço | 3 de 5 tentativas dentro do critério |

#### 16. Combinação entre Frenagem, Steering e Throttle

| Campo | Conteúdo |
|---|---|
| Objetivo | Executar a sequência completa — frenagem, trail braking, e retomada de aceleração — como um único movimento fluido |
| Explicação | Exercício de síntese do nível Avançado: junta liberação progressiva, trail braking e o início da aceleração de saída, que é onde `throttle` volta a aparecer de forma relevante |
| Instruções | Executar uma frenagem completa com trail braking e, ao final do esterçamento, retomar o acelerador de forma progressiva (sem overlap abrupto brake×throttle) |
| Dificuldade | 5 |
| Métricas usadas | `overlap_ms`/`overlap_pct_of_duration` (brake×throttle, definição original da `telemetry-engine`), mais as métricas dos exercícios 12 e 15 |
| Critérios de sucesso | Overlap brake×throttle ≤ 100ms (retomada limpa, sem pisar nos dois ao mesmo tempo de forma não-intencional) e critérios dos exercícios 12/15 mantidos |
| Forma de pontuação | Sub-scores: "Aplicação inicial", "Liberação" e "Consistência direcional" (combina os três) |
| Foco de feedback | Qual das três fases (frenagem, trail braking, retomada) está com o resultado mais fraco nesta tentativa especificamente |
| Condição de avanço | 3 de 5 tentativas dentro do critério — este é o exercício de fechamento da V1 (não há próximo nível na V1; RF-505/RN-05 na `coach-engine` decide o que recomendar depois disso, dentro do próprio nível Avançado) |

## 4. Métricas que esta skill calcula (fora da `telemetry-engine`)

Alguns exercícios (6, 12, 14, 15, 16) usam medidas que combinam canais de um jeito específico do exercício (ex.: overlap freio×volante, correlação freio×ângulo, delta de reação a um marcador). Essas **não** são métricas genéricas da `telemetry-engine` — são cálculos específicos de exercício, implementados aqui, reaproveitando as primitivas que a `telemetry-engine` já expõe (ex.: a mesma lógica de "tempo de overlap entre dois canais acima de um limiar" usada em RF-208, só que aplicada a outro par de canais). Se um cálculo específico de exercício amadurecer e passar a ser útil de forma genérica, promova-o para a `telemetry-engine` em vez de duplicar.

## 5. Regra de avanço de nível (RF-307, RN-03)

- **Dentro de um nível:** os exercícios são desbloqueados na ordem listada no catálogo (decisão provisória de design — o PRD não define ordem intra-nível explicitamente, mas manter uma progressão sequencial é mais seguro pedagogicamente que liberar tudo de uma vez).
- **Entre níveis (RF-307):** um exercício de um nível só fica acessível se **todos** os exercícios do nível anterior tiverem sua `advance_condition` cumprida — não apenas o último da lista. Essa é a leitura mais estrita e mais segura de RN-03 ("avanço não deve se basear em completar um exercício uma vez"), aplicada ao nível inteiro, não só ao exercício individual.
- **RN-03 dentro de cada exercício:** a `advance_condition` de cada exercício (ver catálogo) sempre combina (a) um score mínimo sustentado ao longo de múltiplas tentativas e (b) baixa variabilidade entre elas (`coefficient_of_variation` da `telemetry-engine`) — nunca um "score alto uma vez só".
- Se um usuário tentar acessar um exercício sem o gate cumprido, a UI deve bloquear o acesso e explicar o motivo (TC-305) — a lógica de bloqueio (retornar `locked: true` + a lista do que falta) é desta skill; a exibição é da `simulator-ui-design`.

## 6. Resumo de assunções provisórias (revisar com uso real)

| Assunção | Valor proposto | Onde |
|---|---|---|
| Nº de tentativas por bloco de exercício | 5 | Fluxo de execução (§2) |
| Duração da contagem regressiva | 3s | Fluxo de execução (§2) |
| Faixa-alvo de pressão sustentada (Fundamentos, ex. 1 e 4) | 30–40% / ±5% | Catálogo |
| Faixa-alvo de threshold braking | 85–95% | Exercício 7 |
| Velocidade de aplicação "boa" | 150–350 %/s (Fundamentos) / ≥ 300 %/s (Frenagem Máxima) | Exercícios 2, 8 |
| Velocidade de liberação "boa" | 100–250 %/s | Exercícios 10, 13 |
| Delta de reação ao ponto de frenagem | ≤ 400ms | Exercício 6 |
| Intervalo de estabilização pós-pico antes de esterçar | ≥ 150ms | Exercício 14 |
| Overlap mínimo de trail braking | ≥ 200ms | Exercício 12 |
| Overlap máximo brake×throttle na retomada | ≤ 100ms | Exercício 16 |
| Correlação mínima freio-residual × ângulo | \|r\| ≥ 0,6 | Exercício 15 |
| `coefficient_of_variation` aceitável (consistência) | 0,15–0,3 dependendo do exercício | Catálogo |
| Ordem de desbloqueio intra-nível | Sequencial, na ordem do catálogo | §5 |
| Gate de avanço de nível | Todos os exercícios do nível, não só o último | §5 |
