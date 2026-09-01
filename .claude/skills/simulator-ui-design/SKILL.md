---
name: simulator-ui-design
description: Define o sistema visual do Brake Check — paleta dark mode motorsport, tipografia, padrões de componente para indicadores de telemetria/pontuação, hierarquia visual de baixa poluição, e a estrutura de navegação entre as 5 telas (RF-801 a RF-805). Use esta skill sempre que for estilizar qualquer tela ou componente da UI, decidir cor/tipografia/espaçamento, ou implementar a navegação principal — ela é a fonte única de identidade visual, para consistência entre telas.
---

# Simulator UI Design

Cobre RF-801 a RF-805. Não recebe dados de nenhuma outra skill — define **como exibir** o que as outras camadas já calcularam (telemetria da `telemetry-visualization-replay`, scores da `evaluation-scoring-engine`, catálogo da `braking-training-engine`, histórico da `session-persistence`).

**Nota sobre a skill genérica `frontend-design` sugerida no roteiro de criação:** não está disponível nesta sessão — esta skill foi construída de forma autocontida. Se `frontend-design` estiver disponível em uma sessão futura, use-a como checklist adicional de boas práticas gerais, mas as decisões de identidade abaixo (cores, tipografia, componentes) permanecem as decisões do projeto.

## 1. Paleta — dark mode motorsport (RF-801)

Nunca usar branco puro (`#FFFFFF`) nem preto puro (`#000000`) — dureza de contraste desnecessária para uso prolongado. Todo texto da UI em português (RNF-10), exceto termos técnicos consagrados do glossário (PRD §14).

**Fundos (camadas, do mais fundo ao mais elevado):**

| Token | Valor | Uso |
|---|---|---|
| `--bg-base` | `#0B0E14` | Fundo da aplicação |
| `--bg-surface` | `#12161F` | Cards, painéis |
| `--bg-surface-raised` | `#1A2029` | Elementos elevados/ativos (ex.: exercício em execução) |
| `--border-subtle` | `#262D3A` | Divisórias, bordas de card |

**Texto:**

| Token | Valor | Uso |
|---|---|---|
| `--text-primary` | `#E6E9EF` | Texto principal |
| `--text-secondary` | `#8B93A7` | Texto de apoio, labels |
| `--text-disabled` | `#4A5468` | Estados desabilitados/bloqueados |

**Canais de telemetria (motorsport, mapeamento funcional — reaproveitar em toda a app, inclusive nos gráficos da `telemetry-visualization-replay`, para consistência entre tela e gráfico):**

| Token | Valor | Canal |
|---|---|---|
| `--accent-brake` | `#FF3B3B` | Freio (vermelho — convenção universal de frenagem) |
| `--accent-throttle` | `#3DDC84` | Acelerador (verde) |
| `--accent-steering` | `#3DA5FF` | Volante (azul/ciano) |

**Níveis de classificação (RF-403, `evaluation-scoring-engine`):**

| Token | Valor | Nível |
|---|---|---|
| `--level-bronze` | `#C9793E` | Bronze |
| `--level-silver` | `#C7CDD6` | Silver |
| `--level-gold` | `#F0B429` | Gold |
| `--level-master` | `#7B5CFF` | Master (violeta — deliberadamente distinto do dourado, para não competir visualmente com Gold) |

**Semânticos:** `--success: #3DDC84` (reaproveita throttle), `--warning: #F0B429` (reaproveita gold), `--danger: #FF3B3B` (reaproveita brake) — reaproveitar cores existentes em vez de inventar novas mantém a paleta pequena e coerente.

## 2. Tipografia

- **UI/headers/navegação:** `Titillium Web` (fallback: sans-serif do sistema) — família associada a gráficos de transmissão de automobilismo (F1), reforça a identidade motorsport sem depender de ícones.
- **Números de telemetria e pontuação:** fonte monoespaçada com algarismos tabulares — `JetBrains Mono` (fallback: `ui-monospace, "Roboto Mono", monospace`). **Obrigatório para qualquer número que atualiza em tempo real** (RF-802): algarismos de largura variável fazem o layout "tremer" a cada atualização, o que é ruído visual justamente no lugar que mais precisa ser estável (RF-803).
- **Corpo de texto** (instruções, feedback do coach): mesma família `Titillium Web`, peso regular.

## 3. Hierarquia visual e baixa poluição (RF-803) — dois modos de tela

A tensão entre "telemetria ao vivo visível" (RF-802) e "baixa poluição visual" (RF-803) se resolve com dois modos de UI, não com uma tela única tentando os dois:

**Modo Navegação** (fora de uma tentativa ativa): navegação completa (seção 5) visível, cards de resumo, texto explicativo do exercício.

