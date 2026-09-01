# ADR 0001 — Device Layer implementada, porém NÃO validada em hardware

| Campo | Valor |
|---|---|
| Data | 2026-09-01 |
| Status | **Aberta** — bloqueia o fechamento do primeiro critério de aceitação da V1 |
| Requisitos afetados | RF-101 a RF-105, RF-109, RNF-04 |
| Risco correspondente no PRD | §12, "Acesso ao G29 no Windows ainda não validado" |

## Contexto

O `CLAUDE.md` e a skill `g29-input-layer` §1 são explícitos: *"Nunca assuma que uma
API, biblioteca ou método de acesso ao G29 existe ou funciona sem validar."*

A sessão que implementou esta camada rodou em um container **Linux, sem nenhum
G29 conectado**, enquanto o alvo do produto é **Windows com o volante físico**
(RNF-01, RNF-02). Ou seja: a etapa 4 da disciplina obrigatória do `CLAUDE.md`
("avalie limitações de acesso ao hardware") teve como resposta *não há acesso
nenhum*.

Havia duas saídas honestas: não implementar a camada, ou implementá-la de forma
que a parte não-validável fique isolada e explicitamente marcada como tal. Foi
escolhida a segunda.

## Decisão

**1. O acesso ao hardware fica atrás de um port.**

`DeviceSource` (`src/device/types.ts`) é a fronteira. Existem duas
implementações:

- `G29DeviceSource` — a real, sobre `logitech-g29`. **Nenhuma linha dela foi
  executada contra um G29.**
- `MockDeviceSource` — sintética, determinística, sem hardware.

Todo o resto do sistema — incluindo as sete camadas ainda por construir —
conversa só com o port. Se o pacote `logitech-g29` se mostrar inviável no
hardware real, o fallback previsto em `g29-input-layer` §1 (`node-hid` bruto com
parsing manual do relatório HID) é uma nova implementação do mesmo port, e nada
acima precisa mudar.

**2. As premissas numéricas ficam todas em um arquivo só.**

`src/config/provisional.ts`. Nenhum desses números foi medido. Quando o probe
rodar, o ajuste é em um lugar e fica visível no diff.

**3. O que só o hardware pode responder virou um script.**

`npm run probe:g29` (`tools/probe-g29.ts`), para rodar no Windows do usuário.

## O que a leitura do código-fonte do pacote já revelou

O pacote `logitech-g29@3.0.1` foi baixado e lido (não apenas sua documentação).
Quatro achados que contrariam ou refinam o que a skill assumia:

1. **`connect()` lança de forma síncrona quando não há volante.** Sem G29,
   `findWheel()` devolve string vazia e o pacote faz `new hid.HID('')`, que
   lança — apesar da API documentada prometer `callback(err)`. Sem tratamento,
   RF-109 viraria uma exceção não tratada. Tratado em `g29-source.ts`.

2. **`debug: true` mata o processo.** Com debug ligado e nenhum volante
   encontrado, o pacote chama `process.exit()` (`code/index.js:182`). A opção
   está travada em `false`, com o motivo no código.

3. **O cold start demora ~8 segundos.** Se o volante não está em "high precision
   mode", o pacote envia a sequência de init e espera 8s fixos antes de chamar o
   callback. O timeout de 3s proposto em `g29-input-layer` §6 reportaria "G29 não
   encontrado" em todo boot a frio, com o volante funcionando. Ajustado para 12s,
   sem custo para o RF-109 porque a ausência de dispositivo é detectada de forma
   síncrona (achado 1), não por timeout.

4. **Os eventos são change-gated — inclusive o `data`.** O pacote retorna cedo
   quando o relatório HID é idêntico ao anterior (`code/index.js:478`). Duas
   consequências:
   - Segurar o freio parado a 60% **não gera evento nenhum**. Por isso a camada
     tem um sampler de taxa fixa lendo o último estado conhecido, em vez de
     repassar eventos: sem ele, a Telemetry Engine veria um buraco no lugar de
     pressão sustentada, e RF-206 (tempo em faixa de pressão) seria
     incalculável.
   - O heartbeat proposto em `g29-input-layer` §3 (silêncio ⇒ desconexão) é
     **insuficiente sozinho**: silêncio significa "ninguém mexeu OU o cabo caiu",
     e confundir os dois pausaria a sessão do piloto numa reta. A camada usa
     silêncio apenas como suspeita, e decide com a checagem ativa de enumeração
     HID (`isPresent()`) — que é a alternativa que a própria skill prescreve.

Estes quatro achados vêm de leitura de código, o que os torna mais confiáveis
que suposição, mas **ainda não são observação de hardware**.

## O que continua sem resposta (só o probe responde)

| Pergunta | Premissa atual | Onde muda |
|---|---|---|
| O pacote ainda conecta no Node atual? (o npm confirma: *"Package no longer supported"*) | assumido que sim | — se não, é o fallback `node-hid` |
| Qual a taxa real de relatórios do G29? | `SAMPLE_RATE_HZ = 100` | `provisional.ts` |
| Qual o maior silêncio normal entre relatórios com o volante em uso? | `HEARTBEAT_TIMEOUT_MS = 500` | `provisional.ts` |
| O curso real dos pedais cobre a faixa documentada? | faixa teórica como fallback | calibração (RF-106) resolve em runtime |
| O G29 some da enumeração HID ao desconectar o cabo? | assumido que sim | se não, RF-104 precisa de outro mecanismo |
| A latência fim-a-fim cabe no RNF-04? | não medida | TC-901 |

## Decisão pendente do usuário

**Sentido do sinal do steering.** O `wheel-turn` do pacote reporta
`0 = todo à direita, 50 = centro, 100 = toda à esquerda`. A fórmula de
normalização definida em `g29-input-layer` §2 (`(valor - 50) * 2`) preserva esse
sentido, produzindo **positivo = esquerda** — o inverso da convenção mais comum
em telemetria de motorsport.

Foi implementado como a skill define, mas isolado na constante
`STEERING_POSITIVE_DIRECTION`: inverter é mudar uma linha. Vale confirmar antes
que gráficos e feedback de coach sejam escritos em cima dessa convenção.

## Consequências

- A camada 2 (`telemetry-engine`) pode ser construída em cima do port, com dados
  do `MockDeviceSource`, sem esperar o hardware.
- O primeiro critério de aceitação da V1 ("o G29 é detectado automaticamente...
  com a taxa de amostragem validada tecnicamente") **não pode ser marcado** até o
  probe rodar.
- Qualquer número de `provisional.ts` citado em outro documento como se fosse
  requisito travado está errado até esta ADR mudar de status.

## Como fechar esta ADR

1. Rodar `npm install && npm run probe:g29` no Windows, com o G29 ligado e a
   chave de modo em **PS3**.
2. Anotar os números medidos na tabela "O que continua sem resposta".
3. Ajustar `src/config/provisional.ts`.
4. Mudar o status desta ADR para "Fechada" e registrar o que mudou de premissa
   para fato.
