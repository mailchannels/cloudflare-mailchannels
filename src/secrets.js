// Stores the API key where Wrangler reads it: .dev.vars for local development,
// or a Worker / Pages secret through `wrangler secret put`.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Sets `name=value` in a .dev.vars file, replacing an existing assignment and
 * keeping every other line. Creates the file when it does not exist.
 */
export async function upsertDevVar(path, name, value) {
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const line = `${name}=${quoteDevVar(value)}`
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=.*$`, 'm')
  if (pattern.test(text)) {
    text = text.replace(pattern, () => line)
  }
  else {
    if (text && !text.endsWith('\n')) text += '\n'
    text += `${line}\n`
  }
  await writeFile(path, text, { mode: 0o600 })
}

/**
 * Adds `.dev.vars` to the project's .gitignore if a .gitignore exists and does
 * not already cover it. Returns true when the file was changed.
 */
export async function ensureGitignored(dir, entry = '.dev.vars') {
  const path = join(dir, '.gitignore')
  let text
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  const covered = text.split(/\r?\n/).some(l => [entry, `/${entry}`, '.dev.vars*', '/.dev.vars*'].includes(l.trim()))
  if (covered) return false
  await writeFile(path, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`)
  return true
}

/**
 * Runs `wrangler secret put NAME` (or `wrangler pages secret put NAME
 * --project-name P` for Pages), passing the value on stdin so it never appears
 * in the process list or shell history.
 */
export function wranglerSecretPut({ name, value, cwd, pagesProject, env, command = 'npx', commandArgs = ['--yes', 'wrangler'], spawnFn = spawn }) {
  const args = [...commandArgs]
  if (pagesProject) args.push('pages', 'secret', 'put', name, '--project-name', pagesProject)
  else args.push('secret', 'put', name)
  if (env) args.push('--env', env)
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, { cwd, stdio: ['pipe', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`wrangler exited with code ${code} while storing ${name}`))
    })
    child.stdin.end(`${value}\n`)
  })
}

function quoteDevVar(value) {
  return /^[\w.:/@+-]*$/.test(value) ? value : JSON.stringify(value)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
