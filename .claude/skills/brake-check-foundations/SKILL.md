---
name: brake-check-foundations
description: Contexto fundamental do projeto Brake Check — princípio central do produto, non-goals da V1, arquitetura em camadas e o contrato de dados entre elas, a disciplina obrigatória de validação técnica antes de implementar, e as decisões de stack técnica. Use esta skill no início de toda sessão de desenvolvimento do Brake Check, antes de implementar qualquer funcionalidade — e especialmente antes de qualquer trabalho que toque acesso ao hardware G29 ou que precise saber que dado uma camada entrega para a próxima.
---

# Brake Check — Foundations

Esta é a skill base do projeto **Brake Check**. Ela não substitui o PRD (`docs/prd/brake-check-prd.md`) nem o `CLAUDE.md` — ela existe para carregar, em toda sessão de desenvolvimento, o contexto mínimo que qualquer trabalho no projeto precisa ter em mente antes de tocar em código: o que o produto é para, como as camadas se conectam, como decidir antes de implementar, e com que stack técnica se está construindo.

Se algo aqui parecer conflitar com o PRD, o PRD é a fonte da verdade — sinalize a divergência em vez de resolvê-la silenciosamente.

## 1. Princípio central e non-goals da V1

**Princípio de decisão (PRD, seção 1):**

> Dados → Análise → Feedback → Exercício → Evolução

Toda funcionalidade nova — não só features grandes, também detalhes de UI ou de cálculo — deve responder "sim" a: *isso ajuda o piloto a entender o que está fazendo e melhorar sua técnica?* Uma tela que só exibe números brutos sem gerar entendimento ou ação não está pronta, mesmo que tecnicamente funcione.

**Non-goals explícitos da V1 (PRD, seção 3) — não implementar, mesmo que pareça pequeno ou tentador:**

- Suporte a volantes/periféricos além do Logitech G29.
- Integração com telemetria ou APIs de jogos (incluindo F1 26), como entrada de dados ou como validação cruzada.
- Múltiplos usuários, perfis ou contas — o sistema é single-user por design.
- Suporte a macOS/Linux ou versão mobile/web.
- Sincronização em nuvem ou backup remoto.
- Técnicas de pilotagem fora de frenagem (curva, tração, gerenciamento de pneus/combustível etc.).
- Calibração ou tuning de force feedback do volante (o produto consome sinais de input, não configura o hardware).
- Qualquer forma de multiplayer, comparação social ou ranking entre usuários.

Esses itens ficam de fora **mesmo que a arquitetura em camadas deva permitir adicioná-los depois** (RNF-07) — non-goal de conteúdo não é o mesmo que non-goal de arquitetura.

## 2. Arquitetura em camadas e contrato de dados entre elas

**Diagrama (PRD, seção 5):**

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

**Regra de isolamento:** cada camada só consome a saída da camada imediatamente anterior. Nunca pular etapas — ex.: a UI nunca lê o G29 diretamente; o Coach Engine nunca lê telemetria bruta, só métricas e scores já avaliados. Esse isolamento é o que permite trocar o Device Layer (novo volante, fora de escopo agora) ou adicionar uma fonte extra de dados (telemetria de jogo, fora de escopo agora) sem reescrever treino, avaliação ou coach.

**Contrato de dados entre camadas** — o que cada fronteira troca, com base no modelo de dados da seção 8 do PRD. Isto é uma leitura derivada dos RFs e do modelo de dados, não uma cópia literal do PRD — trate como guia de implementação, e reconcilie com o PRD se um RF específico exigir algo mais granular:

