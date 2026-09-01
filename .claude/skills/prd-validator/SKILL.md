---
name: prd-validator
description: Valida se um PRD (Product Requirements Document) de um projeto de software está completo, cobrindo os tópicos essenciais de objetivos, escopo, requisitos funcionais e não-funcionais, modelo de dados, regras de negócio, cenários de teste, critérios de aceitação, riscos e rastreabilidade. Aponta lacunas estruturais, requisitos vagos/não-testáveis e cenários de teste insuficientes, e devolve um relatório objetivo com o que falta e o que está fraco. Use esta skill sempre que o usuário pedir para revisar, validar, auditar, conferir ou "ver se falta algo" em um PRD, spec de produto, documento de requisitos, ou sempre que um novo PRD for criado ou atualizado (mesmo sem pedido explícito de "validar"), antes de considerá-lo pronto para orientar o desenvolvimento.
---

# PRD Validator

Esta skill audita PRDs de projetos de software contra um checklist de completude estrutural e de qualidade de conteúdo. O objetivo não é reescrever o PRD, e sim dizer com precisão **o que falta** e **o que está fraco o suficiente para causar retrabalho depois** — a validação existe para ser aplicada antes de um PRD virar base de desenvolvimento (para uma skill técnica, para um agente de código, ou para outra pessoa implementar).

## Por que isso importa

Um PRD "completo na aparência" mas com requisitos vagos (ex.: "o sistema deve ser rápido" sem número, ou um cenário de teste que só cobre o caminho feliz) gera retrabalho tão caro quanto um PRD com seções inteiras faltando. Por isso esta skill não faz apenas um check de presença/ausência de seção — ela aplica uma barra de qualidade mínima por categoria.

## Processo

1. **Leia o PRD por completo** antes de avaliar qualquer categoria. Não avalie por amostragem.
2. **Percorra o checklist abaixo, categoria por categoria.** Para cada uma, marque:
   - ✅ **Presente e utilizável** — a categoria existe e atende à barra de qualidade descrita.
   - ⚠️ **Presente mas fraco** — a categoria existe, mas tem lacunas que vão gerar dúvida ou retrabalho (explique exatamente qual).
   - ❌ **Ausente** — a categoria não existe no documento.
3. **Não invente conteúdo do domínio para preencher lacunas.** Se um requisito está vago, aponte a vagueza e proponha a pergunta que precisa ser respondida — não decida a resposta no lugar do autor do PRD, a menos que ele peça explicitamente para você preencher a lacuna.
4. **Distinga lacuna de decisão deliberada.** Se o PRD registra explicitamente que algo foi deixado de fora por decisão consciente (ex.: uma seção "itens deferidos" com justificativa), isso não é uma lacuna — é rastreabilidade de escopo. Trate como ✅ e não sinalize como pendência.
5. **Entregue o relatório no formato da seção "Formato do relatório" abaixo.** Sempre termine com uma lista objetiva de próximas ações (o que precisa ser adicionado/corrigido), ordenada por impacto — não por ordem do documento.

## Checklist de completude

### 1. Objetivos do produto
Existem objetivos claros do que o software deve fazer, específicos o suficiente para diferenciar "feito" de "não feito"? Objetivos escritos como aspiração vaga ("melhorar a experiência do usuário") não passam na barra — devem ser objetivos verificáveis.

### 2. Escopo negativo (non-goals)
O PRD diz explicitamente o que **não** será feito nesta versão? PRDs sem non-goals tendem a sofrer scope creep, porque nada impede a inclusão de "só mais uma coisinha" durante o desenvolvimento.

### 3. Usuário e contexto de uso
Está claro quem usa o software, em que contexto/ambiente, e com que nível de conhecimento prévio? Isso afeta decisões de UI, terminologia e tratamento de erro.

### 4. Arquitetura de alto nível
Existe uma visão de como os componentes/camadas se relacionam, mesmo que em alto nível? Não precisa ser um design técnico detalhado, mas precisa dar direção suficiente para dividir o trabalho em partes coerentes.

