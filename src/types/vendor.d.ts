/**
 * Declarações para os pacotes de hardware, que não trazem tipos próprios.
 *
 * As assinaturas foram transcritas de `docs/api.md` e conferidas contra
 * `code/index.js` da v3.0.1 — não são inferidas nem chutadas. Ainda assim,
 * descrevem o que o pacote **diz** fazer: nada aqui foi confirmado contra um
 * G29 real. Ver `docs/decisions/0001-device-layer-nao-validada-em-hardware.md`.
 *
 * Cobrem só o subconjunto que a V1 consome. Force feedback e LEDs existem na
 * lib, mas configurar o hardware é non-goal explícito do PRD §3.
 */

declare module 'logitech-g29' {
  export interface ConnectOptions {
    /** Default `true`. Array de dois elementos permite ajuste fino. */
    autocenter?: boolean | [number, number]
    /**
     * Default `false`. NUNCA ligar: com `debug: true`, o `findWheel()` do
     * pacote chama `process.exit()` quando não encontra o volante
     * (`code/index.js:182`), derrubando o processo inteiro.
     */
    debug?: boolean
    /** Graus de rotação, normalmente 270–900. Default `900`. */
    range?: number
  }

  /** Superfície do pacote que a V1 consome. */
  export interface LogitechG29 {
    connect(callback: (err?: unknown) => void): void
    connect(options: ConnectOptions, callback: (err?: unknown) => void): void
    disconnect(): void
    on(event: string, callback: (value: number) => void): unknown
    once(event: string, callback: (value: number) => void): unknown
    emitter: { removeAllListeners(): void }
  }

  export function connect(callback: (err?: unknown) => void): void
  export function connect(
    options: ConnectOptions,
    callback: (err?: unknown) => void,
  ): void

  export function disconnect(): void

  export function on(event: string, callback: (value: number) => void): unknown
  export function once(event: string, callback: (value: number) => void): unknown

  export const emitter: { removeAllListeners(): void }

  /**
   * O pacote é CommonJS (`module.exports.x = ...`). Sob ESM, o `module.exports`
   * inteiro chega em `default`; os named exports podem ou não ser detectados
   * pelo cjs-module-lexer, por isso o consumidor usa `default ?? namespace`.
   */
  const g29: LogitechG29
  export default g29
}

declare module 'node-hid' {
  export interface Device {
    vendorId?: number
    productId?: number
    product?: string
    path?: string
    interface?: number
    usagePage?: number
  }

  export function devices(): Device[]
}
