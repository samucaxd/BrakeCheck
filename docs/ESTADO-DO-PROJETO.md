# Estado do projeto — handoff entre sessões

Documento de continuidade. O código e as skills contam **o quê**; este arquivo
conta **o que não está no código**: decisões tomadas e o porquê, divergências
encontradas entre as skills e o PRD, o que está pendente de você, e o que uma
sessão nova precisa saber para não refazer análise já feita.

Última atualização: 2026-09-02, ao fim da camada 7 (Visualization & Replay).
Branch: `claude/project-development-vtnm9m`.

---

## 1. Onde o projeto está

**Oito das nove camadas implementadas. 231 testes passando, typecheck limpo.**

| Camada | Requisitos | Status |
|---|---|---|
| Device Layer | RF-101 a RF-105, RF-109 | Implementada — ⚠️ **não validada em hardware** |
| Input Processing | RF-106 a RF-108 | Implementada e testada |
| Telemetry Engine | RF-201 a RF-210 | Implementada e testada |
| Training Engine | RF-301 a RF-307 | Implementada e testada |
| Evaluation Engine | RF-401 a RF-405 | Implementada e testada |
| Coach Engine | RF-501 a RF-505 | Implementada e testada |
| Persistence | RF-601 a RF-605 | Implementada e testada |
| Visualization & Replay | RF-701 a RF-707 | Implementada e testada |
| **UI** | **RF-801 a RF-805** | **Não iniciada — é a próxima** |

Um commit por camada, na ordem de dependência. `git log --oneline` conta a
história.

**O projeto hoje é uma biblioteca TypeScript, não um app.** Electron, React e
uPlot ainda não entraram — eles chegam com a UI. `npm test` e
`npm run typecheck` rodam em qualquer plataforma; não há `npm start`.

---

## 2. O que está bloqueando o fechamento da V1

**`npm run probe:g29`, rodado no Windows com o G29 ligado.** É a única coisa que
separa o projeto de oito dos nove critérios de aceitação cumpridos, e **só o
usuário pode fazer** — as sessões de desenvolvimento rodaram em container Linux
sem hardware.

Contexto completo: [`docs/decisions/0001-device-layer-nao-validada-em-hardware.md`](decisions/0001-device-layer-nao-validada-em-hardware.md).
Essa ADR está **aberta** e é o item mais importante do projeto.

Enquanto ela não fechar:

- todo número em `src/config/provisional.ts` é chute, incluindo
  `SAMPLE_RATE_HZ = 100` e `HEARTBEAT_TIMEOUT_MS = 500`;
- `src/device/g29-source.ts` é o **único arquivo do projeto nunca executado
  contra o hardware** — foi escrito lendo o código-fonte do pacote
  `logitech-g29@3.0.1`, não observando um volante;
- TC-901 (latência ponta a ponta) e os cenários de hardware do TC-101 a TC-107
  seguem sem execução.

Quando o probe rodar, atualizar: os números de `provisional.ts`, a tabela "O que
continua sem resposta" da ADR, e o status dela.

---

## 3. Decisões que o código não explica sozinho

### 3.1 O padrão que atravessa o projeto: `null` nunca vira `0`

Aparece em todas as camadas de análise, e **não é preciosismo**: zero afirma "o
piloto fez isso mal", ausência de dado diz que ninguém mediu. Confundir os dois
faria o coach recomendar treino para uma fraqueza inexistente (RN-05 depende do
perfil refletir habilidade real) e faria gates de progressão passarem por omissão
de dado.

Onde isso é decisivo:

- sub-score de métrica ausente fica fora da média do agregado;
- dimensão do Skill Profile sem exercício tentado é `null`, e `weakestDimension`
  a ignora;
- delta de comparação entre sessões é `null` quando um lado não tem dado;
- `CoachFeedback` distingue "não freou" de "frenagem lenta";
- na exibição (RN-02), ausências vão para o fim com travessão, não ordenadas como
  zero.

