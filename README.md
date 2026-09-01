# Brake Check

Software pessoal de treinamento de pilotagem para simuladores de corrida (foco inicial em Fórmula 1), que transforma os inputs do Logitech G29 (volante, freio, acelerador) em telemetria, análise técnica, exercícios progressivos e feedback de um coach virtual.

**Status:** em desenvolvimento — camada 1 (Device Layer + Input Processing) implementada, **pendente de validação em hardware**.

## Documentação

- **PRD completo:** [`docs/prd/brake-check-prd.md`](docs/prd/brake-check-prd.md) — objetivos, requisitos funcionais e não-funcionais, modelo de dados, regras de negócio, cenários de teste e critérios de aceitação da V1.
- **Decisões de arquitetura:** [`docs/decisions/`](docs/decisions/) — ADRs.
- **Skills do agente:** [`.claude/skills/`](.claude/skills/) — conhecimento especializado por módulo, usado pelo Claude Code durante o desenvolvimento.
- **Contexto para o agente:** [`CLAUDE.md`](CLAUDE.md) — leia antes de implementar qualquer coisa.

## Progresso por camada

| Camada | Requisitos | Status |
|---|---|---|
| Device Layer | RF-101 a RF-105, RF-109 | Implementada — ⚠️ não validada em hardware |
| Input Processing | RF-106 a RF-108 | Implementada e testada |
| Telemetry Engine | RF-2xx | Não iniciada |
| Training Engine | RF-3xx | Não iniciada |
| Evaluation Engine | RF-4xx | Não iniciada |
| Coach Engine | RF-5xx | Não iniciada |
| Persistence | RF-6xx | Não iniciada |
| Visualization & Replay | RF-7xx | Não iniciada |
| UI | RF-8xx | Não iniciada |

## Desenvolvimento

```bash
npm install
npm test          # suíte completa
npm run typecheck
```

Os testes rodam **sem G29 e fora do Windows**, contra o `MockDeviceSource`. Eles
verificam a lógica da camada, não o hardware.

### ⚠️ Validação de hardware pendente

O código que fala com o G29 foi escrito lendo o código-fonte do pacote
`logitech-g29`, **nunca executado contra o volante real**. Antes de confiar
nele, rode no Windows com o G29 ligado e a chave de modo em **PS3**:

```bash
npm run probe:g29
```

O probe mede a taxa real de amostragem, o curso real de cada eixo e o
comportamento na desconexão do cabo — os números que hoje são chute em
[`src/config/provisional.ts`](src/config/provisional.ts).

Contexto completo e o que exatamente continua em aberto:
[ADR 0001](docs/decisions/0001-device-layer-nao-validada-em-hardware.md).

## Princípio do projeto

> Dados → Análise → Feedback → Exercício → Evolução

Toda funcionalidade deve responder: *isso ajuda o piloto a entender o que está fazendo e melhorar sua técnica?*

## Escopo da V1

- Plataforma: Windows apenas
- Dispositivo: Logitech G29 apenas
- Independente de telemetria de jogo (não depende do F1 26 ou de qualquer outro simulador para funcionar)
- Foco de conteúdo: técnicas de frenagem
- Uso pessoal, single-user, 100% local

Detalhes completos no PRD.
