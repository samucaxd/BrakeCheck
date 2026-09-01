# Brake Check

Software pessoal de treinamento de pilotagem para simuladores de corrida (foco inicial em Fórmula 1), que transforma os inputs do Logitech G29 (volante, freio, acelerador) em telemetria, análise técnica, exercícios progressivos e feedback de um coach virtual.

**Status:** planejamento — PRD definido, skills de suporte ao desenvolvimento em construção.

## Documentação

- **PRD completo:** [`docs/prd/brake-check-prd.md`](docs/prd/brake-check-prd.md) — objetivos, requisitos funcionais e não-funcionais, modelo de dados, regras de negócio, cenários de teste e critérios de aceitação da V1.
- **Skills do agente:** [`.claude/skills/`](.claude/skills/) — conhecimento especializado por módulo, usado pelo Claude Code durante o desenvolvimento.
- **Contexto para o agente:** [`CLAUDE.md`](CLAUDE.md) — leia antes de implementar qualquer coisa.

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