Se uma mudança futura fizer algum desses virar zero, é regressão.

### 3.2 Achados da leitura do código-fonte do `logitech-g29`

O pacote foi baixado e lido, não só sua documentação. Quatro achados que
contrariam ou refinam o que a skill assumia — todos tratados no código, todos na
ADR 0001:

1. **`connect()` lança de forma síncrona sem volante plugado**, apesar da API
   documentada prometer `callback(err)`.
2. **`debug: true` chama `process.exit()`** quando não acha o volante. A opção
   está travada em `false`.
3. **Cold start espera 8 segundos fixos** no init — por isso
   `CONNECT_TIMEOUT_MS` é 12s e não os 3s propostos pela skill.
4. **Os eventos são change-gated, inclusive o `data`.** Segurar o pedal parado
   não gera evento nenhum. Daí duas coisas: o sampler de taxa fixa lendo o último
   estado conhecido, e a checagem ativa de enumeração HID para desconexão
   (silêncio não distingue "ninguém mexeu" de "cabo caiu").

### 3.3 Divergência corrigida: RN-03 no catálogo

O catálogo de `braking-training-engine` §3 só especifica exigência de
consistência em 5 dos 16 exercícios. **A RN-03 do PRD exige as duas coisas
sempre**: score sustentado **e** baixa variabilidade. Seguir a skill literalmente
deixou 11 exercícios permitindo avanço a quem acerta de um jeito diferente a cada
tentativa — o caso que a regra existe para barrar.

Como o PRD é a fonte da verdade (`brake-check-foundations`), os 16 receberam
exigência de consistência. Está registrado em `src/training/catalog.ts` e travado
por teste. **As métricas e limiares dos 11 acrescentados são escolha da
implementação, não da skill** — revisar com uso real.

### 3.4 A recomendação adaptativa precisou de exercício já dominado

Com desbloqueio estritamente sequencial (`braking-training-engine` §5), existe
**no máximo um** exercício desbloqueado e não dominado no catálogo inteiro a
qualquer momento. Escolher "pela dimensão mais fraca" devolveria sempre o próximo
da fila — exatamente o que a RN-05 proíbe.

Solução: exercícios já dominados entram como segunda opção. Revisitar um
exercício liberado que alimenta a dimensão fraca é seguro (RF-505 intacto, nada
bloqueado é recomendado) e é o que a `braking-training-engine` §3 já previa para
o fim da trilha.

### 3.5 Coach por templates, não por LLM

A `coach-engine` §6 admite as duas abordagens. **O RNF-11 proíbe transmitir
telemetria, sessão ou Skill Profile para servidores externos** e o RNF-05 exige
funcionamento local — isso descarta LLM na nuvem. Templates ainda têm a vantagem
de o texto ser verificável contra o número que o originou, que é o que o TC-501
cobra.

Decisão do usuário registrada: **LLM na nuvem fica para uma possível V2.** O
custo foi levantado e é irrelevante (menos de US$ 2,50/mês mesmo no modelo mais
caro); o bloqueio é de requisito, não de orçamento. Se um dia for feito, o
caminho é `CoachFeedback` já devolver as três partes da RN-04 separadas — um
gerador alternativo receberia essas partes e só melhoraria a redação, mantendo o
conteúdo técnico decidido pelo código.

### 3.6 Pragmas do SQLite com motivo

- `foreign_keys = ON` — o SQLite **não** aplica `REFERENCES` por padrão. Sem
  isso as chaves seriam decorativas.
- `journal_mode = WAL` — como a skill pede.
- `synchronous = FULL`, e não o `NORMAL` usual com WAL. Há **uma transação por
  tentativa**, a cada poucos segundos; trocar durabilidade por vazão que este app
  nunca vai usar seria mau negócio (RNF-08).
- `PRAGMA user_version` grava a versão do schema no arquivo. Não está na skill,
  mas o banco é o único artefato que sobrevive a um deploy.

