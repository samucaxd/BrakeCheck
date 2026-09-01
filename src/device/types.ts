/**
 * Device Layer — tipos e o "port" que isola o acesso ao hardware.
 *
 * Cobre RF-101 a RF-105 e RF-109. Esta camada entrega **valores brutos**, na
 * escala que o dispositivo reporta. Calibração, deadzone e normalização são da
 * Input Processing (RF-106 a RF-108) — não faça isso aqui.
 */

/**
 * Estado bruto dos canais, na escala nativa do `logitech-g29`.
 *
 * As faixas abaixo vieram de `docs/api.md` do pacote, confirmadas contra
 * `code/index.js`. Continuam sendo faixas **documentadas**, não medidas: o
 * curso real de um pedal específico pode não cobrir 0–1 inteiro, que é
 * exatamente o motivo do RF-106 (calibração) existir.
 */
export interface RawChannels {
  /** `pedals-brake`: 0 = solto, 1 = fundo. */
  brake: number
  /** `pedals-gas`: 0 = solto, 1 = fundo. */
  throttle: number
  /** `wheel-turn`: 0 = todo à direita, 50 = centro, 100 = toda à esquerda. */
  steering: number
}

/** Amostra bruta com timestamp, produzida pelo sampler de taxa fixa (RF-103). */
export interface RawSample extends RawChannels {
  /** Milissegundos desde epoch. */
  timestamp: number
}

export const NEUTRAL_RAW: Readonly<RawChannels> = Object.freeze({
  brake: 0,
  throttle: 0,
  steering: 50,
})

/**
 * Estado de conexão exposto para as camadas de cima (RF-109 exige que a
 * ausência de dispositivo seja um **estado**, nunca uma exceção subindo pelas
 * camadas).
 */
export type DeviceStatus =
  /** Ainda não se tentou conectar. */
  | 'idle'
  /** `connect()` em andamento. */
  | 'connecting'
  /** Conectado e reportando. */
  | 'connected'
  /** Nenhum G29 encontrado dentro do timeout de detecção (RF-109). */
  | 'no_device'
  /** Estava conectado e parou de reportar / erro de leitura (RF-104). */
  | 'disconnected'

/** Descreve um input do dispositivo, para o RF-102 (listar eixos e inputs). */
export interface InputDescriptor {
  /** Nome do evento na lib (`wheel-turn`, `pedals-brake`, ...). */
  event: string
  kind: 'axis' | 'button' | 'hat' | 'gear'
  /** Faixa bruta documentada pela lib. */
  range: string
  /**
   * Se a V1 consome este input. Inputs não consumidos são listados (RF-102 pede
   * a lista completa) mas nunca processados nem persistidos
   * (`g29-input-layer` §2).
   */
  consumedInV1: boolean
}

/**
 * Port do Device Layer.
 *
 * Existe para que o único código não-validável do projeto — o que fala com o
 * hardware — fique atrás de uma fronteira testável. Tudo acima desta interface
 * roda com o `MockDeviceSource` sem G29 nenhum por perto.
 */
export interface DeviceSource {
  /** Identificador da implementação, para log/diagnóstico. */
  readonly id: string

  /**
   * Tenta abrir o dispositivo. Deve rejeitar (não lançar de forma síncrona) se
   * o dispositivo não estiver disponível.
   */
  connect(): Promise<void>

  /** Fecha o dispositivo. Deve ser seguro chamar mesmo se nunca conectou. */
  disconnect(): Promise<void>

  /**
   * Último estado conhecido dos canais.
   *
   * É `readState()` e não um stream de eventos de propósito: os eventos
   * nomeados da lib só disparam **quando o valor muda**, então segurar o pedal
   * parado não gera evento nenhum. O sampler de taxa fixa lê este estado no
   * relógio dele, o que garante amostras igualmente espaçadas mesmo com o
   * pedal imóvel — condição para a Telemetry Engine calcular tempo em faixa
   * (RF-206) e taxas (RF-204/205) sem inventar interpolação.
   */
  readState(): RawChannels

  /**
   * Timestamp (epoch ms) da última **mudança** reportada pelo dispositivo, ou
   * `null` se nada chegou ainda.
   *
   * Note "mudança", não "relatório": o `logitech-g29` descarta relatórios HID
   * idênticos ao anterior (`code/index.js:478`), então um volante parado com os
   * pedais soltos não emite absolutamente nada. Silêncio aqui significa
   * "nada se moveu OU o cabo caiu" — os dois casos são indistinguíveis por
   * este sinal sozinho. Por isso ele só levanta *suspeita*; quem decide é
   * `isPresent()`.
   */
  lastReportAt(): number | null

  /**
   * Checagem ativa: o dispositivo ainda está enumerado pelo sistema?
   *
   * É o desempate do parágrafo acima e o mecanismo que `g29-input-layer` §3
   * prescreve como alternativa quando o heartbeat não é conclusivo. Só isto
   * distingue "piloto com as mãos fora do volante" de "cabo USB arrancado".
   */
  isPresent(): Promise<boolean>

  /** Inputs que o dispositivo expõe (RF-102). */
  describeInputs(): InputDescriptor[]
}
