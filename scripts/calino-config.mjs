#!/usr/bin/env node

/**
 * Interactive generator for calino.config.json.
 *
 * Self-contained: needs Node.js 18+ and nothing else (no npm install).
 *
 *   node calino-config.mjs                      # writes ./calino.config.json
 *   node calino-config.mjs --out /opt/calino/calino.config.json
 *
 * Without Node on the host:
 *
 *   docker run --rm -it -v /opt/calino:/work -w /work node:22-alpine \
 *     node calino-config.mjs --out /work/calino.config.json
 *
 * It asks for every DAV account (one account serves both its calendars and
 * its address books), tests each login and lists the calendars it finds, lets
 * you pick which calendars to sync, asks for a master password and writes the
 * encrypted config. Values are encrypted exactly as in the /setup page and
 * scripts/encrypt-password.mjs: PBKDF2-SHA-256 (600,000 iterations) +
 * AES-256-GCM, random 16-byte salt and 12-byte IV per value, base64url.
 *
 * Re-run it on an existing file to edit: it unlocks the file with its master
 * password and lets you keep, change or remove what is there. The file is
 * rewritten in place, so a container that bind-mounts it sees the new version.
 */

import { webcrypto } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const PBKDF2_ITERATIONS = 600_000
const DEFAULT_OUT = 'calino.config.json'

// ─── Crypto (mirrors src/lib/crypto.ts) ──────────────────────────────────────

const toBase64Url = (buffer) => Buffer.from(buffer).toString('base64url')
const fromBase64Url = (text) => new Uint8Array(Buffer.from(text, 'base64url'))

async function deriveKey(masterPassword, salt, usage) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  )
}

export async function encryptValue(plaintext, masterPassword) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(masterPassword, salt, 'encrypt')
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  )
  return { ciphertext: toBase64Url(ciphertext), iv: toBase64Url(iv), salt: toBase64Url(salt) }
}

export async function decryptValue(encrypted, masterPassword) {
  const key = await deriveKey(masterPassword, fromBase64Url(encrypted.salt), 'decrypt')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(encrypted.iv) },
    key,
    fromBase64Url(encrypted.ciphertext)
  )
  return new TextDecoder().decode(plaintext)
}

// ─── Minimal XML (WebDAV multistatus) ────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body] ?? match
  })
}

/** Parse XML into { name, children, text } nodes with namespace prefixes dropped. */
export function parseXml(xml) {
  const root = { name: '#root', children: [], text: '' }
  const stack = [root]
  const tokens =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g
  let match
  while ((match = tokens.exec(xml))) {
    const top = stack[stack.length - 1]
    const [, cdata, closeName, openName, , selfClose, text] = match
    if (cdata !== undefined) {
      top.text += cdata
    } else if (closeName) {
      if (stack.length > 1) stack.pop()
    } else if (openName) {
      const node = { name: openName.split(':').pop().toLowerCase(), children: [], text: '' }
      top.children.push(node)
      if (!selfClose) stack.push(node)
    } else if (text) {
      top.text += decodeEntities(text)
    }
  }
  return root
}

