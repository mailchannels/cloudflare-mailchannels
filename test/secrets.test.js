import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureGitignored, upsertDevVar, wranglerSecretPut } from '../src/secrets.js'

const tmp = () => mkdtemp(join(tmpdir(), 'cfmc-'))

describe('upsertDevVar', () => {
  it('creates .dev.vars readable only by the owner', async () => {
    const path = join(await tmp(), '.dev.vars')
    await upsertDevVar(path, 'MAILCHANNELS_API_KEY', 'abc123')
    expect(await readFile(path, 'utf8')).toBe('MAILCHANNELS_API_KEY=abc123\n')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('replaces an existing value and keeps other lines', async () => {
    const path = join(await tmp(), '.dev.vars')
    await writeFile(path, 'OTHER=1\nMAILCHANNELS_API_KEY=old\n# note')
    await upsertDevVar(path, 'MAILCHANNELS_API_KEY', 'new$key')
    expect(await readFile(path, 'utf8')).toBe('OTHER=1\nMAILCHANNELS_API_KEY="new$key"\n# note')
  })
})

describe('ensureGitignored', () => {
  it('adds .dev.vars once to an existing .gitignore', async () => {
    const dir = await tmp()
    await writeFile(join(dir, '.gitignore'), 'node_modules')
    expect(await ensureGitignored(dir)).toBe(true)
    expect(await ensureGitignored(dir)).toBe(false)
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.dev.vars\n')
  })

  it('does not create a .gitignore', async () => {
    expect(await ensureGitignored(await tmp())).toBe(false)
  })
})

describe('wranglerSecretPut', () => {
  function fakeSpawn(code = 0) {
    const calls = []
    const spawnFn = (command, args) => {
      const child = new EventEmitter()
      let input = ''
      child.stdin = { end: (data) => { input += data; setImmediate(() => child.emit('close', code)) } }
      calls.push({ command, args, input: () => input })
      return child
    }
    return { calls, spawnFn }
  }

  it('pipes the key on stdin to wrangler secret put', async () => {
    const { calls, spawnFn } = fakeSpawn()
    await wranglerSecretPut({ name: 'MAILCHANNELS_API_KEY', value: 'k', env: 'staging', spawnFn })
    expect(calls[0].args).toEqual(['--yes', 'wrangler', 'secret', 'put', 'MAILCHANNELS_API_KEY', '--env', 'staging'])
    expect(calls[0].args).not.toContain('k')
    expect(calls[0].input()).toBe('k\n')
  })

  it('uses wrangler pages secret put for a Pages project', async () => {
    const { calls, spawnFn } = fakeSpawn()
    await wranglerSecretPut({ name: 'MAILCHANNELS_API_KEY', value: 'k', pagesProject: 'site', spawnFn })
    expect(calls[0].args).toEqual(['--yes', 'wrangler', 'pages', 'secret', 'put', 'MAILCHANNELS_API_KEY', '--project-name', 'site'])
  })

  it('rejects when wrangler fails', async () => {
    const { spawnFn } = fakeSpawn(1)
    await expect(wranglerSecretPut({ name: 'N', value: 'v', spawnFn })).rejects.toThrow(/exited with code 1/)
  })
})
