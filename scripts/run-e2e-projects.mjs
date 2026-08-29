#!/usr/bin/env node

/**
 * Run Playwright's browser projects concurrently without making them share
 * the Vite/CalDAV mock server. The normal `pnpm test:e2e` command remains the
 * convenient single-server developer run; release checks use this runner so
 * one browser's state and server load cannot slow or perturb another.
 */
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

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
const childProjects = new Map()
let interrupted = false
let failureDetected = false

function terminate(child, signal) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    // `ChildProcess.kill` only targets pnpm.cmd on Windows. taskkill's tree
    // switch also stops Playwright, Vite, and DAV descendants.
    const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    })
    if (result.error || result.status !== 0) child.kill(signal)
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

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}

function portListenerPids(port) {
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference = 'SilentlyContinue'; Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return (result.stdout ?? '').trim().split(/\s+/).filter(Boolean)
  }

  const result = spawnSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return (result.stdout ?? '').trim().split(/\s+/).filter(Boolean)
}

function isDescendant(pid, rootPid) {
  if (pid === String(rootPid)) return true

  if (process.platform === 'win32') {
    const script = `$root = ${rootPid}; $current = ${pid}; while ($current -and $current -ne 0) { $process = Get-CimInstance Win32_Process -Filter \"ProcessId = $current\"; if (-not $process) { break }; if ($process.ParentProcessId -eq $root) { exit 0 }; $current = $process.ParentProcessId }; exit 1`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
    })
    return result.status === 0
  }

  let current = Number(pid)
  const root = Number(rootPid)
  for (let depth = 0; depth < 32 && current > 1; depth += 1) {
    const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(current)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parent = Number((result.stdout ?? '').trim())
    if (!parent) return false
    if (parent === root) return true
    current = parent
  }
  return false
}

function rememberProjectListeners(project) {
  for (const port of [project.appPort, project.davPort]) {
    for (const pid of portListenerPids(port)) {
      if (pid !== String(process.pid) && isDescendant(pid, project.rootPid)) {
        project.listenerPids.add(pid)
      }
    }
  }
}

function startProjectPortTracking(project) {
  const remember = () => rememberProjectListeners(project)
  remember()
  // The process group handles the immediate interrupt case; this slower
  // tracker captures servers that detach before a test failure is reported.
  project.listenerTracker = setInterval(remember, 500)
  project.listenerTracker.unref()
}

function stopProjectPortTracking(project) {
  if (project?.listenerTracker) clearInterval(project.listenerTracker)
  if (project) {
    project.listenerTracker = null
    project.portsOwned = false
  }
}

function killPid(pid, signal) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', pid, '/t', '/f'], { stdio: 'ignore' })
    if (result.error || result.status !== 0) {
      try {
        process.kill(Number(pid), signal)
      } catch {
        // The listener may have exited between discovery and cleanup.
      }
    }
    return
  }

  try {
    process.kill(Number(pid), signal)
  } catch {
    // The listener may have exited between discovery and cleanup.
  }
}

function cleanupProjectPorts(project) {
  if (!project?.portsOwned) return

  if (project.listenerTracker) clearInterval(project.listenerTracker)
  rememberProjectListeners(project)
  for (const pid of project.listenerPids) killPid(pid, 'SIGTERM')
  stopProjectPortTracking(project)
}

function stopAllChildren(signal) {
  failureDetected = true
  for (const child of children) terminateProject(child, childProjects.get(child), signal)
}

function terminateProject(child, project, signal) {
  terminate(child, signal)
  cleanupProjectPorts(project)
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

async function runProject(project) {
  const appPort = project.appPort + appPortOffset
  const davPort = project.davPort + davPortOffset
  const outputDir = `${outputRoot}/${project.name}`
  const portsAvailable = await Promise.all([portIsFree(appPort), portIsFree(davPort)])
  if (!portsAvailable.every(Boolean)) {
    console.error(`[${project.name}] configured app/DAV ports are already in use`)
    stopAllChildren('SIGTERM')
    return { project: project.name, code: 1 }
  }
  if (interrupted || failureDetected) return { project: project.name, code: interrupted ? 130 : 1 }

  project.appPort = appPort
  project.davPort = davPort
  project.portsOwned = true
  project.listenerPids = new Set()
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
        PLAYWRIGHT_PARALLEL_RUNNER: '1',
        E2E_PORT: String(appPort),
        DAV_PORT: String(davPort),
        PLAYWRIGHT_OUTPUT_DIR: outputDir,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    }
  )

  children.add(child)
  childProjects.set(child, project)
  project.rootPid = child.pid
  startProjectPortTracking(project)
  child.stdout.on('data', (chunk) => prefix(project.name, 'stdout', process.stdout, chunk))
  child.stderr.on('data', (chunk) => prefix(project.name, 'stderr', process.stderr, chunk))

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true

      if (result.code !== 0 && !interrupted) {
        // A failed browser can leave Playwright's Vite/DAV children alive.
        // Stop the failed group and its siblings so the runner cannot hang or
        // leak ports while waiting for the other projects.
        stopAllChildren('SIGTERM')
      }

      flush(project.name)
      stopProjectPortTracking(project)
      children.delete(child)
      childProjects.delete(child)
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
    stopAllChildren(signal)
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
