# Brake Check — PRD (Product Requirements Document)

| Campo | Valor |
|---|---|
| Versão | 1.0 |
| Data | 2026-09-01 |
| Autor / Owner | Usuário (piloto/desenvolvedor único) |
| Status | Rascunho para revisão |
| Escopo deste documento | Versão 1 (V1) do Brake Check |

## Sumário

1. Visão Geral
2. Objetivos do Produto (V1)
3. Fora de Escopo (Non-goals)
4. Usuário e Contexto de Uso
5. Arquitetura de Alto Nível
6. Requisitos Funcionais
7. Requisitos Não-Funcionais
8. Modelo de Dados (alto nível)
9. Regras de Negócio Específicas
10. Cenários de Teste
11. Critérios de Aceitação da V1
12. Riscos e Premissas Técnicas
13. Roadmap Futuro (V2+)
14. Glossário
15. Rastreabilidade — Requisitos × Skills
16. Validação de Completude do PRD

---

## 1. Visão Geral

**Brake Check** é um software pessoal de treinamento de pilotagem para simuladores de corrida, com foco inicial em técnicas de frenagem para Fórmula 1. Ele atua como um **coach virtual**, transformando os inputs físicos do volante Logitech G29 (volante, freio, acelerador) em telemetria, análise técnica, exercícios progressivos e feedback acionável.

O software é de uso pessoal e exclusivo do autor/requerente. Não é um produto para distribuição, não tem múltiplos usuários, e não depende de nenhum jogo específico para funcionar — a técnica de pilotagem é avaliada a partir do comportamento no próprio periférico, independentemente do que acontece dentro do simulador.

**Princípio fundamental do produto** (critério de decisão para toda funcionalidade):

> Dados → Análise → Feedback → Exercício → Evolução

Toda feature deve responder "sim" à pergunta: *isso ajuda o piloto a entender o que está fazendo e melhorar sua técnica?* Funcionalidades que apenas exibem dados brutos sem gerar entendimento ou ação não atendem ao objetivo do produto.

---

## 2. Objetivos do Produto (V1)

O sistema deve ser capaz de:

1. Identificar o Logitech G29 conectado ao computador e detectar seus eixos/inputs.
2. Monitorar volante, freio e acelerador em tempo real.
3. Registrar sessões de treinamento.
4. Analisar a técnica de pilotagem do usuário a partir dos inputs capturados.
5. Oferecer exercícios progressivos de frenagem.
6. Avaliar o desempenho do usuário em cada exercício/tentativa.
7. Identificar pontos fracos na técnica do usuário.
8. Recomendar o próximo exercício mais adequado.
9. Acompanhar a evolução do usuário ao longo do tempo.
10. Permitir comparar diferentes sessões de treino.
11. Fornecer feedback técnico específico e não-genérico sobre a pilotagem.

O foco de conteúdo da V1 é **frenagem**. A arquitetura deve ser modular o suficiente para, no futuro, incorporar outras técnicas (curva, tração em saída de curva, etc.) sem redesenho estrutural.

---

## 3. Fora de Escopo (Non-goals) — V1

Para manter o foco e a qualidade da V1, os itens abaixo são **explicitamente excluídos** desta versão, mesmo que a arquitetura deva permitir sua adição futura:

- Suporte a volantes/periféricos além do Logitech G29.
- Integração com telemetria ou APIs de jogos (incluindo F1 26), tanto para entrada de dados quanto para validação cruzada.
- Múltiplos usuários, perfis ou contas — sistema é single-user por design.
- Suporte a macOS/Linux ou versão mobile/web.
- Sincronização em nuvem ou backup remoto.
- Técnicas de pilotagem fora de frenagem (curva, tração, gerenciamento de pneus/combustível etc.).
- Calibração ou tuning de force feedback do volante (o produto consome sinais de input, não configura o hardware).
- Qualquer forma de multiplayer, comparação social ou ranking entre usuários.

---

## 4. Usuário e Contexto de Uso

