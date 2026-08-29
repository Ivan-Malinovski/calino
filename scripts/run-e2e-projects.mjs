#!/usr/bin/env node

/**
 * Run Playwright's browser projects concurrently without making them share
 * the Vite/CalDAV mock server. The normal `pnpm test:e2e` command remains the
 * convenient single-server developer run; release checks use this runner so
 * one browser's state and server load cannot slow or perturb another.
 */
import { spawn } from 'node:child_process'

const projects = [
  { name: 'chromium', appPort: 5200, davPort: 8100 },
  { name: 'firefox', appPort: 5201, davPort: 8101 },
  { name: 'webkit', appPort: 5202, davPort: 8102 },
]

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const extraArgs = process.argv.slice(2)
const appPortOffset = Number(process.env.E2E_PARALLEL_PORT_OFFSET ?? 0)
const davPortOffset = Number(process.env.DAV_PARALLEL_PORT_OFFSET ?? 0)
const outputRoot = process.env.PLAYWRIGHT_OUTPUT_ROOT ?? 'e2e/test-results'
const children = new Set()
const outputBuffers = new Map()
let interrupted = false

function terminate(child, signal) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    child.kill(signal)
    return
  }

  // Each child is detached below, so killing its process group also stops the
  // Vite and DAV servers spawned by Playwright when the caller is interrupted.
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

function prefix(project, channel, stream, chunk) {
  const key = `${project}:${channel}`
  const text = (outputBuffers.get(key) ?? '') + chunk.toString()
  const lines = text.split('\n')
  outputBuffers.set(key, lines.pop() ?? '')
  for (const line of lines) stream.write(`[${project}] ${line}\n`)
}

function flush(project) {
  for (const channel of ['stdout', 'stderr']) {
    const key = `${project}:${channel}`
    const line = outputBuffers.get(key)
    if (line) process[channel].write(`[${project}] ${line}\n`)
    outputBuffers.delete(key)
  }
}

function runProject(project) {
  const appPort = project.appPort + appPortOffset
  const davPort = project.davPort + davPortOffset
  const outputDir = `${outputRoot}/${project.name}`
  const child = spawn(
    pnpm,
    [
      'exec',
      'playwright',
      'test',
      `--project=${project.name}`,
      '--workers=1',
      ...extraArgs,
    ],
    {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        // Vite keeps HMR on this server's unique app port when the host is
        // explicit, avoiding a shared default HMR port across projects.
        CALINO_DEV_HOST: 'localhost',
        E2E_PORT: String(appPort),
        DAV_PORT: String(davPort),
        PLAYWRIGHT_OUTPUT_DIR: outputDir,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    }
  )

  children.add(child)
  child.stdout.on('data', (chunk) => prefix(project.name, 'stdout', process.stdout, chunk))
  child.stderr.on('data', (chunk) => prefix(project.name, 'stderr', process.stderr, chunk))

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      flush(project.name)
      children.delete(child)
      resolve(result)
    }

    child.once('error', (error) => {
      prefix(project.name, 'stderr', process.stderr, `failed to start: ${error.message}\n`)
      finish({ project: project.name, code: 1 })
    })
    child.once('close', (code, signal) => {
      finish({
        project: project.name,
        code: interrupted ? 130 : code ?? 1,
        signal,
      })
    })
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    for (const child of children) terminate(child, signal)
  })
}

console.log(`Running ${projects.length} Playwright projects concurrently (one worker each)`)
const results = await Promise.all(projects.map(runProject))
const failures = results.filter(({ code }) => code !== 0)

if (failures.length > 0) {
  console.error(`\n${failures.length} Playwright project(s) failed: ${failures.map(({ project }) => project).join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\nAll Playwright projects passed')
}
