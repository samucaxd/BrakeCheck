/**
 * TC-602 com um processo morto de verdade.
 *
 * A skill de persistência pede explicitamente "testar matando o processo (não
 * fechamento normal)". O outro teste de recuperação simula o **estado** que um
 * crash deixa; este produz o crash: um processo filho grava tentativas, é morto
 * com SIGKILL sem chance de fechar o banco, e o teste então verifica o arquivo.
 *
 * É o único teste do projeto que valida de fato a promessa do RNF-08 — o resto
 * confia na atomicidade do SQLite sem exercê-la.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BrakeCheckStore } from '../../src/persistence/store.js'

const here = join(fileURLToPath(import.meta.url), '..')
const CHILD = join(here, 'crash-child.ts')

/** Sobe o filho, espera ele gravar, e o mata com SIGKILL. */
function crashAfterWriting(dbPath: string, attempts: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', CHILD, dbPath, String(attempts)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('filho não ficou pronto a tempo'))
    }, 60_000)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const match = stdout.match(/READY (\d+)/)
      if (!match) return

      clearTimeout(timer)
      // SIGKILL: não dá ao processo nenhuma chance de fechar o banco.
      child.kill('SIGKILL')
      child.on('exit', () => resolve(Number(match[1])))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (!stdout.includes('READY')) {
        clearTimeout(timer)
        reject(new Error(`filho morreu antes de gravar (code=${code} signal=${signal}): ${stderr}`))
      }
    })
  })
}

describe('TC-602 — encerramento abrupto real (SIGKILL)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brakecheck-crash-'))
    dbPath = join(dir, 'crash.db')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('as tentativas já concluídas sobrevivem ao SIGKILL, e a sessão vira incompleta', async () => {
    const sessionId = await crashAfterWriting(dbPath, 3)

    // Reabre o arquivo deixado por um processo morto — inclusive o -wal.
    const store = new BrakeCheckStore({ path: dbPath })

    const session = store.getSession(sessionId)
    expect(session).not.toBeNull()
    expect(session!.status).toBe('incomplete')

    // Nenhuma tentativa concluída se perdeu, e cada uma manteve suas amostras.
    const attempts = store.listAttempts(sessionId)
    expect(attempts).toHaveLength(3)
    for (const attempt of attempts) {
      expect(store.getSamples(attempt.id)).toHaveLength(100)
      expect(attempt.derivedMetrics.durationMs).toBe(900)
    }

    // E o banco continua utilizável: dá para abrir uma sessão nova por cima.
    const fresh = store.createSession('G29', 9000)
    expect(fresh.status).toBe('active')

    store.close()
  }, 90_000)

  it('a recuperação não corrompe o arquivo — um segundo boot é estável', async () => {
    const sessionId = await crashAfterWriting(dbPath, 2)

    const first = new BrakeCheckStore({ path: dbPath })
    expect(first.listAttempts(sessionId)).toHaveLength(2)
    first.close()

    // Reabrir de novo não deve reprocessar nem alterar nada: a sessão já está
    // `incomplete`, e a varredura só toca `active`/`paused`.
    const second = new BrakeCheckStore({ path: dbPath })
    expect(second.getSession(sessionId)!.status).toBe('incomplete')
    expect(second.listAttempts(sessionId)).toHaveLength(2)
    expect(second.schemaVersion).toBe(1)
    second.close()
  }, 90_000)
})