| De → Para | O que atravessa a fronteira | Entidades envolvidas (PRD §8) |
|---|---|---|
| G29 → Device Layer | Sinais físicos brutos do hardware (relatórios HID/USB) | — (fora do modelo de dados; é o próprio periférico) |
| Device Layer → Input Processing | Valores brutos por eixo/canal (volante, freio, acelerador, botões), na taxa de amostragem lida do dispositivo | — (dado bruto pré-calibração, RF-101 a RF-105) |
| Input Processing → Telemetry Engine | Amostra normalizada por canal: freio e acelerador em 0–100%, volante em escala simétrica (ex.: -100 a +100), já com deadzone e calibração aplicadas | `TelemetrySample { timestamp, brake, throttle, steering }` |
| Telemetry Engine → Training Engine | Série temporal bruta da tentativa (para replay/gráficos) **e** métricas derivadas já calculadas (min/máx, velocidade de aplicação/liberação, tempo em faixa, tempo até pico, overlap brake×throttle, consistência) | `TelemetrySample[]` (série) + métricas derivadas que compõem `Attempt.derived_metrics` |
| Training Engine → Evaluation Engine | A tentativa executada (qual exercício, métricas derivadas) mais os critérios de sucesso/regras de pontuação definidos pelo exercício | `Attempt { id, session_id, exercise_id, derived_metrics }` + `Exercise { success_criteria, scoring_rules }` |
| Evaluation Engine → Coach Engine | Resultado de pontuação da tentativa e o Driving Skill Profile atualizado (ou o delta relevante), para permitir identificar o ponto mais fraco | `ScoreResult { attempt_id, sub_scores{}, total_score, level }` + `SkillProfile` (snapshot atual) |
| Coach Engine → Persistence | Feedback textual estruturado (RN-04) anexado à tentativa, recomendação de próximo exercício, e o Skill Profile já atualizado para ser persistido com histórico | `Attempt.feedback` + `SkillProfile.history[]` (novo ponto) |
| Persistence → UI | Sessões, tentativas (com `score_result` e `feedback`), Skill Profile com histórico — prontos para exibição, comparação e replay | `Session`, `Attempt`, `SkillProfile` |

Se uma skill de camada específica (`g29-input-layer`, `telemetry-engine` etc.) precisar de um contrato mais detalhado que este, ela pode refiná-lo — mas não pode contradizer a direção do fluxo nem pular uma camada.

## 3. Disciplina obrigatória: analisar → validar tecnicamente → só então implementar

Vale para qualquer funcionalidade complexa, e é **inegociável** para qualquer coisa que toque acesso a hardware (G29):

1. Analise o requisito no PRD.
2. Defina a abordagem técnica.
3. Identifique dependências.
4. Avalie limitações de acesso ao hardware/dispositivo.
5. Proponha a implementação antes de escrever código.
6. Só então implemente.

**Nunca assuma que uma API, biblioteca ou método de acesso ao G29 existe ou funciona sem validar contra o hardware real.** Isso é um risco explícito registrado no PRD (seção 12).

Um exemplo concreto do motivo dessa regra existir, encontrado durante a pesquisa de stack desta skill (seção 4): há relatos recorrentes, em bibliotecas open-source de terceiros que já leem o G29 (ex.: `logitech-g29` para Node, `g29py` para Python), de que **o G29 inicializa em um "modo restrito"**, reportando eixos combinados/neutros até que o host envie um relatório de saída HID específico para "destravar" pedais separados, steering de 16 bits e o shifter. Isso é informação de terceiros, não verificada neste projeto contra o hardware real — trate como hipótese plausível a confirmar na skill `g29-input-layer`, não como fato assumido. É exatamente o tipo de premissa que RF-101/RF-103 e a seção 12 do PRD mandam validar antes de travar comportamento.

## 4. Decisões de Stack

**Status: decidido.** Stack escolhida: **Opção B — Node.js/Electron**.

Requisito que guiou a escolha: app desktop Windows-only, leitura de um controlador USB (G29) com baixa latência, processamento de dados em tempo real, persistência 100% local, e UI dark-mode estilo simulador (RNF-01 a RNF-05, RF-801).

### Decisão final registrada

| Peça | Escolha | Papel |
|---|---|---|
| Runtime/app shell | Electron | Empacota o processo de dados (main) e a UI (renderer) como app desktop Windows |
| Device/Input Layer (G29) | `logitech-g29` (npm, baseado em `node-hid`) | Já trata o "destrave" de modo restrito do G29 (ver seção 3), expõe volante/pedais/botões/shifter normalizados |
| UI | React + CSS (ex.: Tailwind ou CSS puro) | Tema dark motorsport, hierarquia visual (RF-801/RF-803) |
| Gráficos de telemetria/replay | `uPlot` — decidido em `telemetry-visualization-replay` (menor uso de CPU/memória em streaming de linha em tempo real) | Gráficos Brake/Throttle/Steering × Tempo, overlay, replay (RF-701 a RF-707) |
| Persistência | `better-sqlite3` (SQLite síncrono) | Sessões, tentativas, Skill Profile — tudo local (RNF-05, RF-601 a RF-605) |