### 3.7 Consequência conhecida: pausar não sobrevive a fechar o app

A varredura de boot de `session-persistence` §3 inclui `paused`, não só `active`.
Uma sessão pausada reabre como `incomplete` e não é retomável. Está em código,
comentário e teste. Se a intenção era a pausa persistir, é tirar `'paused'` da
varredura — mas aí perde-se a distinção entre "pausei de propósito" e "o app
morreu enquanto estava pausado".

---

## 4. Decisões abertas, esperando o usuário

Nenhuma bloqueia a UI, mas todas afetam o produto:

1. **Sentido do sinal do steering.** O `wheel-turn` reporta 0 = direita,
   100 = esquerda; a fórmula da skill preserva isso, resultando em
   **positivo = esquerda** — inverso da convenção usual de motorsport. Isolado em
   `STEERING_POSITIVE_DIRECTION`; inverter é uma linha. Confirmar antes que
   gráficos e feedback sejam escritos em cima.

2. **Exercício 3, "variação de steering dentro de ±10".** Admite duas leituras:
   amplitude ≤ 10 ou ≤ 20. Adotada a segunda. Constante
   `STRAIGHT_LINE_MAX_STEERING_RANGE` em `catalog.ts`.

3. **Seis exercícios sem curva ideal (RF-705).** Os de critério sobre forma ou
   relação — velocidade de aplicação (ex. 2), liberação (10, 13), estabilidade de
   volante (3), correlação (15), consistência (5). A skill admite isso, mas para
   os exercícios 2 e 10 daria para derivar uma **rampa ideal**. Seria extensão
   além da tabela da skill; não foi feito por conta própria.

4. **Limiares que a skill não listava** e precisaram ser escolhidos:
   `|steering| > 5%` como "esterçando" e `> 20%` como "esterçamento acentuado".
   Em `provisional.ts`.

---

## 5. Próxima etapa: a UI (RF-801 a RF-805)

Skill: `simulator-ui-design`. É a última camada e a que mais muda o projeto:

- **Electron** (main + renderer) — hoje não existe app, só biblioteca
- **React** para as 5 telas do RF-804: Dashboard, Trilha, Histórico, Skill
  Profile, Replay
- **uPlot** para os gráficos — a camada 7 já entrega os dados prontos, e
  deliberadamente **não** importa uPlot
- Ligar as camadas num ciclo que roda de verdade, com telemetria ao vivo durante
  o exercício (RF-802)

**Sugestão de recorte**, se for fatiar: Dashboard + Trilha + tela de treino com
telemetria ao vivo fecham o ciclo end-to-end e são o que se usa com o G29 na mão.
Histórico, Skill Profile e Replay são leitura de dados que já existem.

**Validação visual:** as sete camadas anteriores foram validadas por teste
automatizado, mas dark mode, hierarquia visual e legibilidade em visão periférica
(TC-801) se julgam olhando. Se a sessão rodar num ambiente com Chromium
(containers do Claude Code costumam ter), vale montar o renderer para abrir
também no navegador, não só dentro do Electron — permite screenshot e revisão
visual antes de abrir no Windows.

---

## 6. Como trabalhar neste projeto

Já está no `CLAUDE.md`, mas o que mais importa na prática:

1. **Ler a skill da camada antes de implementar.** Elas contêm decisões e
   pesquisa que não estão no PRD.
2. **O PRD é a fonte da verdade.** Quando uma skill divergir dele, sinalizar em
   vez de resolver em silêncio — foi assim que a violação da RN-03 apareceu.
3. **Nunca assumir que algo do G29 funciona sem validar.** Vale para qualquer
   mudança em `src/device/`.
4. **Testes contra o cenário do PRD**, com o ID no nome (`TC-xxx`). Todo teste
   deste projeto rastreia para um cenário da seção 10.
5. **Traços sintéticos** (`tests/helpers/traces.ts`) para tudo que precisa de
   input repetível — mão humana não reproduz uma frenagem byte a byte.
