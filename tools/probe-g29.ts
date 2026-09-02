/**
 * Harness de validação de hardware do G29.
 *
 * Este script existe para cumprir a etapa que o `CLAUDE.md` e a
 * `g29-input-layer` §1 exigem antes de confiar em qualquer coisa do Device
 * Layer, e que **não pode ser feita pelo agente**: observar o hardware real.
 *
 * Rode no Windows, com o G29 ligado:
 *
 *     npm install
 *     npm run probe:g29
 *
 * Antes de rodar, confira os pré-requisitos de `g29-input-layer` §1:
 *   1. A chave de modo do volante (acima do centro) precisa estar em **PS3**.
 *   2. Se a conexão falhar, abrir o Logitech G HUB uma vez costuma resolver
 *      (ele instala os drivers).
 *
 * O que ele responde — cada item é uma premissa hoje NÃO confirmada:
 *   • `logitech-g29` v3.0.1 ainda conecta no Node atual? (o pacote está sem
 *     manutenção declarada, então isto é a pergunta bloqueante)
 *   • Qual a taxa real de relatórios do dispositivo? (RF-103 deixou o número em
 *     aberto; `SAMPLE_RATE_HZ = 100` é chute)
 *   • Os eixos cobrem mesmo a faixa documentada, ou o curso real é menor?
 *   • O dispositivo some da enumeração HID ao desconectar o cabo? (é a base da
 *     detecção de desconexão do RF-104)
 */

import { G29DeviceSource } from '../src/device/g29-source.js'
import { CalibrationRecorder } from '../src/input/calibration.js'
import { InputProcessor } from '../src/input/input-processor.js'
import { SAMPLE_INTERVAL_MS, SAMPLE_RATE_HZ } from '../src/config/provisional.js'

const OBSERVE_MS = 30_000

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits).padStart(6)
}

/**
 * Confere se os módulos nativos carregam, ANTES de falar em hardware.
 *
 * Sem esta checagem, uma falha de compilação do `node-hid` apareceria como
 * "nenhum G29 encontrado" — mandando o usuário procurar problema na chave de
 * modo e no G HUB quando o problema real é a instalação. São diagnósticos
 * completamente diferentes e não podem compartilhar a mesma mensagem.
 */
async function preflight(): Promise<boolean> {
  let ok = true

  try {
    await import('node-hid')
    console.log('   node-hid ............. OK')
  } catch (err) {
    ok = false
    console.log('   node-hid ............. FALHOU')
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    console.log('     É um módulo nativo. No Windows costuma faltar o Visual Studio')
    console.log('     Build Tools (workload "Desktop development with C++").')
  }

  try {
    await import('logitech-g29')
    console.log('   logitech-g29 ......... OK')
  } catch (err) {
    ok = false
    console.log('   logitech-g29 ......... FALHOU')
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
    console.log('     Está como optionalDependency, então `npm install` não falha')
    console.log('     se ele não instalar — só some em silêncio. Rode:')
    console.log('       npm install logitech-g29 --force')
  }

  return ok
}

