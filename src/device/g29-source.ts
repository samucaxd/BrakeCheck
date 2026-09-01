/**
 * Adapter real do Logitech G29, sobre o pacote `logitech-g29`.
 *
 * ⚠️ ESTE É O ÚNICO ARQUIVO DO PROJETO QUE NÃO FOI VALIDADO CONTRA HARDWARE.
 * Ele foi escrito lendo o código-fonte do pacote (`code/index.js` da v3.0.1),
 * não observando um G29 em funcionamento. `g29-input-layer` §1 e o PRD §12
 * proíbem tratar qualquer coisa aqui como fato até rodar `npm run probe:g29`
 * em um Windows com o volante ligado. Ver
 * `docs/decisions/0001-device-layer-nao-validada-em-hardware.md`.
 *
 * Tudo que depende deste arquivo conversa com ele através do port `DeviceSource`
 * — de propósito, para que a parte não-validada do sistema seja substituível e
 * o resto seja testável sem hardware.
 */

import type { LogitechG29 } from 'logitech-g29'

import {
  NEUTRAL_RAW,
  type DeviceSource,
  type InputDescriptor,
  type RawChannels,
} from './types.js'
import { CONNECT_TIMEOUT_MS, WHEEL_RANGE_DEGREES } from '../config/provisional.js'

/** vendorId da Logitech, usado pelo `findWheel()` do pacote (`code/index.js`). */
const LOGITECH_VENDOR_ID = 1133
const G29_PRODUCT_ID = 49743
const G29_PRODUCT_NAME = 'G29 Driving Force Racing Wheel'

/**
 * Inputs que o G29 expõe (RF-102).
 *
 * Fonte: `docs/api.md` do pacote v3.0.1. Os `consumedInV1: false` são listados
 * porque o RF-102 pede a lista completa de eixos e inputs, mas nunca são
 * processados nem persistidos (`g29-input-layer` §2 — o `TelemetrySample` do
 * PRD §8 só tem brake/throttle/steering, e câmbio/embreagem não fazem parte de
 * nenhuma técnica em escopo na V1).
 */
const G29_INPUTS: readonly InputDescriptor[] = Object.freeze([
  { event: 'wheel-turn', kind: 'axis', range: '0–100 (0 = direita, 50 = centro, 100 = esquerda)', consumedInV1: true },
  { event: 'pedals-brake', kind: 'axis', range: '0–1', consumedInV1: true },
  { event: 'pedals-gas', kind: 'axis', range: '0–1', consumedInV1: true },
  { event: 'pedals-clutch', kind: 'axis', range: '0–1', consumedInV1: false },
  { event: 'shifter-gear', kind: 'gear', range: '-1, 0–6', consumedInV1: false },
  { event: 'wheel-dpad', kind: 'hat', range: '0–8', consumedInV1: false },
  { event: 'wheel-shift_left', kind: 'button', range: '0, 1', consumedInV1: false },
  { event: 'wheel-shift_right', kind: 'button', range: '0, 1', consumedInV1: false },
  { event: 'wheel-button_x', kind: 'button', range: '0, 1', consumedInV1: false },
  { event: 'wheel-button_square', kind: 'button', range: '0, 1', consumedInV1: false },
  { event: 'wheel-button_triangle', kind: 'button', range: '0, 1', consumedInV1: false },
  { event: 'wheel-button_circle', kind: 'button', range: '0, 1', consumedInV1: false },
])

export class G29DeviceSource implements DeviceSource {
  readonly id = 'logitech-g29'

  #lib: LogitechG29 | null = null
  #state: RawChannels = { ...NEUTRAL_RAW }
  #lastReportAt: number | null = null
  #connected = false

  /**
   * Carrega `logitech-g29` sob demanda.
   *
   * É `optionalDependency` no `package.json` e importado dinamicamente porque
   * arrasta `node-hid`, que precisa de compilação nativa. Se a instalação falhar
   * (ou o app rodar numa máquina sem toolchain), o import falha aqui dentro e
   * vira `no_device` (RF-109) em vez de derrubar a aplicação no boot.
   */
  async #loadLib(): Promise<LogitechG29> {
    if (this.#lib) return this.#lib
    const mod = await import('logitech-g29')
    this.#lib = mod.default ?? (mod as unknown as LogitechG29)
    return this.#lib
  }

