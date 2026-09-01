/**
 * Device Layer — orquestração: detecção, amostragem em taxa fixa, detecção de
 * desconexão e reconexão automática.
 *
 * Cobre RF-101, RF-103, RF-104, RF-105 e RF-109. Não faz calibração, deadzone
 * nem normalização — isso é Input Processing (RF-106 a RF-108), a camada
 * seguinte. O que sai daqui é `RawSample`, na escala nativa do dispositivo.
 */

import {
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_INTERVAL_MS,
  SAMPLE_INTERVAL_MS,
} from '../config/provisional.js'
import type {
  DeviceSource,
  DeviceStatus,
  InputDescriptor,
  RawSample,
} from './types.js'

export type SampleListener = (sample: RawSample) => void
export type StatusListener = (status: DeviceStatus, previous: DeviceStatus) => void
/** `undefined` em `attempt` = o erro veio do heartbeat, não de uma tentativa de conexão. */
export type ErrorListener = (error: Error, context: 'connect' | 'heartbeat') => void

export interface DeviceManagerOptions {
  /** Intervalo do sampler, em ms. Default: `SAMPLE_INTERVAL_MS` (~100 Hz). */
  sampleIntervalMs?: number
  /** Silêncio do dispositivo que dispara a checagem ativa de presença. */
  heartbeatTimeoutMs?: number
  /** Intervalo entre tentativas de reconexão / hot-plug. */
  reconnectIntervalMs?: number
  /** Relógio injetável, para testes. */
  now?: () => number
}

export class DeviceManager {
  #source: DeviceSource
  #status: DeviceStatus = 'idle'
  #sampleTimer: ReturnType<typeof setInterval> | null = null
  #watchTimer: ReturnType<typeof setInterval> | null = null
  #sampleListeners = new Set<SampleListener>()
  #statusListeners = new Set<StatusListener>()
  #errorListeners = new Set<ErrorListener>()

  #sampleIntervalMs: number
  #heartbeatTimeoutMs: number
  #reconnectIntervalMs: number
  #now: () => number

  /** Evita empilhar checagens de presença, que são assíncronas e podem demorar. */
  #presenceCheckInFlight = false
  /** Evita reentrância no watch loop enquanto um `connect()` está pendente. */
  #connectInFlight = false
  /** `stop()` foi chamado — não reagendar nada. */
  #stopped = false

  constructor(source: DeviceSource, options: DeviceManagerOptions = {}) {
    this.#source = source
    this.#sampleIntervalMs = options.sampleIntervalMs ?? SAMPLE_INTERVAL_MS
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS
    this.#reconnectIntervalMs = options.reconnectIntervalMs ?? RECONNECT_INTERVAL_MS
    this.#now = options.now ?? Date.now
  }

  get status(): DeviceStatus {
    return this.#status
  }

  /** RF-102 — lista os eixos e inputs do dispositivo. */
  describeInputs(): InputDescriptor[] {
    return this.#source.describeInputs()
  }

  onSample(listener: SampleListener): () => void {
    this.#sampleListeners.add(listener)
    return () => this.#sampleListeners.delete(listener)
  }

  onStatusChange(listener: StatusListener): () => void {
    this.#statusListeners.add(listener)
    return () => this.#statusListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener)
    return () => this.#errorListeners.delete(listener)
  }

  /**
   * RF-101 — tenta detectar e conectar o G29.
   *
   * Resolve com o status resultante em vez de rejeitar: RF-109 exige que
   * "nenhum dispositivo" seja um **estado** que a UI mostra, não uma exceção
   * subindo pelas camadas.
   *
   * Mesmo quando falha, deixa o watch loop rodando — é o que atende TC-102
   * (G29 plugado depois que o software já está aberto deve ser detectado sem
   * reiniciar a aplicação).
   */
  async start(): Promise<DeviceStatus> {
    this.#stopped = false
    await this.#tryConnect()
    this.#startWatching()
    return this.#status
  }

  /** Encerra tudo: sampler, watch loop e o dispositivo. */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#stopSampling()
    if (this.#watchTimer !== null) {
      clearInterval(this.#watchTimer)
      this.#watchTimer = null
    }
    await this.#source.disconnect()
    this.#setStatus('idle')
  }

  // --- Interno ---------------------------------------------------------------

