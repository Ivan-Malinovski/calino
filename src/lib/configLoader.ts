import { z } from 'zod'
import { isMasterEncryptedData, type MasterEncryptedData } from './crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreconfiguredAccount {
  name: string
  url: MasterEncryptedData
  username: MasterEncryptedData
  password: MasterEncryptedData
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

let cachedConfig: CalinoConfig | null | undefined

const MasterEncryptedDataSchema = z.custom<MasterEncryptedData>(
  (value) => isMasterEncryptedData(value),
  { message: 'Expected MasterEncryptedData shape' }
)

const PreconfiguredAccountSchema = z.object({
  name: z.string().trim().min(1),
  url: MasterEncryptedDataSchema,
  username: MasterEncryptedDataSchema,
  password: MasterEncryptedDataSchema,
})

const PreconfiguredWebcalSchema = z.object({
  name: z.string().trim().min(1),
  url: MasterEncryptedDataSchema,
  refreshIntervalMinutes: z.number().positive().optional(),
  proxyUrl: z.string().trim().min(1).optional(),
})

const CalinoConfigEnvelopeSchema = z.object({
  version: z.literal(1),
  accounts: z.array(z.unknown()),
  webcalSubscriptions: z.array(z.unknown()).optional(),
})

/**
 * Load self-hosted config.
 * The config is baked into the JS bundle at build time (not served as a separate file).
 * Returns null if no config was provided at build time (not self-hosted mode).
 */
export async function loadConfig(): Promise<CalinoConfig | null> {
  // Return cached result if already loaded
  if (cachedConfig !== undefined) {
    return cachedConfig
  }

  // __CALINO_CONFIG__ is injected by Vite's define at build time
  // It's null if calino.config.json doesn't exist
  if (typeof __CALINO_CONFIG__ === 'undefined' || __CALINO_CONFIG__ === null) {
    cachedConfig = null
    return null
  }

  const envelope = CalinoConfigEnvelopeSchema.safeParse(__CALINO_CONFIG__)

  if (!envelope.success) {
    console.warn('[configLoader] Invalid config, ignoring', envelope.error.issues)
    cachedConfig = null
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

  if (accounts.length === 0 && webcalSubscriptions.length === 0) {
    cachedConfig = null
    return null
  }

  const config: CalinoConfig = { version: 1, accounts, webcalSubscriptions }
  cachedConfig = config
  return config
}

/**
 * Reset cached config (for testing).
 */
export function resetConfigCache(): void {
  cachedConfig = undefined
}
