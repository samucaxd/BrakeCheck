/**
 * Assunções provisórias — NÃO são certezas técnicas.
 *
 * Todas vêm de `g29-input-layer` §6, que as registra como "decisões que
 * precisavam ser tomadas para a skill ser executável, mas que não são certezas
 * técnicas nem preferências validadas com o usuário".
 *
 * Elas moram todas neste arquivo de propósito: quando o hardware real for
 * medido (`npm run probe:g29`), o ajuste é feito em um lugar só, e fica óbvio
 * no diff que uma premissa mudou de status. Não espalhe estes números pelo
 * código.
 *
 * Status de validação: NENHUM destes valores foi medido contra um G29 real.
 * Ver `docs/decisions/0001-device-layer-nao-validada-em-hardware.md`.
 */

/**
 * Taxa de amostragem alvo do sampler de taxa fixa.
 *
 * RF-103 deixa o valor exato para validação técnica. 100 Hz é o ponto de
 * partida proposto, dentro da folga do orçamento do RNF-04 ("dezenas de ms").
 */
export const SAMPLE_RATE_HZ = 100

export const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_RATE_HZ

/**
 * Quanto tempo esperar por `connect()` antes de desistir.
 *
 * `g29-input-layer` §6 propõe 3s. **Aumentado para 12s com motivo concreto:**
 * lendo `code/index.js` da v3.0.1, quando o volante não está em "high precision
 * mode" o pacote envia a sequência de init e espera **8 segundos fixos** o
 * volante calibrar antes de chamar o callback. Um timeout de 3s reportaria
 * "G29 não encontrado" em todo boot a frio, com o volante plugado e funcionando.
 *
 * Isso não atrasa o RF-109: "nenhum G29 conectado" é detectado de forma
 * síncrona (o pacote lança ao tentar abrir um path vazio), não por timeout.
 * Este limite cobre só o caso "volante presente que trava no init".
 */
export const CONNECT_TIMEOUT_MS = 12_000

/**
 * Silêncio do dispositivo que levanta suspeita de desconexão (RF-104).
 *
 * `g29-input-layer` §3 propõe 3–5× o intervalo de amostragem, mas isso pressupõe
 * que o dispositivo reporta continuamente. O G29 emite relatórios HID mesmo em
 * repouso, então o heartbeat observa o relatório bruto (`data`), não os eventos
 * de mudança — que ficam em silêncio legítimo quando nada se move.
 *
 * 500ms (50× o intervalo) é folgado de propósito: um falso positivo de
 * desconexão no meio de uma frenagem é pior que 500ms de atraso para detectar
 * uma desconexão real. Medir o intervalo real entre relatórios no probe antes
 * de apertar este número.
 */
export const HEARTBEAT_TIMEOUT_MS = 500

/** Intervalo entre tentativas de reconexão automática (RF-105). */
export const RECONNECT_INTERVAL_MS = 1_000

/**
 * Deadzone default por eixo, em % da faixa normalizada.
 *
 * `g29-input-layer` §6 propõe 2%. Deve ser configurável pelo usuário — o valor
 * aqui é só o ponto de partida, nunca um limite fixo.
 *
 * Cuidado ao aumentar: TC-106 exige eliminar ruído de repouso **sem cortar
 * movimentos pequenos intencionais**, e toque leve de freio em trail braking é
 * exatamente um movimento pequeno intencional.
 */
export const DEFAULT_DEADZONE_PERCENT = 2

/**
 * Graus de rotação do volante passados ao `connect()` da lib.
 * Sem preferência do usuário registrada — ajustar se o G29 físico estiver
 * configurado com outro range no G HUB.
 */
export const WHEEL_RANGE_DEGREES = 900

/**
 * Direção que a escala de steering trata como positiva.
 *
 * DESCOBERTA NA LEITURA DA LIB (não estava explícito na skill): o evento
 * `wheel-turn` do `logitech-g29` reporta 0 = todo à direita, 50 = centro,
 * 100 = toda à esquerda. A fórmula de normalização definida em
 * `g29-input-layer` §2 é `(valor - 50) * 2`, que preserva esse sentido — logo
 * o resultado é **positivo = esquerda**, que é o inverso da convenção mais
 * comum em telemetria de motorsport (positivo = direita).
 *
 * Mantido como a skill define, mas isolado aqui: inverter a convenção é mudar
 * esta constante, e nada mais. Decisão pendente de confirmação do usuário.
 */
export const STEERING_POSITIVE_DIRECTION: 'left' | 'right' = 'left'