  async connect(): Promise<void> {
    // Reconectar sem desconectar antes empilharia uma segunda cópia dos
    // listeners, e cada evento do volante passaria a atualizar o estado duas
    // vezes. Conectar já conectado é no-op.
    if (this.#connected) return

    const g29 = await this.#loadLib()

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (err?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err instanceof Error ? err : new Error(String(err)))
        else resolve()
      }

      /**
       * O timeout cobre um caso específico: volante presente que nunca termina
       * a inicialização. O caso "nenhum G29 conectado" NÃO cai aqui — ele é
       * síncrono (ver o catch abaixo).
       */
      const timer = setTimeout(
        () => settle(new Error(`G29 não respondeu em ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      )

      try {
        /**
         * `debug` fica obrigatoriamente em `false`: com `debug: true` o
         * `findWheel()` do pacote chama `process.exit()` quando não acha o
         * volante (`code/index.js:182`), o que mataria o processo do Electron
         * inteiro em vez de reportar "dispositivo não encontrado" (RF-109).
         */
        g29.connect(
          { autocenter: true, range: WHEEL_RANGE_DEGREES, debug: false },
          (err?: unknown) => settle(err),
        )
      } catch (err) {
        /**
         * Sem G29 plugado, `findWheel()` devolve string vazia e o pacote faz
         * `new hid.HID('')`, que **lança de forma síncrona** — apesar da API
         * documentada prometer `callback(err)`. Sem este catch, RF-109 vira uma
         * exceção não tratada subindo pelas camadas, exatamente o que
         * `g29-input-layer` §3 proíbe.
         */
        settle(err)
      }
    })

    this.#subscribe(g29)
    this.#connected = true
  }

  #subscribe(g29: LogitechG29): void {
    const touch = () => {
      this.#lastReportAt = Date.now()
    }

    g29.on('pedals-brake', (value) => {
      this.#state = { ...this.#state, brake: value }
      touch()
    })
    g29.on('pedals-gas', (value) => {
      this.#state = { ...this.#state, throttle: value }
      touch()
    })
    g29.on('wheel-turn', (value) => {
      this.#state = { ...this.#state, steering: value }
      touch()
    })
    /**
     * `data` marca o heartbeat mesmo quando a mudança foi em um input que não
     * consumimos (botão, câmbio) — evita suspeitar de desconexão de alguém que
     * está só trocando marcha. Continua sendo change-gated, então silêncio aqui
     * ainda não prova desconexão; ver `lastReportAt()` em `types.ts`.
     */
    g29.on('data', touch)
  }

  async disconnect(): Promise<void> {
    if (!this.#connected || !this.#lib) return
    try {
      this.#lib.emitter.removeAllListeners()
      this.#lib.disconnect()
    } catch {
      // Já pode estar fechado (ex.: cabo removido). Fechar é best-effort — o que
      // importa é não deixar exceção vazar para as camadas de cima (RNF-08).
    }
    this.#connected = false
    this.#lastReportAt = null
  }

  readState(): RawChannels {
    return { ...this.#state }
  }

  lastReportAt(): number | null {
    return this.#lastReportAt
  }

  /**
   * Enumera os dispositivos HID e procura o G29 usando o mesmo critério do
   * `findWheel()` do pacote — inclusive a ressalva registrada lá de que
   * `productId` não é confiável em todo OS, só `vendorId`.
   *
   * Isso também cobre o TC-107 (mais de um dispositivo conectado): o filtro é
   * por vendor/product específicos do G29, os demais são ignorados.
   */
  async isPresent(): Promise<boolean> {
    try {
      const hid = await import('node-hid')
      return hid.devices().some(
        (d) =>
          d.vendorId === LOGITECH_VENDOR_ID &&
          (d.productId === G29_PRODUCT_ID || d.product === G29_PRODUCT_NAME) &&
          (d.interface === 0 || d.usagePage === 1),
      )
    } catch {
      // Sem `node-hid` instalável não há como checar — assume ausente, que é o
      // lado seguro: pausa a sessão em vez de gravar telemetria fantasma.
      return false
    }
  }

  describeInputs(): InputDescriptor[] {
    return [...G29_INPUTS]
  }
}