- **Usuário único**: o próprio requerente, piloto amador de simuladores de F1.
- **Ambiente**: PC Windows, com o G29 instalado (pedaleira + volante) já configurado no sistema operacional/drivers da Logitech.
- **Momento de uso**: o software pode ser usado tanto durante sessões no simulador (telemetria em tempo real, ao lado do jogo) quanto separadamente, como ambiente de treino técnico dedicado, sem o jogo aberto.
- **Nível de conhecimento do usuário**: já possui vocabulário técnico de pilotagem (threshold braking, trail braking etc.), então a interface e o coach podem usar terminologia técnica sem necessidade de simplificação excessiva.

---

## 5. Arquitetura de Alto Nível

```
G29
 ↓
Device Layer          → detecção e leitura bruta do hardware
 ↓
Input Processing      → calibração, deadzone, normalização em canais lógicos
 ↓
Telemetry Engine       → captura temporal + métricas derivadas
 ↓
Training Engine        → catálogo de exercícios + execução de tentativas
 ↓
Evaluation Engine      → scoring + Driving Skill Profile
 ↓
Coach Engine            → feedback contextual + recomendação adaptativa
 ↓
Persistence             → sessões, histórico, comparação
 ↓
UI                      → dashboard, telemetria ao vivo, replay, trilha
```

Cada camada consome apenas a saída da camada anterior — nenhuma camada deve pular etapas (ex.: a UI não lê o G29 diretamente; o Coach Engine não lê telemetria bruta, apenas métricas já avaliadas). Esse isolamento é o que permite, no futuro, trocar o Device Layer (novo volante) ou adicionar uma fonte extra de dados (telemetria de jogo) sem alterar as camadas de treino, avaliação e coach.

---

## 6. Requisitos Funcionais

Numeração usada para rastreabilidade: **RF-[camada][sequencial]**.

### 6.1 Device & Input Layer (RF-1xx)

| ID | Requisito |
|---|---|
| RF-101 | O sistema deve detectar automaticamente o G29 conectado via USB ao iniciar. |
| RF-102 | O sistema deve listar os eixos e inputs disponíveis do G29 (volante, freio, acelerador, embreagem se aplicável, botões). |
| RF-103 | O sistema deve ler valores brutos de volante, freio e acelerador em tempo real, a uma taxa de amostragem suficiente para capturar transições rápidas de frenagem (taxa exata a ser validada tecnicamente na skill `g29-input-layer`). |
| RF-104 | O sistema deve detectar desconexão do G29 durante uma sessão ativa e reagir sem corromper dados já capturados. |
| RF-105 | O sistema deve detectar reconexão do G29 e permitir retomar o uso sem reiniciar o software. |
| RF-106 | O sistema deve permitir calibração de mínimo/máximo por eixo (curso completo do pedal, batente a batente do volante). |
| RF-107 | O sistema deve aplicar uma deadzone configurável para eliminar ruído de repouso do sensor. |
| RF-108 | O sistema deve normalizar os sinais brutos para escalas lógicas: freio e acelerador em 0–100%, volante em uma escala simétrica (ex.: -100 a +100). |
| RF-109 | O sistema deve informar claramente quando nenhum G29 compatível é encontrado, sem travar ou quebrar a aplicação. |

### 6.2 Telemetry Engine (RF-2xx)

| ID | Requisito |
|---|---|
| RF-201 | Capturar, por amostra: valor de brake, throttle, steering e timestamp. |
| RF-202 | Registrar a duração total de cada sessão e de cada tentativa individual. |
| RF-203 | Calcular valores mínimo e máximo de cada canal por tentativa. |
| RF-204 | Calcular a velocidade de aplicação do freio (taxa de subida do curso do pedal). |
| RF-205 | Calcular a velocidade de liberação do freio (taxa de descida do curso do pedal). |
| RF-206 | Calcular o tempo em que o pedal permaneceu dentro de uma faixa de pressão determinada. |
| RF-207 | Calcular o tempo até o pedal atingir o curso máximo (pressão máxima) a partir do início da frenagem. |
| RF-208 | Detectar e quantificar sobreposição temporal entre brake e throttle (pisar nos dois pedais simultaneamente). |
| RF-209 | Calcular consistência entre tentativas de um mesmo exercício (ex.: variabilidade/desvio padrão das métricas-chave). |
| RF-210 | Armazenar tanto a série temporal bruta (para replay/gráficos) quanto as métricas derivadas (para scoring), por tentativa. |

