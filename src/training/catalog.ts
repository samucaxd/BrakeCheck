/**
 * Catálogo de exercícios de frenagem (RF-301 a RF-305).
 *
 * Conteúdo vindo de `braking-training-engine` §3, com todos os 11 campos do
 * RF-305 preenchidos para os 16 exercícios. Cobertura mínima por nível conforme
 * RF-302 (Fundamentos), RF-303 (Intermediário) e RF-304 (Avançado).
 *
 * ⚠️ **Todo limiar numérico aqui é assunção provisória.** O PRD §16 registra
 * explicitamente que valores exatos ficam para a fase de design desta skill, sem
 * travar o documento; a skill §6 lista os propostos. Ajustar com uso real.
 *
 * Textos em português por RNF-10, preservando os termos técnicos consagrados em
 * inglês (threshold braking, trail braking, brake release).
 */

import type { Exercise, Level } from './types.js'

/**
 * NOTA DE INTERPRETAÇÃO — exercício 3.
 *
 * A skill escreve o critério como "variação de `steering` durante o evento de
 * frenagem dentro de ±10 (escala -100 a 100)". Isso admite duas leituras:
 * amplitude total ≤ 10, ou variação de até 10 para cada lado (amplitude ≤ 20).
 * Adotada a segunda, que é o sentido usual de "±" aplicado a uma variação.
 * Se a intenção era a primeira, é trocar `maxRange` para 10.
 */
const STRAIGHT_LINE_MAX_STEERING_RANGE = 20

