/**
 * Replay respeitando o timing original (RF-706) e comparação A×B (RF-707).
 *
 * O ponto do RF-706 é reproduzir "como se estivesse acontecendo em tempo real":
 * respeitando os **deltas reais** entre amostras consecutivas, não um framerate
 * fixo. Se a captura teve jitter, o replay mostra o jitter — ele reflete o que
 * aconteceu, não uma versão suavizada.
 *
 * A montagem da linha do tempo é separada da reprodução de propósito: o
 * alinhamento é testável sem relógio nenhum, e o timing é testável com relógio
 * falso, sem que um teste dependa do outro.
 */

import type { StoredSample } from '../persistence/types.js'
import { alignmentOffset } from './alignment.js'
import type { DerivedMetrics } from '../telemetry/types.js'

/** Um instante da linha do tempo, no eixo alinhado. */
export interface ReplayCue<T> {
  tAligned: number
  payload: T
}

export interface AttemptFrame {
  /** Qual tentativa, na comparação A×B. `'a'` em replay simples. */
  side: 'a' | 'b'
  index: number
  sample: StoredSample
}

export interface ReplaySource {
  samples: readonly StoredSample[]
  metrics: DerivedMetrics
}

/**
 * Linha do tempo de uma tentativa, no eixo alinhado pelo início da frenagem.
 */
export function buildTimeline(
  source: ReplaySource,
  side: 'a' | 'b' = 'a',
): ReplayCue<AttemptFrame>[] {
  const first = source.samples[0]
  if (!first) return []

  const offset = alignmentOffset(source.metrics)
  return source.samples.map((sample, index) => ({
    tAligned: sample.timestamp - first.timestamp - offset,
    payload: { side, index, sample },
  }))
}

/**
 * RF-707 — linha do tempo única para duas tentativas.
 *
 * As duas rodam sob **um relógio compartilhado em `tAligned`**, e cada uma mapeia
 * esse relógio de volta para seu próprio tempo. É isso que faz o TC-704
 * funcionar: com durações bem diferentes, o instante da frenagem das duas cai no
 * mesmo ponto do eixo, e a comparação continua fazendo sentido.
 */
export function buildComparisonTimeline(
  a: ReplaySource,
  b: ReplaySource,
): ReplayCue<AttemptFrame>[] {
  return [...buildTimeline(a, 'a'), ...buildTimeline(b, 'b')].sort(
    (x, y) => x.tAligned - y.tAligned,
  )
}

export interface ReplayPlayerOptions<T> {
  cues: readonly ReplayCue<T>[]
  onFrame: (payload: T, tAligned: number) => void
  onEnd?: () => void
  /** Relógio injetável, para testes. */
  now?: () => number
  /**
   * Multiplicador de velocidade. 1 = tempo real. Não faz parte do RF-706, mas
   * um replay de frenagem dura poucos segundos e observar a liberação em câmera
   * lenta é justamente o tipo de entendimento que o produto existe para dar.
   */
  speed?: number
}

/**
 * Reprodutor da linha do tempo, respeitando os deltas reais.
 *
 * Usa `setTimeout` encadeado com o delta de cada par consecutivo, e não
 * `setInterval`: um intervalo fixo substituiria o timing real por um artificial,
 * que é exatamente o que o TC-703 verifica não acontecer.
 */
export class ReplayPlayer<T> {
  #cues: readonly ReplayCue<T>[]
  #onFrame: (payload: T, tAligned: number) => void
  #onEnd: (() => void) | undefined
  #now: () => number
  #speed: number

  #index = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  #startedAt: number | null = null
  /** Posição no eixo alinhado quando a reprodução corrente começou. */
  #anchor: number

  constructor(options: ReplayPlayerOptions<T>) {
    this.#cues = options.cues
    this.#onFrame = options.onFrame
    this.#onEnd = options.onEnd
    this.#now = options.now ?? Date.now
    this.#speed = options.speed && options.speed > 0 ? options.speed : 1
    this.#anchor = this.#cues[0]?.tAligned ?? 0
  }

  get playing(): boolean {
    return this.#timer !== null
  }

  get finished(): boolean {
    return this.#index >= this.#cues.length
  }

  /** Posição atual no eixo alinhado, em ms. */
  get position(): number {
    if (this.#startedAt === null) return this.#anchor
    return this.#anchor + (this.#now() - this.#startedAt) * this.#speed
  }

  play(): void {
    if (this.playing) return
    /**
     * Uma linha do tempo vazia é "nada a reproduzir", não "já reproduzido": ela
     * precisa passar pelo agendamento para sinalizar o fim, senão quem espera
     * `onEnd` para trocar de tela ficaria travado. Já um replay que terminou de
     * verdade é no-op — reiniciar é `stop()` seguido de `play()`.
     */
    if (this.#cues.length > 0 && this.finished) return
    this.#startedAt = this.#now()
    this.#scheduleNext()
  }

  pause(): void {
    if (this.#timer === null) return
    const position = this.position
    clearTimeout(this.#timer)
    this.#timer = null
    this.#anchor = position
    this.#startedAt = null
  }

  stop(): void {
    this.pause()
    this.#index = 0
    this.#anchor = this.#cues[0]?.tAligned ?? 0
  }

  /**
   * Reposiciona no eixo alinhado. O próximo quadro emitido é o primeiro cue em
   * `tAligned >= position` — reproduzir quadros já passados ao buscar adiante
   * mostraria a tentativa fora de ordem.
   */
  seek(tAligned: number): void {
    const wasPlaying = this.playing
    this.pause()
    this.#anchor = tAligned
    this.#index = this.#cues.findIndex((cue) => cue.tAligned >= tAligned)
    if (this.#index === -1) this.#index = this.#cues.length
    if (wasPlaying) this.play()
  }

  #scheduleNext(): void {
    const cue = this.#cues[this.#index]
    if (!cue) {
      this.#timer = null
      this.#startedAt = null
      this.#onEnd?.()
      return
    }

    const delayMs = Math.max(0, (cue.tAligned - this.position) / this.#speed)
    this.#timer = setTimeout(() => {
      this.#timer = null
      // Reancorar no tempo do cue mantém a posição fiel ao eixo mesmo com o
      // atraso natural do setTimeout, evitando deriva acumulada ao longo da
      // reprodução.
      this.#anchor = cue.tAligned
      this.#startedAt = this.#now()
      this.#index++
      this.#onFrame(cue.payload, cue.tAligned)
      this.#scheduleNext()
    }, delayMs)
  }
}
