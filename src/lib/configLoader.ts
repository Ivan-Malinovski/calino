import { Capacitor } from '@capacitor/core'
import { z } from 'zod'
import { loadLinkSchemes } from './appLinks'
import { isMasterEncryptedData, type MasterEncryptedData } from './crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreconfiguredAccount {
  name: string
  url: MasterEncryptedData
  username: MasterEncryptedData
  password: MasterEncryptedData
  headers?: Record<string, MasterEncryptedData>
}

export interface PreconfiguredWebcal {
  name: string
  // May embed a secret token in the query string, so encrypted like CalDAV url.
  url: MasterEncryptedData
  refreshIntervalMinutes?: number
  proxyUrl?: string
}

export interface CalinoConfig {
  version: number
  accounts: PreconfiguredAccount[]
  webcalSubscriptions: PreconfiguredWebcal[]
}

// ─── Global constant injected at build time ──────────────────────────────────

declare const __CALINO_CONFIG__: Record<string, unknown> | null

// ─── Config loading ──────────────────────────────────────────────────────────

export interface LoadedConfig {
  config: CalinoConfig | null
  linkSchemes: Record<string, string>
  requiresSignIn?: true
  perUser?: true
  verifiedUser?: string
}

let configLoad: Promise<LoadedConfig> | undefined

const MasterEncryptedDataSchema = z.custom<MasterEncryptedData>(
  (value) => isMasterEncryptedData(value),
  { message: 'Expected MasterEncryptedData shape' }
)

const PreconfiguredAccountSchema = z.object({
  name: z.string().trim().min(1),
  url: MasterEncryptedDataSchema,
  username: MasterEncryptedDataSchema,
  password: MasterEncryptedDataSchema,
  headers: z.record(z.string(), MasterEncryptedDataSchema).optional(),
})

const PreconfiguredWebcalSchema = z.object({
  name: z.string().trim().min(1),
  url: MasterEncryptedDataSchema,
  refreshIntervalMinutes: z.number().positive().optional(),
  proxyUrl: z.string().trim().min(1).optional(),
})

const CalinoConfigEnvelopeSchema = z.object({
  version: z.literal(1),
  accounts: z.array(z.unknown()).default([]),
  webcalSubscriptions: z.array(z.unknown()).optional(),
})

const SIGN_IN_REQUIRED = Symbol('config sign-in required')
const PER_USER_SIGN_IN_REQUIRED = Symbol('per-user config sign-in required')

function fetchRuntimeConfig(authorization?: string): Promise<Response> {
  return fetch(`${import.meta.env.BASE_URL}calino.config.json`, {
    cache: 'no-store',
    headers: {
      'X-Calino-Config-Fetch': '1',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
}

async function selectConfig(): Promise<unknown> {
  const bundled = typeof __CALINO_CONFIG__ === 'undefined' ? null : __CALINO_CONFIG__
  if (!__CALINO_RUNTIME_CONFIG__ || Capacitor.isNativePlatform()) return bundled

  try {
    const response = await fetchRuntimeConfig()
    if (response.headers.get('X-Calino-Config-Mode') === 'per-user') {
      return PER_USER_SIGN_IN_REQUIRED
    }
    if (response.status === 401 && response.headers.get('X-Calino-Config-Auth') === 'basic') {
      return SIGN_IN_REQUIRED
    }
    if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) {
      return bundled
    }
    if (!response.ok) {
      console.warn('[configLoader] Runtime config request failed:', response.status)
      return bundled
    }
    try {
      return await response.json()
    } catch {
      console.warn('[configLoader] Runtime config is not valid JSON')
      return null
    }
  } catch {
    console.warn('[configLoader] Runtime config is unavailable; using bundled config')
    return bundled
  }
}

export function loadConfigDocument(): Promise<LoadedConfig> {
  return (configLoad ??= readConfigDocument())
}

export async function loadConfig(): Promise<CalinoConfig | null> {
  return (await loadConfigDocument()).config
}

async function readConfigDocument(): Promise<LoadedConfig> {
  const raw = await selectConfig()
  if (raw === PER_USER_SIGN_IN_REQUIRED) {
    return { config: null, linkSchemes: {}, requiresSignIn: true, perUser: true }
  }
  if (raw === SIGN_IN_REQUIRED) return { config: null, linkSchemes: {}, requiresSignIn: true }
  return parseConfig(raw) ?? { config: null, linkSchemes: {} }
}

export async function signInToRuntimeConfig(
  username: string,
  password: string
): Promise<LoadedConfig | 'unauthorized' | 'unavailable' | 'insecure'> {
  if (!window.isSecureContext) return 'insecure'
  if (username.includes(':')) return 'unauthorized'

  try {
    const bytes = new TextEncoder().encode(`${username}:${password}`)
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    const response = await fetchRuntimeConfig(`Basic ${encoded}`)
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    if (!response.ok) return 'unavailable'
    const document = parseConfig(await response.json())
    if (!document) return 'unavailable'
    if (response.headers.get('X-Calino-Config-Mode') !== 'per-user') return document

    const verifiedUser = response.headers.get('X-Calino-Config-User')
    if (!verifiedUser || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(verifiedUser))
      return 'unavailable'
    return { ...document, perUser: true, verifiedUser }
  } catch {
    return 'unavailable'
  }
}

function parseConfig(raw: unknown): LoadedConfig | null {
  if (raw === null) return null

  const envelope = CalinoConfigEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    console.warn('[configLoader] Invalid config, ignoring', envelope.error.issues)
    return null
  }

  const accounts: PreconfiguredAccount[] = []
  for (const raw of envelope.data.accounts) {
    const parsed = PreconfiguredAccountSchema.safeParse(raw)
    if (parsed.success) {
      accounts.push(parsed.data)
    } else {
      console.warn('[configLoader] Skipping invalid account entry', parsed.error.issues)
    }
  }

  const webcalSubscriptions: PreconfiguredWebcal[] = []
  for (const raw of envelope.data.webcalSubscriptions ?? []) {
    const parsed = PreconfiguredWebcalSchema.safeParse(raw)
    if (parsed.success) {
      webcalSubscriptions.push(parsed.data)
    } else {
      console.warn('[configLoader] Skipping invalid webcal subscription entry', parsed.error.issues)
    }
  }

  return {
    config:
      accounts.length || webcalSubscriptions.length
        ? { version: 1, accounts, webcalSubscriptions }
        : null,
    linkSchemes: loadLinkSchemes(raw),
  }
}

/**
 * Reset cached config (for testing).
 */
export function resetConfigCache(): void {
  configLoad = undefined
}
