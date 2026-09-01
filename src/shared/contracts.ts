/**
 * Contratos que atravessam fronteiras de camada.
 *
 * Fonte: PRD §8 (Modelo de Dados) + `brake-check-foundations` §2 (contrato de
 * dados entre camadas). Só entram aqui tipos que mais de uma camada precisa
 * enxergar — tipos internos de uma camada ficam dentro dela.
 *
 * Nesta fase existe apenas o contrato Input Processing → Telemetry Engine.
 * Os demais (Attempt, Exercise, ScoreResult, SkillProfile) serão adicionados
 * quando suas camadas forem implementadas — defini-los agora seria assumir
 * decisões que pertencem às skills daquelas camadas.
 */

/** Canais lógicos consumidos pela V1. Clutch/shifter/botões ficam de fora por decisão do PRD §2 + `g29-input-layer` §2. */
export type Channel = 'brake' | 'throttle' | 'steering'

export const CHANNELS: readonly Channel[] = ['brake', 'throttle', 'steering'] as const

/**
 * Saída da Input Processing e entrada da Telemetry Engine.
 * Contrato definido em `g29-input-layer` §7.
 *
 * ATENÇÃO (PRD §12, `g29-input-layer` §0): `brake` e `throttle` representam
 * **curso/posição do pedal**, não força aplicada. A pedaleira do G29 usa
 * potenciômetro, não célula de carga. Nada no sistema deve sugerir medição de
 * força real.
 */
export interface TelemetrySample {
  /** Milissegundos desde epoch. Tempo relativo à tentativa é derivado pela Telemetry Engine. */
  timestamp: number
  /** Curso do pedal de freio, 0–100%. */
  brake: number
  /** Curso do pedal de acelerador, 0–100%. */
  throttle: number
  /** Posição do volante, -100 a +100, 0 = centro. Ver `STEERING_POSITIVE_DIRECTION`. */
  steering: number
}
