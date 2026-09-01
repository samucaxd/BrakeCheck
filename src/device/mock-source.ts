/**
 * Fonte sintética de inputs, implementando o mesmo port `DeviceSource`.
 *
 * Existe por dois motivos, e nenhum deles é "substituir o teste em hardware":
 *
 * 1. Permite desenvolver e testar as sete camadas acima do Device Layer sem um
 *    G29 por perto — inclusive em CI, e inclusive fora do Windows.
 * 2. Permite reproduzir padrões de input **exatos e repetíveis**, que é o que
 *    os cenários de teste do PRD §10.2 exigem (TC-201 fala em "padrão conhecido
 *    (gabarito)", TC-205/TC-206 em tentativas idênticas × muito diferentes).
 *    Um humano não consegue repetir uma frenagem byte a byte; isto consegue.
 *
 * O que ele NÃO faz: provar que o G29 real se comporta assim. Ele imita o
 * contrato do port, não o hardware.
 */

import {
  NEUTRAL_RAW,
  type DeviceSource,
  type InputDescriptor,
  type RawChannels,
} from './types.js'

export interface MockDeviceOptions {
  /** Se `connect()` deve falhar, para exercitar RF-109 / TC-104. */
  failToConnect?: boolean
  /** Estado inicial dos canais. Default: repouso. */
  initialState?: Partial<RawChannels>
  /** Relógio injetável, para os testes controlarem o tempo. */
  now?: () => number
}

export class MockDeviceSource implements DeviceSource {
  readonly id = 'mock'

  #state: RawChannels
  #lastReportAt: number | null = null
  #connected = false
  #present = true
  #failToConnect: boolean
  #now: () => number

  constructor(options: MockDeviceOptions = {}) {
    this.#failToConnect = options.failToConnect ?? false
    this.#now = options.now ?? Date.now
    this.#state = { ...NEUTRAL_RAW, ...options.initialState }
  }

  async connect(): Promise<void> {
    if (this.#failToConnect || !this.#present) {
      throw new Error('Nenhum G29 encontrado (mock)')
    }
    this.#connected = true
    this.#lastReportAt = this.#now()
  }

  async disconnect(): Promise<void> {
    this.#connected = false
    this.#lastReportAt = null
  }

  readState(): RawChannels {
    return { ...this.#state }
  }

  lastReportAt(): number | null {
    return this.#lastReportAt
  }

  async isPresent(): Promise<boolean> {
    return this.#present
  }

  describeInputs(): InputDescriptor[] {
    return [
      { event: 'wheel-turn', kind: 'axis', range: '0–100', consumedInV1: true },
      { event: 'pedals-brake', kind: 'axis', range: '0–1', consumedInV1: true },
      { event: 'pedals-gas', kind: 'axis', range: '0–1', consumedInV1: true },
    ]
  }

  // --- Controles de teste (não fazem parte do port) ---------------------------

  /**
   * Move um ou mais canais, como se o piloto tivesse mexido.
   *
   * Só atualiza `lastReportAt` se algum valor realmente mudou — espelhando o
   * comportamento change-gated do `logitech-g29` (`code/index.js:478`), para que
   * a detecção de desconexão seja testada contra o comportamento real da lib e
   * não contra um mock mais generoso que o hardware.
   */
  emit(changes: Partial<RawChannels>): void {
    const next = { ...this.#state, ...changes }
    const changed = (Object.keys(next) as (keyof RawChannels)[]).some(
      (k) => next[k] !== this.#state[k],
    )
    this.#state = next
    if (changed) this.#lastReportAt = this.#now()
  }

  /** Simula o cabo USB sendo arrancado (TC-103). */
  simulateUnplug(): void {
    this.#present = false
    this.#connected = false
  }

  /** Simula o cabo sendo religado (TC-102, RF-105). */
  simulateReplug(): void {
    this.#present = true
  }

  get connected(): boolean {
    return this.#connected
  }
}