**Modo Execução** (durante uma tentativa ativa, RF-802): navegação principal recolhida/oculta. Só permanece visível:
1. Os indicadores de brake/throttle/steering em tempo real (Tier 1 — nunca escondido durante execução).
2. Contagem regressiva / cronômetro da tentativa atual.
3. Indicador de pontuação da tentativa anterior (se houver), discreto, sem competir com o Tier 1.

Instruções detalhadas, explicação da técnica e feedback textual completo do coach **não aparecem durante a execução** — aparecem entre tentativas (transição de volta a elementos de Tier 2), quando o piloto não está com o pé no pedal. Isso é a aplicação direta de RF-803 ("baixa poluição, priorizando informação útil durante o treino"): útil durante o treino é o dado em tempo real, não o texto.

## 4. Componentes de indicador (RF-802, RF-805)

- **Barra de freio/acelerador:** barra vertical preenchida de baixo para cima, 0–100%, cor `--accent-brake`/`--accent-throttle`. Valor numérico (fonte monoespaçada, seção 2) ao lado ou sobreposto, sempre visível — não só a barra.
- **Indicador de volante:** barra horizontal centrada, preenchimento cresce para a esquerda/direita a partir do centro conforme `steering` (-100 a +100), cor `--accent-steering`.
- **Badge de pontuação/nível (RF-805):** pílula ou selo com a cor do nível (`--level-*`, seção 1) + score numérico dentro. Exibido imediatamente ao fim de cada tentativa (versão compacta, Tier 1) e ao fim de cada bloco de exercício (versão expandida, com a decomposição em sub-scores no formato de RN-01 — `evaluation-scoring-engine` §3).
- **Perfil de habilidades (Driving Skill Profile, RN-02):** lista/gráfico de barras horizontais, uma por dimensão, na ordem do PRD (Threshold Braking, Brake Control, Brake Release, Trail Braking, Steering Control, Throttle Control, Consistency) — dimensão sem dado (`null`, `evaluation-scoring-engine` §5) exibida como vazia/tracejada, nunca como zero, para não sugerir desempenho ruim onde só falta dado.

## 5. Navegação entre telas (RF-804)

Rail de navegação lateral persistente no Modo Navegação (padrão comum em dashboards de simulador), recolhido no Modo Execução (seção 3):

| Tela | Conteúdo (dados vêm de outra skill, esta só define a composição) |
|---|---|
| **Dashboard** | Resumo rápido: última sessão, próximo exercício recomendado (`coach-engine` §3), atalho para retomar sessão `paused`/`incomplete` |
| **Trilha de Treinamento** | Catálogo de exercícios (`braking-training-engine`), com estado visual claro de bloqueado/desbloqueado/dominado por exercício (`exercise_progress`, `session-persistence`) |
| **Histórico de Sessões** | Lista paginada de sessões (`session-persistence` §4), com acesso à comparação entre duas sessões (§5) |
| **Driving Skill Profile** | As 7 dimensões (seção 4 acima) + evolução ao longo do tempo (`skill_profile_history`) |
| **Replay** | Seleção de sessão/tentativa + player de replay (`telemetry-visualization-replay` §5/§6), incluindo comparação A×B |

Trocar de tela nunca deve acontecer no meio de uma tentativa ativa sem confirmação explícita (perda de contexto de sessão ativa é um caso de teste do PRD, TC-802) — bloquear ou avisar antes de navegar para fora do Modo Execução com uma tentativa em andamento.

## 6. Casos de borda obrigatórios (PRD §10.8)

- **TC-801** (legibilidade em visão periférica durante pilotagem): os indicadores de Tier 1 (seção 3/4) precisam de alto contraste contra `--bg-base`/`--bg-surface` e tamanho grande o suficiente para leitura periférica — validar isso com o layout real, não só na paleta isolada.
- **TC-802** (navegação sem perder dados não salvos): coberto pela regra de confirmação da seção 5.
- **TC-803** (indicador de pontuação atualiza em tempo real sem recarregar tela): o badge de pontuação (seção 4) precisa ser um componente reativo ao novo `ScoreResult`, nunca exigir navegação/reload para refletir o resultado da tentativa que acabou de terminar.

## 7. Assunções provisórias registradas (ajustáveis)

- **Paleta de cores exata** (seção 1) — é uma proposta de identidade visual coerente com "dark mode motorsport", não uma preferência estética que o usuário já validou. Ajustar livremente se não agradar visualmente — o que importa manter é a estrutura (fundo em camadas, cor funcional por canal, cor por nível), não os hex exatos.
- **Fontes escolhidas** (`Titillium Web`, `JetBrains Mono`) — mesma natureza: escolha razoável e justificada (motorsport + estabilidade de dígitos), não uma decisão travada por preferência pessoal do usuário.
- **Layout específico do rail de navegação e dos dois modos de tela** (seção 3/5) — a lógica (o que fica visível em cada modo) é a parte que importa manter; a implementação visual exata (posição, tamanho, animação de transição) é aberta.