### 6.3 Training Engine — Trilha e Exercícios (RF-3xx)

| ID | Requisito |
|---|---|
| RF-301 | O sistema deve organizar o treino de frenagem em 3 níveis progressivos: Fundamentos, Intermediário e Avançado. |
| RF-302 | **Fundamentos** deve cobrir, no mínimo: controle do pedal de freio, aplicação progressiva, frenagem em linha reta, controle da pressão, consistência, ponto de frenagem. |
| RF-303 | **Intermediário** deve cobrir, no mínimo: threshold braking, frenagem máxima, modulação do pedal, liberação progressiva do freio, controle da pressão durante a desaceleração. |
| RF-304 | **Avançado** deve cobrir, no mínimo: trail braking, brake release, transferência de peso, relação entre frenagem e rotação do carro, combinação entre frenagem/steering/throttle. |
| RF-305 | Cada exercício deve ser definido com: nome, objetivo, técnica treinada, explicação, instruções, nível de dificuldade, métricas utilizadas, critérios de sucesso, forma de pontuação, feedback associado e condição explícita para avançar ao próximo nível. |
| RF-306 | O sistema deve suportar um fluxo de execução de exercício: preparação/instruções → contagem regressiva → captura de N tentativas → encerramento e apresentação de resultado. |
| RF-307 | O sistema não deve permitir o acesso a um exercício cujos pré-requisitos de nível anterior não tenham sido cumpridos. |

*Nota: a especificação detalhada de cada exercício individual (todos os campos do RF-305 preenchidos, um a um) é conteúdo extenso e fica a cargo da skill `braking-training-engine`, não deste PRD — ver seção 16 para essa decisão registrada como premissa.*

### 6.4 Evaluation & Scoring Engine (RF-4xx)

| ID | Requisito |
|---|---|
| RF-401 | Calcular sub-scores por exercício/tentativa (ex.: aplicação inicial, controle de pressão, liberação, consistência), cada um em escala 0–100. |
| RF-402 | Calcular um score agregado 0–100 por tentativa e por exercício a partir dos sub-scores. |
| RF-403 | Classificar o desempenho em níveis: Bronze, Silver, Gold, Master, com faixas de corte definidas e documentadas. |
| RF-404 | Manter e atualizar o **Driving Skill Profile** do usuário com, no mínimo, as dimensões: Brake Control, Threshold Braking, Brake Release, Trail Braking, Steering Control, Throttle Control, Consistency. |
| RF-405 | Persistir o histórico de evolução de cada dimensão do Skill Profile ao longo do tempo (não apenas o valor mais recente). |

### 6.5 Coach Engine (RF-5xx)

| ID | Requisito |
|---|---|
| RF-501 | Gerar feedback textual contextualizado a partir dos dados capturados na tentativa/exercício — nunca um texto genérico desacoplado dos dados. |
| RF-502 | O feedback gerado deve, no mínimo: (a) identificar o problema observado, (b) explicar o impacto técnico desse problema, (c) sugerir uma ação concreta para a próxima tentativa. |
| RF-503 | Identificar, a partir do Driving Skill Profile, qual é o ponto mais fraco do piloto no momento. |
| RF-504 | Recomendar o próximo exercício com base na maior deficiência identificada, e não apenas na ordem sequencial da trilha. |
| RF-505 | Não recomendar/liberar avanço para técnicas mais complexas apenas porque um exercício foi "completado" — deve considerar domínio (score sustentado) e consistência ao longo de múltiplas tentativas/sessões. |

### 6.6 Sessions & Persistence (RF-6xx)

