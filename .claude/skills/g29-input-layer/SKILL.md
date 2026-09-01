---
name: g29-input-layer
description: Orienta a implementação do Device Layer + Input Processing do Brake Check — detecção do Logitech G29 no Windows, leitura bruta de volante/pedais, calibração de mín/máx por eixo, deadzone, e normalização para os canais lógicos brake/throttle/steering (RF-101 a RF-109). Use esta skill sempre que for implementar ou alterar qualquer código que toque o hardware G29 diretamente, antes de qualquer cálculo de telemetria — esta camada só entrega amostras normalizadas com timestamp, nada além disso.
---

# G29 Input Layer

Cobre **Device Layer** (leitura bruta do hardware) e **Input Processing** (calibração, deadzone, normalização) — RF-101 a RF-109 do PRD. Segue a stack decidida em `brake-check-foundations` (Node.js/Electron).

**Onde esta skill para:** na entrega de `TelemetrySample { timestamp, brake, throttle, steering }` normalizado. Cálculo de métricas derivadas (velocidade de aplicação, consistência etc.) é da skill `telemetry-engine` — não implemente isso aqui, mesmo que pareça natural continuar.

## 0. Premissa física do hardware — nunca esquecer isso

A pedaleira padrão do G29 usa **potenciômetro** (mede curso/posição do pedal), não célula de carga. **Isso não muda com nenhuma escolha de software.** Portanto:

- Tudo que este sistema chama de "pressão" no freio é, na prática, **posição/curso do pedal**, não força real aplicada pelo pé.
- Nunca implemente, documente ou exiba nada que sugira medição de força real (ex.: "N de força aplicada"). O correto é falar em curso/percurso do pedal (0–100%).
- Isso é uma limitação de hardware registrada no PRD (seção 12), não um bug a "corrigir" depois.

## 1. Biblioteca e o que a pesquisa técnica validou