**Justificativa:** reduz o maior risco técnico do projeto (leitura confiável do G29) usando uma biblioteca já específica para este hardware, e é o caminho mais rápido para acertar o visual "software profissional de simulador" exigido pelo RF-801, por ser 100% CSS. O ponto de atenção arquitetural herdado dessa escolha (documentado como contra na opção abaixo) é desenhar o loop de amostragem — Device Layer + Input Processing — para rodar no processo `main` do Electron com um hot path enxuto, empurrando cálculo pesado (Telemetry Engine em diante) para fora do caminho crítico de leitura, e validar a latência real (RNF-04, TC-901) cedo, antes de assumir que o orçamento de "dezenas de milissegundos" está garantido só por ter escolhido essa stack.

Esta decisão vale para novas skills de camada (`g29-input-layer`, `telemetry-visualization-replay`, `simulator-ui-design` etc.) — elas devem assumir Electron/Node/React/SQLite como stack já decidida, não reabrir essa escolha.

### Opções consideradas e não escolhidas (mantidas como referência)

### Opção A — C#/.NET 8 (WPF) + HidSharp + SQLite

- **Acesso ao G29:** `HidSharp` (biblioteca .NET para HID bruto, multiplataforma, leitura/escrita de relatórios). Não há biblioteca C# pronta específica para o G29 encontrada na pesquisa — seria necessário implementar a leitura de relatórios brutos (incluindo o possível "destrave" de modo restrito citado na seção 3) seguindo a mesma lógica que as libs de Node/Python já implementam.
- **UI:** WPF (ou WinUI 3), com `ControlTemplate`/estilos customizados para o visual dark motorsport; gráficos em tempo real via LiveCharts2 ou ScottPlot.
- **Persistência:** SQLite via `Microsoft.Data.Sqlite` ou LiteDB.
- **Prós:** uma linguagem só do início ao fim (hardware, lógica e UI); integração nativa forte com Windows; modelo de threads maduro para um loop de amostragem dedicado; precedente real na comunidade de sim racing (dashboards como o SimHub são C#); empacotamento simples para uso pessoal em uma máquina.
- **Contras:** conseguir o visual "software profissional de simulador" em WPF exige mais trabalho manual de estilização que uma UI baseada em web/CSS; nenhuma biblioteca pronta específica de G29 foi encontrada em C# — o trecho de leitura HID do wheel seria o mais "greenfield" das três opções, exigindo mais validação técnica própria antes de implementar (reforça a disciplina da seção 3).

### Opção C — Python (PySide6) + `g29py`/`hidapi` + SQLite + pyqtgraph

- **Acesso ao G29:** pacote `g29py` (PyPI), que já expõe volante/acelerador/freio normalizados (-1 a 1); alternativa de fallback é `hidapi` bruto se o pacote se mostrar incompleto.
- **UI:** PySide6 com QSS para o tema dark motorsport; `pyqtgraph`, biblioteca feita especificamente para plots de telemetria/científicos em tempo real — bom encaixe direto para os gráficos de brake/throttle/steering × tempo e para o replay.
- **Persistência:** SQLite (nativo do stdlib do Python, sem dependência extra).
- **Prós:** iteração solo mais rápida (ecossistema grande, sintaxe simples, menos boilerplate); já existe um pacote específico de G29 em Python, reduzindo o risco de hardware (embora aparentemente menos maduro/usado que o equivalente em Node); `pyqtgraph` é literalmente feito para o tipo de gráfico que este projeto precisa; SQLite sem dependência extra.
- **Contras:** o GIL e o overhead do interpretador tornam o loop de amostragem menos determinístico que opções compiladas — exige rodar a leitura em thread dedicada e manter o hot path mínimo; empacotar como `.exe` distribuível (PyInstaller) adiciona lentidão de startup e um binário maior; menos segurança de tipos/refatoração que C# para um projeto que vai crescer por 8 camadas ao longo do tempo; o pacote `g29py` é aparentemente menos maduro/testado que o `logitech-g29` de Node — precisaria de validação técnica extra antes de confiar nele (seção 3).

Nenhuma das três era tecnicamente inviável — a diferença estava em onde cada uma concentrava risco e esforço: Opção A concentrava o risco na leitura do HID (sem lib pronta); Opção C era a mais rápida de prototipar, mas com o loop de amostragem menos previsível sob carga. A Opção B (escolhida) reduz o risco de hardware ao máximo, assumindo em troca o custo arquitetural do Electron — ver a decisão final registrada acima.