| ID | Requisito |
|---|---|
| RF-601 | Permitir criar, pausar, retomar, finalizar e salvar uma sessão de treino. |
| RF-602 | Persistir sessões localmente, sem dependência de conexão com a internet. |
| RF-603 | Permitir consultar o histórico de sessões anteriores. |
| RF-604 | Permitir comparar duas sessões específicas (ex.: Sessão #12 × Sessão #18), exibindo a evolução das métricas entre elas. |
| RF-605 | Em caso de encerramento abrupto do software durante uma sessão ativa, os dados já capturados não devem ser perdidos ou corrompidos. |

### 6.7 Telemetry Visualization & Replay (RF-7xx)

| ID | Requisito |
|---|---|
| RF-701 | Exibir gráfico Brake × Tempo para uma tentativa/sessão selecionada. |
| RF-702 | Exibir gráfico Throttle × Tempo. |
| RF-703 | Exibir gráfico Steering × Tempo. |
| RF-704 | Permitir comparação visual (overlay) entre diferentes tentativas. |
| RF-705 | Exibir comparação entre curva ideal (definida pelo exercício) e curva executada (dado real do usuário). |
| RF-706 | Permitir selecionar uma sessão anterior e reproduzir visualmente os inputs capturados, como se estivessem acontecendo em tempo real (replay). |
| RF-707 | Permitir comparar, dentro do replay, Tentativa A × Tentativa B. |

### 6.8 UI/UX (RF-8xx)

| ID | Requisito |
|---|---|
| RF-801 | A interface deve seguir estética de software profissional de simulador: dark mode, visual técnico, elementos inspirados em motorsport — não estética de aplicativo corporativo convencional. |
| RF-802 | A interface deve exibir telemetria em tempo real durante a execução de exercícios. |
| RF-803 | A interface deve ter hierarquia visual clara e baixa poluição visual, priorizando informação útil durante o treino. |
| RF-804 | A interface deve prover navegação entre: Dashboard, Trilha de Treinamento, Histórico de Sessões, Driving Skill Profile e Replay. |
| RF-805 | Indicadores de pontuação/nível devem ser exibidos de forma clara ao final de cada tentativa e de cada exercício. |

---

## 7. Requisitos Não-Funcionais (RNF)

| ID | Requisito |
|---|---|
| RNF-01 | Plataforma suportada na V1: Windows 10/11, exclusivamente. |
| RNF-02 | Dispositivo suportado na V1: Logitech G29, exclusivamente. |
| RNF-03 | O sistema deve funcionar de forma independente de qualquer jogo — nenhuma funcionalidade essencial pode depender de dados internos, API ou telemetria de jogo. |
| RNF-04 | A latência entre a leitura do input físico e sua exibição/registro deve ser imperceptível ao piloto durante o treino (orçamento de latência a ser validado tecnicamente; ordem de grandeza de dezenas de milissegundos fim-a-fim). |
| RNF-05 | Todo armazenamento de dados deve ser local — sem dependência de nuvem ou rede para o funcionamento essencial do software. |
| RNF-06 | O sistema é single-user — não há requisito de autenticação/multiusuário. |
| RNF-07 | A arquitetura em camadas deve permitir extensão futura (novos volantes, novas técnicas, telemetria de jogo, outros simuladores) sem reescrita das camadas já existentes. |
| RNF-08 | O sistema deve ser resiliente a desconexão do G29 e a encerramentos abruptos, sem corromper sessões/dados já persistidos. |
| RNF-09 | A instalação e execução devem ser viáveis em uma única máquina pessoal (não é requisito de produto empacotado para distribuição em massa nesta fase). |
| RNF-10 | Todo texto e terminologia da interface e do coach devem estar em português, salvo termos técnicos consagrados em inglês no automobilismo (ex.: "trail braking", "threshold braking"). |
| RNF-11 | O sistema não deve transmitir nenhum dado de telemetria, sessão ou Skill Profile para servidores externos. Todo processamento e armazenamento devem ocorrer localmente na máquina do usuário, sem telemetria de uso, analytics ou tracking embutido de qualquer natureza. |

---

## 8. Modelo de Dados (alto nível)

Este modelo é indicativo, para garantir que os requisitos funcionais sejam implementáveis de forma coerente entre as skills. O detalhamento técnico (tipos, banco/formato de armazenamento) fica a cargo das skills de cada camada.

- **Session**: `id, start_time, end_time, status (ativa/pausada/finalizada), device_info`
- **Attempt**: `id, session_id, exercise_id, timestamp, raw_samples_ref, derived_metrics, score_result, feedback`
- **TelemetrySample**: `timestamp, brake, throttle, steering`
- **Exercise**: `id, name, level, technique, objective, explanation, instructions, difficulty, metrics_used, success_criteria, scoring_rules, advance_condition`
- **ScoreResult**: `attempt_id, sub_scores{}, total_score, level (bronze/silver/gold/master)`
- **SkillProfile**: `brake_control, threshold_braking, brake_release, trail_braking, steering_control, throttle_control, consistency, history[]`

---

## 9. Regras de Negócio Específicas

**RN-01 — Formato de pontuação.** A pontuação de um exercício deve ser exibida como score total mais a decomposição em sub-scores, no formato:

```
Threshold Braking — 82/100
  Aplicação inicial:     91/100
  Controle de pressão:   78/100
  Liberação:             74/100
  Consistência:          85/100
```

**RN-02 — Driving Skill Profile.** Deve ser exibido como lista de dimensões com pontuação de evolução, por exemplo:

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

**RN-03 — Critério de avanço de nível.** Avanço de nível **não** deve se basear apenas em "completar" um exercício uma vez. Deve exigir: (a) score mínimo sustentado ao longo de múltiplas tentativas, e (b) consistência (baixa variabilidade) entre essas tentativas. Completar um exercício uma única vez com score alto e depois errar drasticamente não deve liberar o próximo nível.

**RN-04 — Estrutura obrigatória do feedback do coach.** Todo feedback gerado deve seguir a estrutura: *(1) o que foi observado nos dados* → *(2) qual o impacto técnico disso* → *(3) o que tentar na próxima tentativa*. Exemplo de referência:

> "Sua aplicação inicial de freio está consistente, mas você está mantendo pressão elevada por tempo demais. O principal ponto de melhoria neste exercício é trabalhar a liberação progressiva do pedal."

**RN-05 — Recomendação adaptativa.** O próximo exercício sugerido deve derivar da maior deficiência no Skill Profile, não da ordem padrão da trilha. Exemplo de fluxo de referência:

```
Trail Braking (Score: 58)
   ↓
Principal deficiência identificada: Brake Release
   ↓
Próximo exercício recomendado: Progressive Brake Release — Level 3
```

---

## 10. Cenários de Teste

Cenários organizados por módulo, cobrindo caminho feliz, casos de borda e tratamento de erro. Numeração: **TC-[camada][sequencial]**.

### 10.1 Device & Input Layer

| ID | Cenário |
|---|---|
| TC-101 | G29 já conectado e ligado antes do software abrir → deve ser detectado automaticamente, com eixos listados corretamente. |
| TC-102 | G29 conectado depois que o software já está aberto (hot-plug) → deve ser detectado sem reiniciar a aplicação. |
| TC-103 | G29 desconectado durante uma sessão ativa → sessão deve pausar automaticamente, usuário deve ser avisado, e os dados já capturados não podem ser perdidos. |
| TC-104 | Nenhum G29 conectado ao abrir o software → mensagem clara de dispositivo não encontrado, sem crash. |
| TC-105 | Calibração usando os extremos reais do hardware (freio 0%→100%, volante batente a batente) → normalização deve refletir corretamente os limites. |
| TC-106 | Ruído de repouso do pedal/volante (jitter do sensor parado) → deadzone deve eliminar esse ruído sem cortar movimentos pequenos intencionais. |
| TC-107 | Mais de um dispositivo de input conectado ao mesmo tempo → sistema deve identificar corretamente qual é o G29 e ignorar os demais. |

### 10.2 Telemetry Engine

| ID | Cenário |
|---|---|
| TC-201 | Frenagem em linha reta com padrão conhecido (gabarito) → métricas de velocidade de aplicação/liberação calculadas devem bater com o esperado. |
| TC-202 | Pisar em brake e throttle simultaneamente → overlap deve ser corretamente detectado e quantificado. |
| TC-203 | Tentativa extremamente curta (poucos ms de captura) → sistema não deve travar nem gerar métricas inválidas (ex.: divisão por zero). |
| TC-204 | Sessão longa e contínua (ex.: 1h) → sem degradação perceptível de performance ou vazamento de memória. |
| TC-205 | Cinco tentativas com padrão de input praticamente idêntico → métrica de consistência deve indicar baixa variabilidade. |
| TC-206 | Cinco tentativas com padrões de input muito diferentes entre si → métrica de consistência deve indicar alta variabilidade. |

### 10.3 Training Engine

| ID | Cenário |
|---|---|
| TC-301 | Iniciar exercício de nível Fundamentos → objetivo, instruções e critérios de sucesso são exibidos corretamente antes da execução. |
| TC-302 | Completar um exercício com score abaixo do mínimo definido → sistema não libera avanço de nível. |
| TC-303 | Completar um exercício com score alto, porém com alta variabilidade entre tentativas → sistema não libera avanço (falha em consistência, ver RN-03). |
| TC-304 | Completar critérios de domínio (score mínimo + consistência) ao longo de múltiplas tentativas → sistema libera o próximo exercício da trilha. |
| TC-305 | Tentar acessar diretamente um exercício avançado sem os pré-requisitos cumpridos → acesso bloqueado, com explicação do motivo. |

### 10.4 Evaluation & Scoring Engine

| ID | Cenário |
|---|---|
| TC-401 | Aplicação de freio muito abrupta em uma tentativa → sub-score de "aplicação inicial" deve refletir penalidade proporcional. |
| TC-402 | Liberação abrupta do freio (sem trail-off) → sub-score de "liberação" deve refletir penalidade. |
| TC-403 | Conjunto de sub-scores conhecidos → score agregado calculado deve corresponder ao valor esperado pela fórmula documentada. |
| TC-404 | Scores em torno dos limites de corte Bronze/Silver/Gold/Master → classificação deve respeitar exatamente os thresholds definidos (sem ambiguidade nas bordas). |
| TC-405 | Nova sessão concluída → Skill Profile deve ser atualizado preservando o histórico anterior (não deve sobrescrever, apenas adicionar um novo ponto). |

### 10.5 Coach Engine

| ID | Cenário |
|---|---|
| TC-501 | Padrão de "pressão mantida por tempo demais" nos dados → feedback gerado deve mencionar especificamente esse padrão, seguindo a estrutura da RN-04. |
| TC-502 | Dois exercícios com o mesmo score final, mas causas técnicas diferentes → feedbacks gerados devem ser diferentes entre si (não genéricos). |
| TC-503 | Skill Profile com uma dimensão claramente mais fraca → recomendação do próximo exercício deve apontar para essa dimensão. |
| TC-504 | Exercício avançado completado, mas Skill Profile mostra baixa consistência → sistema não deve recomendar técnica ainda mais avançada em seguida (ver RF-505). |

### 10.6 Sessions & Persistence

| ID | Cenário |
|---|---|
| TC-601 | Fluxo completo criar → pausar → retomar → finalizar → salvar → estado deve ser preservado corretamente em cada transição. |
| TC-602 | Encerramento abrupto do software (crash/fechamento forçado) durante sessão ativa → ao reabrir, sessão aparece como incompleta e recuperável, sem dados corrompidos. |
| TC-603 | Comparação entre Sessão #12 e Sessão #18 → diferenças de métricas calculadas e exibidas corretamente. |
| TC-604 | Histórico com grande volume de sessões (ex.: 100+) → tempo de carregamento da lista permanece aceitável. |

### 10.7 Visualization & Replay

| ID | Cenário |
|---|---|
| TC-701 | Gráfico Brake × Tempo de uma tentativa → reflete fielmente os dados brutos capturados, sem distorção de escala/tempo. |
| TC-702 | Overlay de curva ideal × curva executada → exibido de forma legível, com eixos alinhados corretamente. |
| TC-703 | Replay de uma sessão antiga → reproduz os inputs na ordem e no timing originais. |
| TC-704 | Comparação de Tentativa A × Tentativa B com durações diferentes → eixos temporais alinhados de forma que a comparação continue fazendo sentido. |

### 10.8 UI/UX

| ID | Cenário |
|---|---|
| TC-801 | Interface durante pilotagem ativa → informações essenciais permanecem legíveis em visão periférica (alto contraste, elementos grandes o suficiente). |
| TC-802 | Navegação entre Dashboard, Trilha, Histórico, Skill Profile e Replay → sem perda de dados não salvos ou de contexto da sessão ativa. |
| TC-803 | Fim de uma tentativa → indicador de pontuação/nível atualiza em tempo real, sem necessidade de recarregar a tela. |

### 10.9 Não-Funcionais / Performance

| ID | Cenário |
|---|---|
| TC-901 | Medição de latência ponta a ponta (input físico → exibição/registro) → dentro do orçamento definido em RNF-04. |
| TC-902 | Software operando sem conexão à internet → todas as funcionalidades essenciais continuam funcionando (RNF-03, RNF-05). |
| TC-903 | Reinício do PC/software → todas as sessões e todo o Skill Profile anteriores permanecem íntegros. |

---

## 11. Critérios de Aceitação da V1 (Definition of Done)

A V1 é considerada pronta quando, cumulativamente:

- [ ] O G29 é detectado automaticamente e seus três canais principais (freio, acelerador, volante) são lidos em tempo real com a taxa de amostragem validada tecnicamente.
- [ ] Existe ao menos um exercício funcional e completo (todos os campos do RF-305) em cada um dos três níveis (Fundamentos, Intermediário, Avançado).
- [ ] O sistema calcula e exibe sub-scores e score agregado por tentativa, com classificação Bronze/Silver/Gold/Master.
- [ ] O Driving Skill Profile é calculado, persistido e atualizado após cada sessão.
- [ ] O Coach Engine gera feedback estruturado (RN-04) e recomendação adaptativa (RN-05) de forma não-genérica, verificável nos cenários TC-501 a TC-504.
- [ ] É possível criar, pausar, retomar, finalizar e salvar sessões, e comparar duas sessões distintas.
- [ ] É possível visualizar os gráficos Brake/Throttle/Steering × Tempo e reproduzir o replay de uma sessão anterior.
- [ ] A interface segue a diretriz visual definida (dark mode, estética motorsport, baixa poluição visual) e permite navegar entre todas as telas do RF-804.
- [ ] Todos os cenários de teste da seção 10 foram executados ao menos uma vez, com resultado documentado.

---

## 12. Riscos e Premissas Técnicas

- **Acesso ao G29 no Windows ainda não validado.** O método técnico de leitura do dispositivo (qual API/biblioteca) não foi definido neste PRD por decisão consciente — deve ser pesquisado e validado tecnicamente na skill `g29-input-layer`, sem assumir que qualquer abordagem específica funcione antes de testar.
- **Natureza física do pedal do G29.** A pedaleira padrão do G29 usa potenciômetros (mede curso/posição), não célula de carga (não mede força real aplicada). Logo, tudo que o sistema chamar de "pressão" é, na prática, **posição/curso do pedal**, não força de pressão real. Isso deve ficar explícito na UI e na documentação para não criar expectativa incorreta de fidelidade.
- **Risco de feedback genérico.** É o maior risco de qualidade percebida do produto — mitigado pela estrutura obrigatória da RN-04 e pelos cenários TC-501/TC-502, que exigem que dois casos diferentes gerem feedbacks diferentes.
- **Limitação de escopo consciente.** Sem telemetria do jogo, o sistema analisa "o que o pedal/volante fizeram", não "o que o carro fez". Isso é uma limitação aceita da V1, não um defeito a corrigir agora.
- **Taxa de amostragem e latência.** Valores-alvo (RF-103, RNF-04) são estimativas iniciais e devem ser validados/ajustados com testes reais de hardware antes de serem tratados como requisito travado.
- **Limite de escala do histórico não definido numericamente.** O cenário TC-604 usa "100+ sessões" apenas como referência informal de volume, mas não há um número-alvo real (quantas sessões e quantos anos de histórico o sistema precisa suportar sem degradação perceptível). Este é um número que só o usuário pode definir com base no uso real esperado — fica como pergunta em aberto antes de travar RNF de performance de carregamento de histórico.

---

## 13. Roadmap Futuro (V2+) — fora de escopo agora, mas considerado na arquitetura

- Suporte a outros volantes/periféricos além do G29.
- Integração opcional com telemetria/API de jogos (ex.: F1 26) para cruzar técnica de pedal com comportamento real do carro.
- Novas técnicas de pilotagem além de frenagem (condução em curva, tração em saída de curva, gerenciamento de pneus).
- Suporte a outros simuladores além de referência ao F1 26.
- Possível expansão multiplataforma.

---

## 14. Glossário

| Termo | Definição |
|---|---|
| Threshold braking | Frenagem no limite máximo de aderência, sem travar as rodas. |
| Trail braking | Manter parte da frenagem enquanto já se inicia o giro do volante na entrada da curva. |
| Brake release | Ato de soltar o pedal de freio de forma controlada/progressiva. |
| Transferência de peso | Efeito dinâmico de deslocamento de peso do carro durante frenagem/aceleração, que afeta aderência dos pneus. |
| Modulação do pedal | Ajuste fino e contínuo da pressão aplicada ao pedal, em vez de aplicação binária (tudo ou nada). |
| Ponto de frenagem | Local/momento definido em que o piloto inicia a frenagem antes de uma curva. |
| Deadzone | Faixa de valores próximos ao repouso de um eixo que é ignorada para evitar ruído do sensor. |
| Skill Profile | Perfil de habilidades de pilotagem do usuário, com pontuação por dimensão técnica. |

---

## 15. Rastreabilidade — Requisitos × Skills

| Grupo de Requisitos | Skill responsável |
|---|---|
| RF-1xx (Device & Input) | `g29-input-layer` |
| RF-2xx (Telemetry Engine) | `telemetry-engine` |
| RF-3xx (Training Engine) | `braking-training-engine` |
| RF-4xx (Evaluation Engine) | `evaluation-scoring-engine` |
| RF-5xx (Coach Engine) | `coach-engine` |
| RF-6xx (Persistence) | `session-persistence` |
| RF-7xx (Visualization & Replay) | `telemetry-visualization-replay` |
| RF-8xx (UI/UX) | `simulator-ui-design` |
| RNF-* (transversais) | `brake-check-foundations` + todas as demais, cada uma na sua camada |
| Este PRD (completude) | `prd-validator` |

---

## 16. Validação de Completude do PRD

Checklist de tópicos padrão de um PRD de software, verificado contra este documento:

| Tópico | Status | Observação |
|---|---|---|
| Objetivos do produto | ✅ | Seção 2 |
| Escopo negativo (non-goals) | ✅ | Seção 3 |
| Usuário/contexto de uso | ✅ | Seção 4 |
| Arquitetura de alto nível | ✅ | Seção 5 |
| Requisitos funcionais rastreáveis | ✅ | Seção 6, com IDs RF-xxx |
| Requisitos não-funcionais | ✅ | Seção 7 |
| Modelo de dados | ✅ | Seção 8 (nível indicativo) |
| Regras de negócio | ✅ | Seção 9 |
| Cenários de teste (caminho feliz + borda + erro) | ✅ | Seção 10, por módulo |
| Critérios de aceitação / Definition of Done | ✅ | Seção 11 |
| Riscos e premissas técnicas | ✅ | Seção 12 |
| Roadmap futuro / fora de escopo mapeado | ✅ | Seção 13 |
| Glossário | ✅ | Seção 14 |
| Rastreabilidade requisitos → responsáveis | ✅ | Seção 15 |

**Itens conscientemente deferidos (não são lacunas, são decisões registradas):**

1. **Especificação individual completa de cada exercício** (todos os 16 itens de técnica listados nas seções Fundamentos/Intermediário/Avançado, com todos os campos do RF-305 preenchidos) não está neste PRD. Motivo: é conteúdo pedagógico extenso, mais apropriado para ser produzido junto com a skill `braking-training-engine`, que terá o contexto técnico necessário para definir métricas e critérios de sucesso realistas por exercício. O PRD trava a *estrutura obrigatória* (RF-305) e a *cobertura mínima por nível* (RF-302 a RF-304); o conteúdo exato fica para a fase de design da skill.
2. **Valores numéricos exatos** (taxa de amostragem mínima em Hz, orçamento de latência em ms, thresholds exatos de Bronze/Silver/Gold/Master, pesos da fórmula de score agregado) não estão travados neste documento — são tratados como premissas a validar tecnicamente (seção 12) para evitar comprometer o PRD com números que podem não se sustentar após teste real de hardware.
3. **Escolha de stack técnica** (linguagem/framework do software) não é requisito de produto e foi deliberadamente deixada fora do PRD — será definida como decisão técnica na skill `brake-check-foundations` / `g29-input-layer`.

Nenhum tópico padrão de PRD de software está ausente da estrutura deste documento. Os três itens acima são lacunas de **conteúdo/número específico**, não de **estrutura/requisito**, e estão explicitamente registrados para não serem esquecidos.
