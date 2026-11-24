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

interface LoadedConfig {
  config: CalinoConfig | null
  linkSchemes: Record<string, string>
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

async function selectConfig(): Promise<unknown> {
  const bundled = typeof __CALINO_CONFIG__ === 'undefined' ? null : __CALINO_CONFIG__
  if (!__CALINO_RUNTIME_CONFIG__ || Capacitor.isNativePlatform()) return bundled

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}calino.config.json`, {
      cache: 'no-store',
      headers: { 'X-Calino-Config-Fetch': '1' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
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
  if (raw === null) return { config: null, linkSchemes: {} }

  const envelope = CalinoConfigEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    console.warn('[configLoader] Invalid config, ignoring', envelope.error.issues)
    return { config: null, linkSchemes: {} }
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