const child = (node, name) => node?.children.find((c) => c.name === name)
const childrenNamed = (node, name) => node?.children.filter((c) => c.name === name) ?? []
function descendants(node, name, out = []) {
  for (const c of node.children) {
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

/** The responses of a multistatus, each with its href and successful props. */
function multistatusResponses(xml) {
  return descendants(parseXml(xml), 'response').map((response) => {
    const props = {}
    for (const propstat of childrenNamed(response, 'propstat')) {
      const status = child(propstat, 'status')?.text ?? ''
      if (status && !/\s2\d\d\s/.test(` ${status} `)) continue
      for (const prop of child(propstat, 'prop')?.children ?? []) props[prop.name] = prop
    }
    return { href: child(response, 'href')?.text.trim() ?? '', props }
  })
}

// ─── DAV discovery ───────────────────────────────────────────────────────────

class DavError extends Error {}

function davRequest(account) {
  const auth = 'Basic ' + Buffer.from(`${account.username}:${account.password}`).toString('base64')
  return async (url, depth, body) => {
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        ...account.headers,
        Authorization: auth,
        Depth: String(depth),
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>\n${body}`,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 401 || response.status === 403) {
      throw new DavError(`login rejected (HTTP ${response.status}) — check username/password`)
    }
    if (response.status !== 207) return null
    return { url: response.url || url, responses: multistatusResponses(await response.text()) }
  }
}

const PRINCIPAL_BODY =
  '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
const HOMES_BODY =
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="urn:ietf:params:xml:ns:carddav">' +
  '<d:prop><c:calendar-home-set/><a:addressbook-home-set/></d:prop></d:propfind>'
const COLLECTIONS_BODY =
  '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>'

const hrefIn = (prop) => (prop ? child(prop, 'href')?.text.trim() : undefined)

/**
 * Log in and list the account's calendars and address books. Follows the
 * usual RFC 6764 path: entered URL or /.well-known → principal → home sets →
 * collections.
 */
export async function discoverAccount(account) {
  const propfind = davRequest(account)
  const base = new URL(account.url)

  let principal
  for (const start of [
    base.href,
    new URL('/.well-known/caldav', base).href,
    new URL('/.well-known/carddav', base).href,
  ]) {
    let result
    try {
      result = await propfind(start, 0, PRINCIPAL_BODY)
    } catch (err) {
      if (err instanceof DavError) throw err
      continue
    }
    const href = result?.responses
      .map((r) => hrefIn(r.props['current-user-principal']))
      .find(Boolean)
    if (href) {
      principal = new URL(href, result.url).href
      break
    }
  }
  if (!principal) throw new DavError('no DAV principal found at that URL')

  const homes = await propfind(principal, 0, HOMES_BODY)
  const homeOf = (prop) => {
    const href = homes?.responses.map((r) => hrefIn(r.props[prop])).find(Boolean)
    return href ? new URL(href, homes.url).href : undefined
  }
  const calendarHome = homeOf('calendar-home-set')
  const addressbookHome = homeOf('addressbook-home-set')

  const listCollections = async (home, type) => {
    if (!home) return []
    const result = await propfind(home, 1, COLLECTIONS_BODY)
    if (!result) return []
    return result.responses
      .filter((r) => r.props.resourcetype && child(r.props.resourcetype, type))
      .map((r) => {
        const url = new URL(r.href, result.url).href
        const lastSegment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? url
        return { url, name: r.props.displayname?.text.trim() || decodeURIComponent(lastSegment) }
      })
  }

  const calendars = (await listCollections(calendarHome, 'calendar')).filter(
    (c) => c.name !== 'Calino Settings' && !c.url.includes('calino-settings')
  )
  const addressBooks = await listCollections(addressbookHome, 'addressbook')
  return { calendars, addressBooks, calendarHome, addressbookHome }
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

let muted = false
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding)
    callback()
  },
})
let rl
const pendingLines = []
const waiters = []
let inputClosed = false

function startInput() {
  rl = createInterface({
    input: process.stdin,
    output,
    prompt: '',
    terminal: Boolean(process.stdin.isTTY),
  })
  rl.on('line', (line) => {
    const waiter = waiters.shift()
    if (waiter) waiter(line)
    else pendingLines.push(line)
  })
  rl.on('close', () => {
    inputClosed = true
    while (waiters.length) waiters.shift()(null)
  })
  rl.on('SIGINT', () => {
    process.stdout.write('\nAborted — nothing was written.\n')
    process.exit(130)
  })
}

function nextLine() {
  if (pendingLines.length) return Promise.resolve(pendingLines.shift())
  if (inputClosed) return Promise.resolve(null)
  return new Promise((r) => waiters.push(r))
}

/**
 * Show a question. In a terminal it goes through readline, which redraws the
 * prompt with the line on every edit (a prompt written around it would be
 * wiped by the first backspace).
 */
function showPrompt(text) {
  if (process.stdin.isTTY) {
    rl.setPrompt(text)
    rl.prompt()
  } else {
    process.stdout.write(text)
  }
}

async function ask(question, fallback = '') {
  const hint = fallback ? ` [${fallback}]` : ''
  showPrompt(`${question}${hint}: `)
  const line = await nextLine()
  if (line === null) throw new Error('input ended before all questions were answered')
  if (!process.stdin.isTTY) process.stdout.write('\n')
  return line.trim() || fallback
}

async function askRequired(question, fallback = '') {
  for (;;) {
    const answer = await ask(question, fallback)
    if (answer) return answer
    console.log('  A value is required.')
  }
}

async function askSecret(question, { allowEmpty = false } = {}) {
  for (;;) {
    // Written around readline, which is muted (no echo) and has an empty
    // prompt, so its redraws neither show the secret nor wipe the question.
    rl.setPrompt('')
    process.stdout.write(`${question}: `)
    muted = true
    const line = await nextLine()
    muted = false
    process.stdout.write('\n')
    if (line === null) throw new Error('input ended before all questions were answered')
    if (line || allowEmpty) return line
    console.log('  A value is required.')
  }
}

async function confirm(question, defaultYes) {
  for (;;) {
    const answer = (await ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}`)).toLowerCase()
    if (!answer) return defaultYes
    if (['y', 'yes'].includes(answer)) return true
    if (['n', 'no'].includes(answer)) return false
  }
}