  async #tryConnect(): Promise<void> {
    if (this.#connectInFlight) return
    this.#connectInFlight = true
    this.#setStatus('connecting')
    try {
      await this.#source.connect()
      this.#setStatus('connected')
      this.#startSampling()
    } catch (err) {
      this.#emitError(err, 'connect')
      this.#setStatus('no_device')
    } finally {
      this.#connectInFlight = false
    }
  }

  #startSampling(): void {
    if (this.#sampleTimer !== null) return
    this.#sampleTimer = setInterval(() => this.#tick(), this.#sampleIntervalMs)
  }

  #stopSampling(): void {
    if (this.#sampleTimer === null) return
    clearInterval(this.#sampleTimer)
    this.#sampleTimer = null
  }

  /**
   * Um tick do sampler de taxa fixa (RF-103).
   *
   * Lê o **último estado conhecido** em vez de esperar um evento, porque os
   * eventos do `logitech-g29` são change-gated: com o pedal parado a 60% não
   * chega evento nenhum, e sem este tick a Telemetry Engine veria um buraco no
   * lugar de 60% sustentado. Amostras igualmente espaçadas são pré-requisito
   * para RF-204/205 (taxas) e RF-206 (tempo em faixa).
   */
  #tick(): void {
    if (this.#status !== 'connected') return

    const now = this.#now()
    this.#checkHeartbeat(now)

    // A checagem acima é assíncrona; o status pode ter mudado só no próximo
    // tick. Reconfirmar aqui evita emitir uma amostra já sabidamente inválida.
    if (this.#status !== 'connected') return

    const state = this.#source.readState()
    const sample: RawSample = { timestamp: now, ...state }
    for (const listener of this.#sampleListeners) listener(sample)
  }

  /**
   * RF-104 — desconfia do silêncio, mas não conclui nada por ele.
   *
   * Silêncio prolongado tem duas causas indistinguíveis por este sinal: o
   * piloto não mexeu em nada, ou o cabo caiu. Quem decide é a checagem ativa
   * de presença (`isPresent`). Sem isso, uma reta longa sem tocar em nada seria
   * lida como desconexão e pausaria a sessão do piloto no meio do treino.
   */
  #checkHeartbeat(now: number): void {
    const last = this.#source.lastReportAt()
    if (last === null) return
    if (now - last <= this.#heartbeatTimeoutMs) return
    if (this.#presenceCheckInFlight) return

    this.#presenceCheckInFlight = true
    void this.#source
      .isPresent()
      .then((present) => {
        if (!present && this.#status === 'connected') this.#handleDisconnect()
      })
      .catch((err) => this.#emitError(err, 'heartbeat'))
      .finally(() => {
        this.#presenceCheckInFlight = false
      })
  }

  /**
   * O sampler para **antes** da mudança de status ser anunciada.
   *
   * Ordem importa para RF-104/RNF-08 ("sem corromper dados já capturados"): se
   * o sampler continuasse rodando um tick a mais, gravaria o último estado
   * conhecido como se fosse leitura nova — telemetria fabricada, indistinguível
   * de dado real na hora de pontuar a tentativa. O correto é a série terminar
   * na última amostra de verdade.
   */
  #handleDisconnect(): void {
    this.#stopSampling()
    this.#setStatus('disconnected')
    void this.#source.disconnect().catch(() => {
      // Fechar um dispositivo que já sumiu costuma falhar; irrelevante aqui.
    })
  }

  /**
   * Loop único que cobre hot-plug (TC-102) e reconexão (RF-105) — os dois são o
   * mesmo problema: "o dispositivo não está em uso; apareceu?".
   */
  #startWatching(): void {
    if (this.#watchTimer !== null) return
    this.#watchTimer = setInterval(() => {
      if (this.#stopped) return
      if (this.#status === 'connected' || this.#status === 'connecting') return
      if (this.#connectInFlight || this.#presenceCheckInFlight) return

      this.#presenceCheckInFlight = true
      void this.#source
        .isPresent()
        .then(async (present) => {
          if (present && !this.#stopped) await this.#tryConnect()
        })
        .catch((err) => this.#emitError(err, 'connect'))
        .finally(() => {
          this.#presenceCheckInFlight = false
        })
    }, this.#reconnectIntervalMs)
  }

  #setStatus(next: DeviceStatus): void {
    if (this.#status === next) return
    const previous = this.#status
    this.#status = next
    for (const listener of this.#statusListeners) listener(next, previous)
  }

  #emitError(err: unknown, context: 'connect' | 'heartbeat'): void {
    const error = err instanceof Error ? err : new Error(String(err))
    for (const listener of this.#errorListeners) listener(error, context)
  }
}