async function main(): Promise<void> {
  const source = new G29DeviceSource()

  console.log('=== Brake Check — probe do G29 ===\n')

  console.log('0) Módulos nativos carregam?')
  if (!(await preflight())) {
    console.log('\n   Pare aqui: sem esses módulos nada do resto significa nada.')
    console.log('   O que vier depois seria diagnóstico de hardware para um problema')
    console.log('   que é de instalação.')
    process.exitCode = 1
    return
  }
  console.log()
  console.log('Inputs que a lib expõe (RF-102):')
  for (const input of source.describeInputs()) {
    const mark = input.consumedInV1 ? '[V1]' : '[  ]'
    console.log(`  ${mark} ${input.event.padEnd(22)} ${input.kind.padEnd(7)} ${input.range}`)
  }

  console.log('\n1) Dispositivo presente na enumeração HID?')
  const presentBefore = await source.isPresent()
  console.log(`   ${presentBefore ? 'SIM' : 'NÃO'}`)
  if (!presentBefore) {
    console.log('\n   Nenhum G29 encontrado. Cheque a chave de modo (PS3) e o G HUB.')
    console.log('   Se o volante ESTÁ plugado e mesmo assim deu NÃO, isso já é um')
    console.log('   achado importante: o filtro de vendor/product precisa de ajuste.')
    process.exitCode = 1
    return
  }

  console.log('\n2) connect() — pode levar ~8s se o volante estiver em cold start')
  const startedAt = Date.now()
  try {
    await source.connect()
  } catch (err) {
    console.log(`   FALHOU após ${Date.now() - startedAt}ms:`, err)
    console.log('\n   Este é o cenário de fallback previsto em `g29-input-layer` §1:')
    console.log('   se o pacote não funciona, o caminho é `node-hid` bruto com')
    console.log('   parsing manual do relatório HID. Registre o erro acima na ADR.')
    process.exitCode = 1
    return
  }
  console.log(`   OK em ${Date.now() - startedAt}ms`)

  console.log(`\n3) Observando ${OBSERVE_MS / 1000}s. MOVA TUDO ATÉ OS EXTREMOS:`)
  console.log('   - freio: solto → fundo   - acelerador: solto → fundo')
  console.log('   - volante: batente esquerdo → batente direito\n')

  const recorder = new CalibrationRecorder()
  const processor = new InputProcessor()

  let ticks = 0
  let reportChanges = 0
  let lastSeenReportAt = source.lastReportAt()
  const gaps: number[] = []

  const timer = setInterval(() => {
    ticks++
    const state = source.readState()
    recorder.observe(state)

    const reportAt = source.lastReportAt()
    if (reportAt !== null && reportAt !== lastSeenReportAt) {
      if (lastSeenReportAt !== null) gaps.push(reportAt - lastSeenReportAt)
      lastSeenReportAt = reportAt
      reportChanges++
    }

    if (ticks % 10 === 0) {
      const s = processor.process({ timestamp: Date.now(), ...state })
      process.stdout.write(
        `\r   bruto b=${fmt(state.brake, 3)} t=${fmt(state.throttle, 3)} w=${fmt(state.steering)}` +
          `  |  normalizado B=${fmt(s.brake)}% T=${fmt(s.throttle)}% S=${fmt(s.steering)}   `,
      )
    }
  }, SAMPLE_INTERVAL_MS)

  await new Promise((resolve) => setTimeout(resolve, OBSERVE_MS))
  clearInterval(timer)

  console.log('\n\n=== RESULTADO ===\n')

  console.log('Curso real observado por eixo (compare com a faixa documentada):')
  for (const axis of ['brake', 'throttle', 'steering'] as const) {
    const range = recorder.rangeFor(axis)
    const documented = axis === 'steering' ? '0–100' : '0–1'
    console.log(
      `  ${axis.padEnd(9)} observado ${range ? `${range.min} … ${range.max}` : '(nada)'}` +
        `   documentado ${documented}`,
    )
  }
  const incomplete = recorder.incompleteAxes()
  if (incomplete.length > 0) {
    console.log(`  ⚠ eixos sem curso utilizável: ${incomplete.join(', ')} — refaça movendo-os`)
  }

  console.log('\nTaxa de relatórios (a premissa que o RF-103 deixou em aberto):')
  if (gaps.length === 0) {
    console.log('  Nenhuma mudança observada — o volante ficou parado ou nada chegou.')
  } else {
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    console.log(`  mudanças observadas: ${reportChanges} em ${OBSERVE_MS / 1000}s`)
    console.log(`  intervalo entre mudanças: mediana ${median}ms, média ${mean.toFixed(1)}ms`)
    console.log(`  maior silêncio: ${sorted[sorted.length - 1]}ms`)
    console.log(
      `\n  → Se o maior silêncio se aproximar de HEARTBEAT_TIMEOUT_MS (500ms) com o\n` +
        `    volante em uso, o limiar está apertado demais e vai gerar falso positivo\n` +
        `    de desconexão. Ajuste em src/config/provisional.ts.`,
    )
    console.log(
      `  → Se a mediana for muito maior que ${SAMPLE_INTERVAL_MS}ms (alvo de ${SAMPLE_RATE_HZ} Hz),\n` +
        `    o dispositivo não sustenta a taxa assumida e SAMPLE_RATE_HZ precisa cair.`,
    )
  }

  console.log('\n4) TESTE DE DESCONEXÃO (RF-104) — ARRANQUE O CABO USB AGORA.')
  console.log('   Aguardando 10s para ver se o dispositivo some da enumeração HID...')
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  const presentAfter = await source.isPresent()
  console.log(`   Ainda enumerado: ${presentAfter ? 'SIM' : 'NÃO'}`)
  console.log(
    presentAfter
      ? '   ⚠ Se você desconectou e ainda aparece SIM, `isPresent()` NÃO serve como\n' +
          '     detector de desconexão e o RF-104 precisa de outro mecanismo.'
      : '   ✓ Hipótese de detecção de desconexão do RF-104 confirmada.',
  )

  await source.disconnect()
  console.log('\nAnote os resultados em docs/decisions/0001-*.md e ajuste')
  console.log('src/config/provisional.ts com os números medidos.')
}

main().catch((err) => {
  console.error('\nProbe falhou:', err)
  process.exitCode = 1
})