async function choose(question, options) {
  console.log(question)
  options.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}`))
  for (;;) {
    const answer = Number(await ask('Choose', '1'))
    if (Number.isInteger(answer) && answer >= 1 && answer <= options.length)
      return options[answer - 1].value
  }
}

function normalizeUrl(input) {
  let text = input.trim()
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcal/i, 'https')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`
  const url = new URL(text)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('only http(s) URLs are supported')
  return url.href
}

async function askUrl(question, fallback) {
  for (;;) {
    try {
      return normalizeUrl(await askRequired(question, fallback))
    } catch (err) {
      console.log(`  Not a valid URL (${err.message}).`)
    }
  }
}

/** Parse "1,3,5-7" into zero-based indexes, or null when malformed. */
export function parseSelection(text, count) {
  const picked = new Set()
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!range) return null
    const from = Number(range[1])
    const to = range[2] ? Number(range[2]) : from
    if (from < 1 || to > count || from > to) return null
    for (let i = from; i <= to; i++) picked.add(i - 1)
  }
  return picked.size ? [...picked].sort((a, b) => a - b) : null
}

// ─── Account flow ────────────────────────────────────────────────────────────

const describeSelection = (calendars) =>
  calendars ? `${calendars.length} selected calendar(s)` : 'all calendars'

async function askHeaders(existing = {}) {
  const headers = { ...existing }
  const names = Object.keys(headers)
  if (names.length) {
    console.log(`  Custom headers: ${names.join(', ')}`)
    if (!(await confirm('  Keep these custom headers?', true)))
      for (const n of names) delete headers[n]
  }
  if (
    !(await confirm(
      '  Add custom HTTP headers (only for a DAV server behind an auth gateway)?',
      false
    ))
  ) {
    return headers
  }
  for (;;) {
    const name = await ask('  Header name (empty to finish)')
    if (!name) return headers
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      console.log('  Not a valid header name.')
      continue
    }
    headers[name] = await askSecret(`  Value for ${name} (hidden)`)
  }
}

async function selectCalendars(found, current) {
  if (found.length === 0) return current
  console.log(`\n  Calendars on this account:`)
  const selectedPaths = current
    ? new Set(current.map((c) => new URL(c.url).pathname.replace(/\/+$/, '')))
    : null
  found.forEach((cal, i) => {
    const mark = selectedPaths
      ? selectedPaths.has(new URL(cal.url).pathname.replace(/\/+$/, ''))
        ? '[x]'
        : '[ ]'
      : '[x]'
    console.log(`    ${String(i + 1).padStart(2)}) ${mark} ${cal.name}`)
  })
  if (
    await confirm(`  Sync ALL ${found.length} calendars (including ones created later)?`, !current)
  ) {
    return undefined
  }
  for (;;) {
    const answer = await ask('  Which calendars to sync? Numbers, e.g. 1,3,5-7')
    const picked = parseSelection(answer, found.length)
    if (picked) {
      const chosen = picked.map((i) => ({ url: found[i].url, name: found[i].name }))
      console.log(`  Selected: ${chosen.map((c) => c.name).join(', ')}`)
      return chosen
    }
    console.log(`  Enter numbers between 1 and ${found.length}.`)
  }
}