const FUNDAMENTOS: Exercise[] = [
  {
    id: 'fund-01-controle-pedal',
    name: 'Controle do Pedal de Freio',
    level: 'fundamentos',
    technique: 'controle do pedal de freio',
    objective:
      'Reconhecer a faixa de curso do pedal e sustentar um valor de pressão constante por um tempo determinado.',
    explanation:
      'Antes de qualquer técnica de frenagem, o piloto precisa sentir a relação entre o curso do pedal e o resultado. É a base de tudo que vem depois.',
    instructions:
      'Aplique o freio até atingir a faixa de 30–40% do curso e mantenha o pedal dentro dela por 2,5 segundos.',
    difficulty: 1,
    metricsUsed: ['timeInPressureRange', 'brake.min', 'brake.max'],
    pressureBand: [30, 40],
    successCriteria: {
      kind: 'pressure_hold',
      band: [30, 40],
      windowMs: 2500,
      minCoverage: 0.8,
    },
    scoringRules: {
      subScores: [
        {
          id: 'controle_pressao',
          describes: 'Quanto da janela pedida o pedal ficou dentro da faixa-alvo.',
          spec: { formula: 'proportion', metric: 'pressureRangeMs', required: 2500 },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto oscila, entrando e saindo da faixa',
      'Se não atinge a faixa de forma alguma',
    ],
    advanceCondition: {
      attemptsRequired: 3,
      outOf: 5,
      consecutive: true,
      consistency: [{ key: 'timeInPressureRange', maxCoefficientOfVariation: 0.25 }],
    },
  },
  {
    id: 'fund-02-aplicacao-progressiva',
    name: 'Aplicação Progressiva',
    level: 'fundamentos',
    technique: 'aplicação progressiva',
    objective: 'Aplicar o freio de forma suave e crescente, sem degrau ou pico abrupto no início.',
    explanation:
      'Aplicação abrupta transfere peso bruscamente e reduz a aderência disponível logo no início da frenagem.',
    instructions:
      'Inicie a frenagem a partir de zero e chegue à pressão-alvo de forma gradual, sem "chutar" o pedal.',
    difficulty: 2,
    metricsUsed: ['brakingEvents.applicationSpeed', 'consistency.applicationSpeed'],
    successCriteria: { kind: 'application_speed_range', range: [150, 350] },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Se a taxa de subida do pedal ficou na faixa progressiva.',
          spec: { formula: 'target_range', metric: 'applicationSpeed', range: [150, 350] },
        },
      ],
    },
    feedbackFocus: [
      'Se a aplicação foi abrupta (acima da faixa)',
      'Se a aplicação foi hesitante (abaixo da faixa)',
    ],
    advanceCondition: {
      attemptsRequired: 3,
      outOf: 5,
      consecutive: false,
      minScore: 70,
      consistency: [{ key: 'applicationSpeed', maxCoefficientOfVariation: 0.3 }],
    },
  },
  {
    id: 'fund-03-frenagem-linha-reta',
    name: 'Frenagem em Linha Reta',
    level: 'fundamentos',
    technique: 'frenagem em linha reta',
    objective:
      'Executar uma frenagem completa, do início ao fim, mantendo o volante estável.',
    explanation:
      'Combina aplicação, sustentação e liberação em uma sequência única, ainda sem a complexidade da curva.',
    instructions:
      'Freie do início ao fim da reta, minimizando correções de volante durante a frenagem.',
    difficulty: 3,
    metricsUsed: [
      'brakingEvents.applicationSpeed',
      'steering.min',
      'steering.max',
      'exercise.steeringRangeDuringBraking',
    ],
    successCriteria: {
      kind: 'steering_stability',
      maxRange: STRAIGHT_LINE_MAX_STEERING_RANGE,
    },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Qualidade da aplicação inicial do freio.',
          spec: { formula: 'target_range', metric: 'applicationSpeed', range: [150, 350] },
        },
        {
          id: 'consistencia_direcional',
          describes: 'O quanto o volante permaneceu estável durante a frenagem.',
          spec: {
            formula: 'target_range',
            metric: 'steeringRangeDuringBraking',
            range: [0, STRAIGHT_LINE_MAX_STEERING_RANGE],
          },
        },
      ],
    },
    feedbackFocus: [
      'Se houve correção de volante perceptível durante a frenagem',
      'Em que ponto da frenagem a correção ocorreu',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'fund-04-controle-pressao',
    name: 'Controle da Pressão',
    level: 'fundamentos',
    technique: 'controle da pressão',
    objective:
      'Sustentar uma pressão de freio constante por uma janela mais longa, com faixa mais estreita.',
    explanation:
      'Consolida o controle fino do primeiro exercício antes de introduzir modulação, que é conteúdo do nível Intermediário.',
    instructions:
      'Mantenha o freio dentro da faixa estreita de 45–55% do curso por 3,5 segundos.',
    difficulty: 4,
    metricsUsed: ['timeInPressureRange', 'brake.min', 'brake.max', 'consistency.timeInPressureRange'],
    pressureBand: [45, 55],
    successCriteria: {
      kind: 'pressure_hold',
      band: [45, 55],
      windowMs: 3500,
      minCoverage: 0.85,
    },
    scoringRules: {
      subScores: [
        {
          id: 'controle_pressao',
          describes: 'Cobertura da janela dentro de uma faixa mais estreita que a do exercício 1.',
          spec: { formula: 'proportion', metric: 'pressureRangeMs', required: 3500 },
        },
      ],
    },
    feedbackFocus: [
      'Padrão de oscilação: se existe',
      'Se a oscilação cresce ou diminui ao longo da tentativa',
    ],
    advanceCondition: {
      attemptsRequired: 3,
      outOf: 5,
      consecutive: false,
      consistency: [{ key: 'timeInPressureRange', maxCoefficientOfVariation: 0.2 }],
    },
  },
  {
    id: 'fund-05-consistencia',
    name: 'Consistência',
    level: 'fundamentos',
    technique: 'consistência',
    objective: 'Repetir a mesma frenagem — mesma aplicação, mesmo pico, mesma liberação — várias vezes seguidas.',
    explanation:
      'É o primeiro exercício em que consistência é o próprio objetivo, e não um efeito colateral. Prepara o piloto para a regra de avanço por domínio sustentado.',
    instructions: 'Execute 5 frenagens buscando reproduzir exatamente o mesmo padrão em todas.',
    difficulty: 5,
    metricsUsed: ['consistency.applicationSpeed', 'consistency.brakeMax'],
    successCriteria: {
      kind: 'inter_attempt_consistency',
      metrics: ['applicationSpeed', 'brakeMax'],
      maxCoefficientOfVariation: 0.15,
    },
    scoringRules: {
      subScores: [
        {
          id: 'consistencia',
          describes: 'Variabilidade entre as tentativas do bloco nas métricas-chave.',
          spec: {
            formula: 'consistency',
            key: 'applicationSpeed',
            maxCoefficientOfVariation: 0.15,
          },
        },
      ],
    },
    feedbackFocus: [
      'Qual das tentativas mais destoou das demais',
      'Em qual métrica o desvio foi maior',
    ],
    /**
     * O critério deste exercício é do bloco inteiro, não de uma tentativa
     * isolada — então todas as tentativas do bloco recebem o mesmo veredito, e
     * exigir 5 de 5 é o mesmo que exigir "o bloco cumpriu". A skill registra que
     * aqui não é preciso repetir o bloco: o próprio exercício já é a medida de
     * repetição.
     */
    advanceCondition: { attemptsRequired: 5, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'fund-06-ponto-frenagem',
    name: 'Ponto de Frenagem',
    level: 'fundamentos',
    technique: 'ponto de frenagem',
    objective: 'Iniciar a frenagem em um momento consistente, não aleatório.',
    explanation:
      'Fecha os Fundamentos conectando "quando frear" a tudo que já foi treinado sobre "como frear".',
    instructions:
      'Inicie a frenagem assim que o marcador aparecer, minimizando o atraso de reação.',
    difficulty: 6,
    metricsUsed: ['exercise.reactionDelta'],
    usesBrakingMarker: true,
    successCriteria: { kind: 'reaction_delta', maxDeltaMs: 400 },
    scoringRules: {
      subScores: [
        {
          id: 'ponto_frenagem',
          describes: 'Atraso entre o marcador e o início efetivo da frenagem.',
          spec: {
            formula: 'target_value',
            metric: 'reactionDelta',
            target: 0,
            maxDeviation: 400,
          },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto está reagindo tarde (atraso alto)',
      'Se o piloto está reagindo de forma inconsistente (atraso variável)',
    ],
    advanceCondition: {
      attemptsRequired: 3,
      outOf: 5,
      consecutive: false,
      consistency: [{ key: 'reactionDelta', maxCoefficientOfVariation: 0.25 }],
    },
  },
]

const INTERMEDIARIO: Exercise[] = [
  {
    id: 'int-01-threshold-braking',
    name: 'Threshold Braking',
    level: 'intermediario',
    technique: 'threshold braking',
    objective: 'Frear no limite máximo de aderência sem travar as rodas.',
    explanation:
      'O ponto ótimo de frenagem fica logo abaixo do travamento. O exercício treina a sensibilidade para ficar perto desse limite sem ultrapassá-lo.',
    instructions:
      'Aplique o freio buscando o valor mais alto sustentável, mantendo o pedal na faixa de 85–95% do curso.',
    difficulty: 1,
    metricsUsed: ['brakingEvents.peakValue', 'timeInPressureRange'],
    pressureBand: [85, 95],
    successCriteria: { kind: 'peak_sustained', band: [85, 95], minEventCoverage: 0.6 },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Como o piloto chegou até a faixa de threshold.',
          spec: { formula: 'target_range', metric: 'peakValue', range: [85, 95] },
        },
        {
          id: 'controle_pressao',
          describes: 'Quanto do evento foi sustentado dentro da faixa.',
          spec: { formula: 'proportion', metric: 'eventBandCoverage', required: 1 },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto está frenando abaixo do limite (conservador)',
      'Se está ultrapassando a faixa (agressivo demais)',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'int-02-frenagem-maxima',
    name: 'Frenagem Máxima',
    level: 'intermediario',
    technique: 'frenagem máxima',
    objective: 'Atingir e sustentar a maior pressão de freio possível pelo maior tempo útil.',
    explanation:
      'Trabalha o extremo superior da faixa de threshold braking, com foco em não hesitar.',
    instructions: 'Freie o mais forte possível assim que o sinal aparecer, sustentando o pico.',
    difficulty: 2,
    metricsUsed: ['brakingEvents.peakValue', 'brakingEvents.applicationSpeed'],
    successCriteria: { kind: 'peak_and_application', minPeak: 90, minApplicationSpeed: 300 },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Se o pico alto foi atingido sem hesitação na subida.',
          spec: { formula: 'target_range', metric: 'applicationSpeed', range: [300, 900] },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto hesitou antes de atingir o pico — velocidade de aplicação baixa apesar de pico alto',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'int-03-modulacao-pedal',
    name: 'Modulação do Pedal',
    level: 'intermediario',
    technique: 'modulação do pedal',
    objective: 'Ajustar a pressão do freio de forma contínua e fina, não binária.',
    explanation:
      'Contrapõe a frenagem máxima do exercício anterior: aqui o ponto é variar a pressão sob comando, não apenas chegar ao pico.',
    instructions:
      'Siga a sequência de faixas-alvo dentro da mesma tentativa: 40%, depois 70%, depois 50%.',
    difficulty: 3,
    metricsUsed: ['exercise.subBandCoverage', 'timeInPressureRange'],
    successCriteria: {
      kind: 'band_sequence',
      segments: [
        { band: [35, 45], startMs: 0, endMs: 1500 },
        { band: [65, 75], startMs: 1500, endMs: 3000 },
        { band: [45, 55], startMs: 3000, endMs: 4500 },
      ],
      minCoveragePerSegment: 0.7,
    },
    scoringRules: {
      subScores: [
        {
          id: 'controle_pressao',
          describes: 'Cobertura de cada sub-faixa da sequência.',
          spec: { formula: 'proportion', metric: 'worstSubBandCoverage', required: 1 },
        },
      ],
    },
    feedbackFocus: ['Em qual transição da sequência o piloto perdeu mais tempo fora da faixa'],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'int-04-liberacao-progressiva',
    name: 'Liberação Progressiva do Freio',
    level: 'intermediario',
    technique: 'brake release',
    objective: 'Soltar o pedal de forma controlada, não abrupta.',
    explanation:
      'Prepara para o trail braking do nível Avançado: liberação abrupta desestabiliza o carro na entrada de curva.',
    instructions: 'Após atingir o pico, solte o freio de forma gradual até zero.',
    difficulty: 4,
    metricsUsed: ['brakingEvents.releaseSpeed', 'consistency.releaseSpeed'],
    successCriteria: { kind: 'release_speed_range', range: [100, 250] },
    scoringRules: {
      subScores: [
        {
          id: 'liberacao',
          describes: 'Se a taxa de descida do pedal ficou na faixa progressiva.',
          spec: { formula: 'target_range', metric: 'releaseSpeed', range: [100, 250] },
        },
      ],
    },
    feedbackFocus: [
      'Se a liberação foi abrupta (acima da faixa)',
      'Se o piloto ficou preso no pedal (abaixo da faixa)',
    ],
    advanceCondition: {
      attemptsRequired: 3,
      outOf: 5,
      consecutive: false,
      consistency: [{ key: 'releaseSpeed', maxCoefficientOfVariation: 0.3 }],
    },
  },
  {
    id: 'int-05-pressao-desaceleracao',
    name: 'Controle da Pressão Durante a Desaceleração',
    level: 'intermediario',
    technique: 'controle da pressão durante a desaceleração',
    objective:
      'Reduzir a pressão do freio ao longo da frenagem, em vez de manter valor fixo do início ao fim.',
    explanation:
      'Fecha o Intermediário simulando a necessidade real de reduzir pressão conforme a aderência disponível muda com a desaceleração.',
    instructions:
      'Inicie no pico de threshold braking e reduza a pressão acompanhando o perfil decrescente indicado.',
    difficulty: 5,
    metricsUsed: ['exercise.profileDeviation', 'brakingEvents.releaseSpeed'],
    successCriteria: {
      kind: 'profile_tracking',
      profile: [
        { atMs: 0, target: 90 },
        { atMs: 1000, target: 60 },
        { atMs: 2000, target: 30 },
      ],
      maxMeanDeviation: 10,
    },
    scoringRules: {
      subScores: [
        {
          id: 'controle_pressao',
          describes: 'Aderência ao perfil-alvo ao longo do evento.',
          spec: {
            formula: 'target_value',
            metric: 'profileDeviation',
            target: 0,
            maxDeviation: 10,
          },
        },
        {
          id: 'liberacao',
          describes: 'Suavidade da redução de pressão.',
          spec: { formula: 'target_range', metric: 'releaseSpeed', range: [100, 250] },
        },
      ],
    },
    feedbackFocus: ['Em que fase da frenagem — início, meio ou fim — o desvio do perfil foi maior'],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
]

const AVANCADO: Exercise[] = [
  {
    id: 'adv-01-trail-braking',
    name: 'Trail Braking',
    level: 'avancado',
    technique: 'trail braking',
    objective:
      'Manter parte da frenagem enquanto já se inicia o giro do volante na entrada da curva.',
    explanation:
      'Combina a liberação progressiva do nível Intermediário com o início do esterçamento sobreposto no tempo.',
    instructions:
      'Inicie a liberação do freio e, antes de soltar completamente, comece a girar o volante em direção à curva.',
    difficulty: 1,
    metricsUsed: ['exercise.brakeSteeringOverlap', 'brakingEvents.releaseSpeed'],
    successCriteria: { kind: 'trail_overlap', minOverlapMs: 200, releaseRange: [100, 250] },
    scoringRules: {
      subScores: [
        {
          id: 'liberacao',
          describes: 'Se a liberação seguiu progressiva mesmo com o volante entrando.',
          spec: { formula: 'target_range', metric: 'releaseSpeed', range: [100, 250] },
        },
        {
          id: 'consistencia_direcional',
          describes: 'Sobreposição entre freio residual e esterçamento.',
          spec: {
            formula: 'target_value',
            metric: 'brakeSteeringOverlap',
            target: 200,
            maxDeviation: 200,
          },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto solta o freio totalmente antes de esterçar (overlap zero)',
      'Se esterça antes de começar a soltar (ordem invertida)',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'adv-02-brake-release',
    name: 'Brake Release',
    level: 'avancado',
    technique: 'brake release',
    objective:
      'Refinar a liberação do freio especificamente no contexto de entrada em curva.',
    explanation:
      'Mesma habilidade de liberação progressiva do nível Intermediário, agora sob a exigência adicional de coordenação com o volante.',
    instructions:
      'Repita o padrão do trail braking, mas com atenção à suavidade da liberação, não ao overlap em si.',
    difficulty: 2,
    metricsUsed: ['brakingEvents.releaseSpeed', 'consistency.releaseSpeed'],
    successCriteria: { kind: 'release_speed_range', range: [100, 250] },
    scoringRules: {
      subScores: [
        {
          id: 'liberacao',
          describes: 'Suavidade da liberação com o volante em movimento.',
          spec: { formula: 'target_range', metric: 'releaseSpeed', range: [100, 250] },
        },
      ],
    },
    feedbackFocus: [
      'Se a presença de esterçamento simultâneo piora a suavidade da liberação em relação ao exercício de liberação em linha reta',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'adv-03-transferencia-peso',
    name: 'Transferência de Peso',
    level: 'avancado',
    technique: 'transferência de peso',
    objective:
      'Respeitar, no timing do pedal e do volante, o intervalo que a transferência de peso exige.',
    explanation:
      'Não mede a física do carro — isso exigiria telemetria de jogo, que está fora de escopo. Mede se o padrão de aplicação e liberação do piloto é compatível com o timing que a transferência de peso pede.',
    instructions:
      'Execute uma frenagem completa seguida de entrada em curva, respeitando um intervalo de estabilização entre o pico de frenagem e o início do esterçamento mais acentuado.',
    difficulty: 3,
    metricsUsed: ['brakingEvents.applicationSpeed', 'exercise.stabilizationInterval'],
    successCriteria: { kind: 'stabilization_interval', minIntervalMs: 150 },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Se a aplicação não foi súbita demais para o carro assentar.',
          spec: { formula: 'target_range', metric: 'applicationSpeed', range: [150, 350] },
        },
        {
          id: 'consistencia_direcional',
          describes: 'Timing entre o pico de freio e o esterçamento.',
          spec: {
            formula: 'target_value',
            metric: 'stabilizationInterval',
            target: 150,
            maxDeviation: 150,
          },
        },
      ],
    },
    feedbackFocus: ['Se o piloto está esterçando antes do carro assentar — intervalo curto demais'],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'adv-04-frenagem-rotacao',
    name: 'Relação entre Frenagem e Rotação do Carro',
    level: 'avancado',
    technique: 'relação entre frenagem e rotação',
    objective:
      'Ajustar a intensidade do freio residual proporcionalmente ao quanto o volante está girado.',
    explanation:
      'Trail braking avançado: quanto mais o carro está girando, menos freio residual é seguro manter.',
    instructions:
      'Durante a fase de trail braking, reduza a pressão do freio residual conforme o ângulo do volante aumenta.',
    difficulty: 4,
    metricsUsed: ['exercise.brakeSteeringCorrelation', 'exercise.brakeSteeringOverlap'],
    successCriteria: { kind: 'brake_steering_correlation', maxCorrelation: -0.6 },
    scoringRules: {
      subScores: [
        {
          id: 'liberacao',
          describes: 'Se o freio residual cai conforme o ângulo cresce.',
          spec: {
            formula: 'correlation',
            metric: 'brakeSteeringCorrelation',
            minAbsolute: 0.6,
          },
        },
        {
          id: 'consistencia_direcional',
          describes: 'Coordenação entre pedal e volante na fase de overlap.',
          spec: {
            formula: 'target_value',
            metric: 'brakeSteeringOverlap',
            target: 200,
            maxDeviation: 200,
          },
        },
      ],
    },
    feedbackFocus: [
      'Se o piloto mantém freio residual constante independente do ângulo, em vez de reduzir proporcionalmente',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
  {
    id: 'adv-05-combinacao-completa',
    name: 'Combinação entre Frenagem, Steering e Throttle',
    level: 'avancado',
    technique: 'combinação frenagem/steering/throttle',
    objective:
      'Executar frenagem, trail braking e retomada de aceleração como um único movimento fluido.',
    explanation:
      'Exercício de síntese do nível Avançado: junta liberação progressiva, trail braking e o início da aceleração de saída, onde o acelerador volta a aparecer de forma relevante.',
    instructions:
      'Execute uma frenagem completa com trail braking e, ao final do esterçamento, retome o acelerador de forma progressiva, sem pisar nos dois pedais ao mesmo tempo.',
    difficulty: 5,
    metricsUsed: [
      'overlap.brakeThrottle',
      'exercise.brakeSteeringOverlap',
      'exercise.brakeSteeringCorrelation',
    ],
    successCriteria: {
      kind: 'clean_handoff',
      maxBrakeThrottleOverlapMs: 100,
      minTrailOverlapMs: 200,
      maxCorrelation: -0.6,
    },
    scoringRules: {
      subScores: [
        {
          id: 'aplicacao_inicial',
          describes: 'Fase de frenagem da sequência.',
          spec: { formula: 'target_range', metric: 'applicationSpeed', range: [150, 350] },
        },
        {
          id: 'liberacao',
          describes: 'Fase de trail braking.',
          spec: {
            formula: 'correlation',
            metric: 'brakeSteeringCorrelation',
            minAbsolute: 0.6,
          },
        },
        {
          id: 'consistencia_direcional',
          describes: 'Coordenação na retomada do acelerador.',
          spec: {
            formula: 'target_value',
            metric: 'brakeThrottleOverlap',
            target: 0,
            maxDeviation: 100,
          },
        },
      ],
    },
    feedbackFocus: [
      'Qual das três fases — frenagem, trail braking ou retomada — está mais fraca nesta tentativa',
    ],
    advanceCondition: { attemptsRequired: 3, outOf: 5, consecutive: false, consistency: [] },
  },
]

/** Catálogo completo, na ordem de progressão. */
export const CATALOG: readonly Exercise[] = Object.freeze([
  ...FUNDAMENTOS,
  ...INTERMEDIARIO,
  ...AVANCADO,
])

export function exercisesForLevel(level: Level): Exercise[] {
  return CATALOG.filter((exercise) => exercise.level === level).sort(
    (a, b) => a.difficulty - b.difficulty,
  )
}

export function findExercise(id: string): Exercise | undefined {
  return CATALOG.find((exercise) => exercise.id === id)
}