**Escolha validada:** [`logitech-g29`](https://github.com/nightmode/logitech-g29) (npm), que já usa `node-hid` internamente e já abstrai a leitura de relatórios HID brutos do G29 — inclusive o "destrave" de modo restrito mencionado em `brake-check-foundations`.

Achados da pesquisa técnica (fonte: README e `docs/api.md` do próprio pacote) que **precisam ser tratados como fato a confirmar no hardware real antes de travar a implementação**, não como garantia:

- **⚠️ Pacote sem manutenção ativa.** O próprio README declara: *"This software is no longer being tested or updated."* Antes de construir qualquer coisa em cima dele, faça um teste isolado (`npm install` + `connect()` + logar um evento `pedals-brake` no hardware real) e confirme que funciona no Node/Electron/Windows atuais. Se não funcionar, o fallback é `node-hid` bruto com parsing manual do relatório HID do G29 (mais trabalho, mas sem dependência de um pacote não mantido).
- **Pré-requisito físico:** a chave de modo do G29 (localizada acima do centro do volante) precisa estar em **PS3** para o pacote reconhecer o dispositivo.
- **Pré-requisito de driver no Windows:** se a conexão falhar, rodar o Logitech G HUB uma vez costuma resolver (ele instala os drivers necessários). Isso deve ser documentado para o usuário final, não assumido como automático.
- **`node-hid` pode exigir compilação nativa** dependendo da versão do Node/Electron — validar isso cedo no setup do projeto (fora do escopo desta skill, mas é bloqueador de todo o resto se falhar).
- **Não há evento de desconexão documentado na API.** Isso é uma lacuna real, não uma omissão da pesquisa — ver seção 4.

## 2. Mapeamento: eventos brutos da lib → canais lógicos (RF-108)

A biblioteca já entrega eventos nomeados (não é HID bruto por byte), mas os valores **não** vêm na escala que o resto do sistema usa (`TelemetrySample` do PRD §8). É Input Processing que faz essa conversão:

| Evento da lib | Faixa bruta | Canal lógico | Fórmula de normalização | Faixa final |
|---|---|---|---|---|
| `wheel-turn` | 0–100 (50 = centro) | `steering` | `(valor - 50) * 2` | -100 a +100 (0 = centro) |
| `pedals-brake` | 0–1 | `brake` | `valor * 100` | 0–100% |
| `pedals-gas` | 0–1 | `throttle` | `valor * 100` | 0–100% |
| `pedals-clutch` | 0–1 | — | não consumido na V1 | fora de escopo (ver abaixo) |
| `shifter-gear`, `wheel-dpad`, `wheel-button_*` | diversos | — | não consumidos na V1 | fora de escopo (ver abaixo) |

**Por que clutch/shifter/botões ficam de fora:** o modelo de dados do PRD (§8) define `TelemetrySample` só com `timestamp, brake, throttle, steering` — o foco de conteúdo da V1 é frenagem (PRD §2), e câmbio/embreagem não fazem parte de nenhuma técnica em escopo. A lib expõe esses eventos e é válido registrar a assinatura deles no código (para não quebrar se chegarem), mas **não processe nem persista esses valores** na V1.

`connect()` deve ser chamado com `autocenter: true` (comportamento padrão esperado pelo piloto) e `range: 900` como ponto de partida — ver assunção provisória na seção 6 sobre esse valor.

## 3. Detecção de conexão, desconexão e reconexão (RF-101, RF-104, RF-105, RF-109)

- **RF-101 (detecção automática ao iniciar):** chamar `connect()` no boot do processo `main` do Electron; se o callback não resolver em um timeout curto (assunção provisória — ver seção 6), tratar como "G29 não encontrado" (RF-109), nunca travar a aplicação.
- **RF-104/RF-105 (desconexão/reconexão durante sessão ativa):** como a lib **não documenta um evento de desconexão explícito**, isso precisa de validação técnica direta antes de confiar em qualquer abordagem:
  1. Primeira hipótese a testar: erros na leitura HID subjacente (via `node-hid`) costumam surgir como exceção/erro no stream ao desconectar fisicamente — capturar isso e tratar como sinal de desconexão.
  2. Se a hipótese 1 não for confiável (silêncio total em vez de erro), a alternativa é um **heartbeat**: se nenhum evento chegar por N ms (ex.: 3–5× o intervalo de amostragem esperado), tratar como desconexão suspeita e verificar ativamente se o dispositivo ainda aparece na lista de HID devices do sistema.
  3. Qualquer que seja o mecanismo, ele precisa ser testado desconectando o cabo USB de verdade durante uma sessão simulada — **não implemente isso a partir de suposição de como a lib "deveria" se comportar.**
- **RF-109 (nenhum G29 encontrado):** essa camada deve expor um estado explícito (ex.: `disconnected` / `no_device`) para a UI mostrar mensagem clara — nunca deixar a ausência de dispositivo se manifestar como exceção não tratada subindo pelas camadas.

## 4. Calibração de mín/máx por eixo (RF-106)

Não assuma que o curso físico do pedal bate exatamente 0–1 reportado pela lib em todo hardware/uso — folga mecânica e desgaste variam. Fluxo de calibração:

1. Pedir ao usuário para mover cada eixo (freio, acelerador, volante) aos dois extremos físicos.
2. Durante esse processo, gravar o valor bruto mínimo e máximo observado por eixo (antes da normalização da seção 2).
3. Usar esses mín/máx capturados — não os teóricos (0/1 ou 0/100) — como base da normalização daquele eixo específico daquela instalação/usuário.
4. Persistir essa calibração localmente (mecanismo de armazenamento é responsabilidade da skill `session-persistence` — aqui só se define **o que** precisa ser persistido: `{ axis, raw_min, raw_max, captured_at }` por eixo).

## 5. Deadzone (RF-107)

Aplicar uma faixa de tolerância ao redor do repouso de cada eixo para eliminar ruído do sensor sem cortar movimentos pequenos intencionais (ex.: toque leve de freio em trail braking). Valor default é uma assunção provisória (seção 6) — deve ser configurável, nunca hardcoded sem exposição ao usuário.

## 6. Assunções provisórias registradas (ajustáveis, não travadas)

Estas são decisões que precisavam ser tomadas para a skill ser executável, mas que **não são certezas técnicas nem preferências validadas com o usuário** — revisitar quando houver hardware real em mãos:

- **Taxa de amostragem alvo:** ~100 Hz (intervalo de leitura de ~10ms) como ponto de partida, dentro da folga do orçamento de latência do RNF-04 ("dezenas de milissegundos fim-a-fim"). RF-103 explicitamente deixa o valor exato para validação técnica — meça a taxa real que a lib consegue sustentar no hardware do usuário antes de travar esse número.
- **`range: 900`** (graus de rotação do volante) como valor inicial do `connect()`. Sem preferência do usuário registrada — ajustar se o G29 físico estiver configurado com outro range no G HUB.
- **Timeout de detecção no boot:** proposto 3 segundos antes de reportar "G29 não encontrado" (RF-109). Ajustável.
- **Deadzone default:** proposto 2% da faixa normalizada (ex.: steering entre -2 e +2 tratado como centro). Ajustável por eixo.
- **Threshold de heartbeat para suspeita de desconexão:** proposto 3–5× o intervalo de amostragem (ver seção 3). Depende de validação real do comportamento de erro da lib.

## 7. Contrato de saída desta camada

Formato que sai da Input Processing e entra na `telemetry-engine` (consistente com `brake-check-foundations` §2):

```json
{
  "timestamp": 1732550400123,
  "brake": 42.5,
  "throttle": 0.0,
  "steering": -13.0
}
```

`timestamp` em milissegundos desde epoch (ou desde o início da tentativa — decisão a alinhar com `telemetry-engine`, que é quem consome isso). `brake`/`throttle` em 0–100. `steering` em -100 a +100, 0 = centro.