/** Ask for (or edit) one account, test it and pick its calendars. */
async function editAccount(existing) {
  const account = {
    name: '',
    url: '',
    username: '',
    password: '',
    headers: {},
    calendars: undefined,
    ...existing,
  }
  console.log('')
  account.url = await askUrl(
    '  Server URL (CalDAV/CardDAV, e.g. https://cloud.example.com/remote.php/dav)',
    account.url
  )
  account.username = await askRequired('  Username', account.username)
  const password = await askSecret(
    existing ? '  Password (hidden, empty keeps the current one)' : '  Password (hidden)',
    { allowEmpty: Boolean(existing) }
  )
  if (password) account.password = password
  account.name = await askRequired('  Display name in Calino', account.name || account.username)
  account.headers = await askHeaders(account.headers)

  for (;;) {
    process.stdout.write('  Testing login and looking for calendars and address books… ')
    try {
      const found = await discoverAccount(account)
      console.log('ok')
      console.log(
        `  Found ${found.calendars.length} calendar(s) and ${found.addressBooks.length} address book(s).`
      )
      if (found.addressBooks.length) {
        console.log(
          `  Address books (all synced as contacts): ${found.addressBooks.map((a) => a.name).join(', ')}`
        )
      }
      account.calendars = await selectCalendars(found.calendars, account.calendars)
      return account
    } catch (err) {
      console.log('failed')
      console.log(
        `  ${err instanceof DavError ? err.message : `could not reach the server (${err.cause?.code ?? err.message})`}`
      )
      const next = await choose('  What now?', [
        { label: 'Re-enter the details', value: 'edit' },
        { label: 'Retry the test', value: 'retry' },
        {
          label: 'Keep it untested (syncs all calendars, or the selection it already had)',
          value: 'keep',
        },
        { label: 'Discard this account', value: 'discard' },
      ])
      if (next === 'keep') return account
      if (next === 'discard') return null
      if (next === 'edit') return editAccount(account)
    }
  }
}

async function editWebcal(existing) {
  const sub = { name: '', url: '', refreshIntervalMinutes: 60, ...existing }
  console.log('')
  sub.url = await askUrl('  Calendar feed URL (.ics or webcal://)', sub.url)
  sub.name = await askRequired('  Display name', sub.name)
  for (;;) {
    const minutes = Number(
      await ask('  Refresh every N minutes', String(sub.refreshIntervalMinutes ?? 60))
    )
    if (Number.isFinite(minutes) && minutes > 0) {
      sub.refreshIntervalMinutes = minutes
      return sub
    }
  }
}

async function reviewList(items, label, describe, edit) {
  const kept = []
  for (const item of items) {
    const action = await choose(`\n${label}: ${describe(item)}`, [
      { label: 'Keep as is', value: 'keep' },
      { label: 'Edit', value: 'edit' },
      { label: 'Remove', value: 'remove' },
    ])
    if (action === 'keep') kept.push(item)
    if (action === 'edit') {
      const edited = await edit(item)
      if (edited) kept.push(edited)
    }
  }
  return kept
}

async function addMore(items, noun, defaultFirst, edit) {
  for (;;) {
    const question = items.length ? `Add another ${noun}?` : `Add a ${noun}?`
    if (!(await confirm(question, items.length === 0 && defaultFirst))) return items
    const created = await edit(undefined)
    if (created) items.push(created)
  }
}

// ─── Config file ─────────────────────────────────────────────────────────────

async function decryptConfig(config, master) {
  const accounts = []
  for (const a of config.accounts ?? []) {
    const headers = {}
    for (const [name, value] of Object.entries(a.headers ?? {}))
      headers[name] = await decryptValue(value, master)
    accounts.push({
      name: a.name,
      url: await decryptValue(a.url, master),
      username: await decryptValue(a.username, master),
      password: await decryptValue(a.password, master),
      headers,
      calendars: a.calendars ? JSON.parse(await decryptValue(a.calendars, master)) : undefined,
    })
  }
  const webcals = []
  for (const w of config.webcalSubscriptions ?? []) {
    webcals.push({
      name: w.name,
      url: await decryptValue(w.url, master),
      refreshIntervalMinutes: w.refreshIntervalMinutes,
      ...(w.proxyUrl ? { proxyUrl: w.proxyUrl } : {}),
    })
  }
  return { accounts, webcals }
}

export async function buildConfig({ accounts, webcals, extra = {} }, master) {
  const encryptedAccounts = []
  for (const a of accounts) {
    const headers = {}
    for (const [name, value] of Object.entries(a.headers ?? {}))
      headers[name] = await encryptValue(value, master)
    encryptedAccounts.push({
      name: a.name,
      url: await encryptValue(a.url, master),
      username: await encryptValue(a.username, master),
      password: await encryptValue(a.password, master),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(a.calendars
        ? { calendars: await encryptValue(JSON.stringify(a.calendars), master) }
        : {}),
    })
  }
  const encryptedWebcals = []
  for (const w of webcals) {
    encryptedWebcals.push({
      name: w.name,
      url: await encryptValue(w.url, master),
      ...(w.refreshIntervalMinutes ? { refreshIntervalMinutes: w.refreshIntervalMinutes } : {}),
      ...(w.proxyUrl ? { proxyUrl: w.proxyUrl } : {}),
    })
  }
  return {
    ...extra,
    version: 1,
    accounts: encryptedAccounts,
    webcalSubscriptions: encryptedWebcals,
  }
}

