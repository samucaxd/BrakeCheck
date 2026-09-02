# Contexto do projeto — Brake Check

Leia este arquivo por completo antes de implementar qualquer funcionalidade. Ele existe para você (agente) não perder contexto entre sessões de trabalho.

## O que é este projeto

Brake Check é um software pessoal de treinamento de pilotagem para simuladores de corrida, com foco em técnicas de frenagem para Fórmula 1. Ele lê os inputs do Logitech G29 (volante, freio, acelerador) e os transforma em telemetria, análise de técnica, exercícios progressivos, pontuação e feedback de coach virtual.

Uso pessoal e exclusivo do dono do repositório. Não é um produto para distribuição.

## Continuando o desenvolvimento? Comece por aqui

**Leia `docs/ESTADO-DO-PROJETO.md` antes de qualquer coisa.** Ele diz em que
ponto o projeto está, o que está bloqueado, quais decisões foram tomadas e por
quê, e quais divergências entre as skills e o PRD já foram encontradas. O código
conta o *o quê*; aquele arquivo conta o *porquê* e o *o que falta*.

Sem ele, uma sessão nova refaz análise já feita — ou pior, reverte uma decisão
sem saber que ela foi deliberada.

## Documento fonte da verdade

**Antes de implementar qualquer módulo, leia `docs/prd/brake-check-prd.md` por completo.** Esse PRD contém:

- Objetivos e não-objetivos da V1 (o que está fora de escopo é tão importante quanto o que está dentro)
- Requisitos funcionais numerados (RF-1xx a RF-8xx, um grupo por camada da arquitetura)
- Requisitos não-funcionais (RNF)
- Modelo de dados de alto nível
- Regras de negócio específicas com exemplos concretos de formato de saída
- Cenários de teste por módulo (TC-1xx a TC-9xx) — use-os como base para os testes que você escrever
- Critérios de aceitação da V1
- Riscos e premissas técnicas ainda não validadas — **não assuma que estão resolvidos**

## Princípio central (critério de decisão)

> Dados → Análise → Feedback → Exercício → Evolução

Toda funcionalidade nova deve responder "sim" a: *isso ajuda o piloto a entender o que está fazendo e melhorar sua técnica?* Se uma feature só exibe dados brutos sem gerar entendimento ou ação, ela não está pronta.

## Arquitetura (camadas, nesta ordem de dependência)

```
G29 → Device Layer → Input Processing → Telemetry Engine → Training Engine
   → Evaluation Engine → Coach Engine → Persistence → UI
```

Cada camada só consome a saída da camada anterior. Não pule camadas (ex.: a UI nunca lê o G29 diretamente).

## Disciplina de desenvolvimento (obrigatória)

Antes de implementar qualquer funcionalidade complexa — e **especialmente** qualquer coisa relacionada a acesso de hardware (G29):

1. Analise o requisito no PRD.
2. Defina a abordagem técnica.
3. Identifique dependências.
4. Avalie limitações de acesso ao hardware/dispositivo.
5. Proponha a implementação antes de escrever código.
6. Só então implemente.

**Nunca assuma que uma API, biblioteca ou método de acesso ao G29 existe ou funciona sem validar.** Isso está registrado como risco explícito no PRD (seção "Riscos e Premissas Técnicas").

## Skills disponíveis neste repositório

Skills ficam em `.claude/skills/<nome>/SKILL.md`. Consulte a skill correspondente ao módulo em que estiver trabalhando antes de implementar. Se a skill do módulo ainda não existir, **sinalize isso ao usuário em vez de assumir a abordagem sozinho** — o roadmap de skills é construído uma de cada vez, deliberadamente.

| Skill | Camada / Propósito | Status |
|---|---|---|
| `prd-validator` | Audita completude de PRDs (não é específica do Brake Check, é reutilizável) | ✅ Criada |
| `brake-check-foundations` | Visão geral, contratos entre camadas, decisões de stack | ✅ Criada |
| `g29-input-layer` | Detecção e leitura do G29 (Device Layer + Input Processing) | ✅ Criada |
| `telemetry-engine` | Captura temporal + métricas derivadas | ✅ Criada |
| `braking-training-engine` | Trilha de exercícios de frenagem + execução | ✅ Criada |
| `evaluation-scoring-engine` | Scoring, níveis, Driving Skill Profile | ✅ Criada |
| `coach-engine` | Feedback contextual + recomendação adaptativa | ✅ Criada |
| `session-persistence` | Ciclo de vida de sessão, histórico, comparação | ✅ Criada |
| `telemetry-visualization-replay` | Gráficos e replay | ✅ Criada |
| `simulator-ui-design` | Sistema visual dark mode / motorsport | ✅ Criada |

## O que NÃO fazer nesta fase

- Não implementar suporte a outros volantes/periféricos.
- Não integrar telemetria ou API de nenhum jogo.
- Não assumir stack técnica sem que isso esteja decidido em `brake-check-foundations`.
- Não avançar nível de treino do usuário apenas por "completar" um exercício uma vez (ver RN-03 no PRD — exige domínio + consistência).
- Não gerar feedback de coach genérico/desacoplado dos dados (ver RN-04 no PRD).