### 5. Requisitos funcionais
Cada requisito é:
- **Atômico** (uma coisa por requisito, não uma frase com "e" escondendo três requisitos);
- **Testável** (dá para escrever um cenário de teste objetivo a partir dele);
- **Rastreável** (tem um identificador, não é só um parágrafo de prosa solto).

Requisitos do tipo "o sistema deve ser intuitivo" ou "deve funcionar bem" são bandeira vermelha — não são verificáveis. Sinalize como ⚠️ e peça o critério objetivo por trás da intenção.

### 6. Requisitos não-funcionais
Cobre pelo menos: plataforma/ambiente suportado, performance/latência (mesmo que como faixa-alvo a validar), armazenamento/dados (local vs. nuvem), segurança/privacidade quando aplicável, e limites explícitos de escala (quantos usuários, quanto volume de dados). Um PRD sem nenhum RNF é ❌, mesmo que os RFs estejam ótimos.

### 7. Modelo de dados (ao menos indicativo)
Existe uma ideia mínima de quais entidades de dados o sistema manipula e como se relacionam? Não precisa ser um schema completo, mas sem isso os requisitos funcionais tendem a ser ambíguos sobre "o que é armazenado".

### 8. Regras de negócio específicas
Regras que não são óbvias a partir dos requisitos funcionais isolados (ex.: fórmulas, condições de corte, exemplos de formato de saída) estão documentadas com exemplos concretos, não só descritas em abstrato?

### 9. Cenários de teste
Verifique três coisas, não só a existência da seção:
- Cobre **caminho feliz** para os fluxos principais;
- Cobre **casos de borda** (entradas extremas, ausência de dados, volumes grandes/pequenos);
- Cobre **tratamento de erro/falha** (o que acontece quando algo dá errado — dispositivo desconecta, rede cai, processo é interrompido).
Uma lista de cenários que só tem caminho feliz é ⚠️, não ✅.

### 10. Critérios de aceitação / Definition of Done
Existe uma lista objetiva e verificável do que precisa estar verdadeiro para considerar a versão pronta? Itens vagos ("funcionando bem") não contam.

### 11. Riscos e premissas técnicas
O PRD é honesto sobre o que ainda não foi validado tecnicamente, em vez de tratar suposições como fatos? Um PRD que finge certeza sobre algo não testado (ex.: "a API X vai suportar isso") é um risco escondido — sinalize.

### 12. Roadmap futuro / fora de escopo mapeado
Fica claro o que é intencionalmente adiado para versões futuras, para que a arquitetura da V1 não feche portas desnecessariamente?

### 13. Glossário (quando o domínio tem jargão)
Se o PRD usa terminologia técnica de domínio (não geral de software), há um glossário? Não é obrigatório para todo PRD, mas é obrigatório quando o domínio tem termos que um leitor novo não adivinharia.

### 14. Rastreabilidade requisito → responsável/execução
Está claro quem ou o quê (módulo, time, skill, sprint) é responsável por cada grupo de requisitos? Sem isso, um PRD completo ainda assim não sai do papel de forma organizada.

## Formato do relatório

Sempre estruture a saída assim:

```
## Validação de completude — [nome do PRD]

### Resumo
[1-3 frases: nível geral de completude e o maior risco encontrado]

### Checklist
| Categoria | Status | Observação |
|---|---|---|
| ... | ✅/⚠️/❌ | ... |

### Lacunas e pontos fracos (ordenado por impacto)
1. [categoria] — [o que falta ou está fraco] — [por que isso importa / o que pode dar errado sem isso]
2. ...

### Itens deferidos reconhecidos (não são lacunas)
[liste o que o próprio PRD já registrou como decisão consciente de escopo, para deixar claro que não entram na lista de pendências]
```

Se o PRD estiver realmente completo (todas as categorias ✅), diga isso diretamente e não invente lacunas artificiais só para preencher a seção — um relatório limpo é um resultado válido e útil.