async function askNewMasterPassword() {
  console.log('\nChoose the master password. Everyone who opens Calino enters it once per browser.')
  for (;;) {
    const first = await askSecret('Master password (hidden)')
    if (
      first.length < 8 &&
      !(await confirm('  That is shorter than 8 characters. Use it anyway?', false))
    )
      continue
    const second = await askSecret('Repeat master password')
    if (first === second) return first
    console.log('  The passwords do not match. Try again.')
  }
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--out' || argv[i] === '-o') && argv[i + 1]) args.out = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Usage: node calino-config.mjs [--out <path>]

Interactively builds an encrypted calino.config.json (default: ./${DEFAULT_OUT}).
Run it again on the same file to edit it.`)
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${argv[i]} (try --help)`)
      process.exit(1)
    }
  }
  return args
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2))
  const outPath = resolve(out)
  startInput()

  console.log('Calino config generator')
  console.log(`Output: ${outPath}\n`)

  let accounts = []
  let webcals = []
  let extra = {}
  let master = null

  if (existsSync(outPath)) {
    let existing
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf8'))
    } catch (err) {
      console.log(`The existing file is not valid JSON (${err.message}); starting fresh.`)
    }
    if (
      existing &&
      (await confirm(
        'A config already exists there. Edit it (otherwise start from scratch)?',
        true
      ))
    ) {
      for (;;) {
        const attempt = await askSecret('Its master password (hidden)')
        try {
          process.stdout.write('Unlocking… ')
          ;({ accounts, webcals } = await decryptConfig(existing, attempt))
          console.log('ok')
          master = attempt
          break
        } catch {
          console.log('wrong password')
          if (!(await confirm('Try again?', true))) {
            console.log('Nothing was written.')
            process.exit(1)
          }
        }
      }
      // Keep fields this tool does not manage, such as linkSchemes.
      const { version: _v, accounts: _a, webcalSubscriptions: _w, ...rest } = existing
      extra = rest

      accounts = await reviewList(
        accounts,
        'Account',
        (a) => `${a.name} — ${a.username} @ ${a.url} — ${describeSelection(a.calendars)}`,
        editAccount
      )
      webcals = await reviewList(
        webcals,
        'Calendar feed',
        (w) => `${w.name} — ${w.url}`,
        editWebcal
      )
    }
  }

  console.log('\n── DAV accounts (calendars + contacts) ──')
  console.log('Add each server login once: Calino syncs both its calendars (CalDAV)')
  console.log('and its address books (CardDAV) from the same account.')
  accounts = await addMore(accounts, 'DAV account', true, editAccount)

  console.log('\n── Read-only calendar feeds (.ics / webcal) ──')
  webcals = await addMore(webcals, 'calendar feed', false, editWebcal)

  if (accounts.length === 0 && webcals.length === 0) {
    console.log('\nNo accounts or feeds — nothing to write.')
    process.exit(1)
  }

  if (!master || !(await confirm('\nKeep the current master password?', true))) {
    master = await askNewMasterPassword()
  }

  process.stdout.write('\nEncrypting (this takes a few seconds)… ')
  const config = await buildConfig({ accounts, webcals, extra }, master)
  console.log('done')

  if (existsSync(outPath)) copyFileSync(outPath, `${outPath}.bak`)
  // writeFileSync truncates the existing file rather than replacing it, so a
  // container that bind-mounts this exact file keeps seeing it.
  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 })

  console.log(`\nWrote ${outPath}`)
  console.log(
    `  ${accounts.length} account(s): ${accounts.map((a) => `${a.name} (${describeSelection(a.calendars)})`).join(', ') || '—'}`
  )
  console.log(
    `  ${webcals.length} calendar feed(s): ${webcals.map((w) => w.name).join(', ') || '—'}`
  )
  console.log('\nRestart the Calino container (or just reload the page) to pick it up.')
  rl.close()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`)
    process.exit(1)
  })
}
