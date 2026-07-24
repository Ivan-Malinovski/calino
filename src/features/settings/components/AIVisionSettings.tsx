import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Capacitor } from '@capacitor/core'
import { listModels, testConnection } from '@/features/aiVision/client'
import {
  DEFAULT_BASE_URLS,
  type AIProvider,
  type ModelInfo,
  type TestConnectionResult,
} from '@/features/aiVision/types'
import { useAIVisionSettingsStore } from '@/store/aiVisionSettingsStore'
import styles from './Settings.module.css'

interface TestState {
  status: 'testing' | 'ok' | 'warn' | 'error'
  message?: string
  hint?: string
}

const PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
]

function EyeIcon({ open }: { open: boolean }): JSX.Element {
  if (open) {
    return (
      <svg
        viewBox="0 0 18 18"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1 9s3-5.5 8-5.5S17 9 17 9s-3 5.5-8 5.5S1 9 1 9z" />
        <circle cx="9" cy="9" r="2.25" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 18 18"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 9s3-5.5 8-5.5S17 9 17 9s-3 5.5-8 5.5S1 9 1 9z" />
      <circle cx="9" cy="9" r="2.25" />
      <path d="M2 2l14 14" />
    </svg>
  )
}

function RefreshIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 18 18"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 9a6.5 6.5 0 10-1.9 4.6" />
      <path d="M15.5 4.5V9h-4.5" />
    </svg>
  )
}

export function AIVisionSettings(): JSX.Element {
  const isNative = Capacitor.isNativePlatform()

  const provider = useAIVisionSettingsStore((s) => s.provider)
  const baseUrl = useAIVisionSettingsStore((s) => s.baseUrl)
  const model = useAIVisionSettingsStore((s) => s.model)
  const lastVerified = useAIVisionSettingsStore((s) => s.lastVerified)
  const setProvider = useAIVisionSettingsStore((s) => s.setProvider)
  const setBaseUrl = useAIVisionSettingsStore((s) => s.setBaseUrl)
  const setModel = useAIVisionSettingsStore((s) => s.setModel)
  const setApiKey = useAIVisionSettingsStore((s) => s.setApiKey)
  const getApiKey = useAIVisionSettingsStore((s) => s.getApiKey)
  const setLastVerified = useAIVisionSettingsStore((s) => s.setLastVerified)
  const hasApiKey = useAIVisionSettingsStore((s) => s.hasApiKey)

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(hasApiKey())

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelFetchError, setModelFetchError] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)

  const [testState, setTestState] = useState<TestState | null>(null)

  const fetchModels = async (): Promise<void> => {
    if (!hasApiKey()) return
    setModelsLoading(true)
    setModelFetchError(null)
    try {
      const key = await getApiKey()
      if (!key) {
        setModelFetchError('No API key saved yet.')
        return
      }
      const fetched = await listModels({ provider, baseUrl, apiKey: key, model })
      setModels(fetched)
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    if (isNative && hasApiKey()) {
      void fetchModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveKey = async (): Promise<void> => {
    if (apiKeyInput === '') return
    await setApiKey(apiKeyInput)
    setKeySaved(true)
    setApiKeyInput('')
    setShowKey(false)
  }

  const handleClearKey = async (): Promise<void> => {
    await setApiKey('')
    setKeySaved(false)
    setApiKeyInput('')
    setModels([])
    setTestState(null)
  }

  const handleTest = async (): Promise<void> => {
    setTestState({ status: 'testing' })
    const key = await getApiKey()
    if (!key) {
      setTestState({ status: 'error', message: 'No API key saved yet.' })
      return
    }
    const result: TestConnectionResult = await testConnection({
      provider,
      baseUrl,
      apiKey: key,
      model,
    })
    if (result.ok && result.visionCapable) {
      setTestState({ status: 'ok' })
      setLastVerified({ at: Date.now(), ok: true, visionCapable: true })
    } else if (result.ok && result.visionCapable === false) {
      setTestState({ status: 'warn', hint: result.hint })
      setLastVerified({ at: Date.now(), ok: true, visionCapable: false })
    } else {
      setTestState({ status: 'error', message: result.error, hint: result.hint })
    }
  }

  const resolvedBaseUrl = provider === 'custom' ? baseUrl : DEFAULT_BASE_URLS[provider]

  const modelOptions = (() => {
    const opts = [...models]
    if (model && !opts.some((m) => m.id === model)) {
      opts.unshift({ id: model })
    }
    return opts
  })()

  const renderLastVerified = (): JSX.Element | null => {
    if (!lastVerified) return null
    const when = formatDistanceToNow(new Date(lastVerified.at), { addSuffix: true })
    if (lastVerified.ok && lastVerified.visionCapable) {
      return (
        <div className={styles.accountStatus}>
          <div className={`${styles.statusDot} ${styles.statusDotOk}`} />
          Last verified {when} — vision-capable
        </div>
      )
    }
    return (
      <div className={styles.accountStatus}>
        <div className={`${styles.statusDot} ${styles.statusDotWarn}`} />
        Last verified {when} — model may not support images
      </div>
    )
  }

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="ai-vision-settings"
    >
      <h1 className={styles.pageTitle}>AI Photo Import</h1>
      <p className={styles.rowDesc} style={{ padding: '0 20px', marginBottom: 16 }}>
        Use your own API key to auto-fill event details from a photo. Available when creating a new
        event on Android.
      </p>

      {!isNative && (
        <div className={styles.accountHint}>This feature is only available in the Android app.</div>
      )}

      {isNative && (
        <>
          <div className={styles.group}>
            <div className={styles.groupLabel}>Provider</div>
            <div
              className={styles.row}
              data-component="setting-row"
              data-setting="ai-vision-provider"
              data-value={provider}
            >
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>Provider</div>
                <div className={styles.rowDesc}>Which vision AI service to send photos to</div>
              </div>
              <div className={styles.rowControl}>
                <select
                  className={styles.select}
                  value={provider}
                  aria-label="AI provider"
                  onChange={(e) => setProvider(e.target.value as AIProvider)}
                >
                  {PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className={styles.row}
              data-component="setting-row"
              data-setting="ai-vision-base-url"
            >
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>Base URL</div>
                <div className={styles.rowDesc}>
                  {provider === 'custom'
                    ? "OpenAI- or Anthropic-compatible endpoint — add /anthropic to the path if it speaks Anthropic's API. No trailing /v1."
                    : 'Requests are sent here'}
                </div>
              </div>
              <div className={styles.rowControl}>
                {provider === 'custom' ? (
                  <input
                    type="text"
                    className={styles.formInput}
                    value={baseUrl}
                    placeholder="https://api.example.com"
                    aria-label="Base URL"
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                ) : (
                  <span className={styles.applySectionText} style={{ marginLeft: 0 }}>
                    {resolvedBaseUrl}
                  </span>
                )}
              </div>
            </div>

            <div
              className={styles.row}
              data-component="setting-row"
              data-setting="ai-vision-api-key"
            >
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>API Key</div>
                <div className={styles.rowDesc}>Stored encrypted on this device only</div>
              </div>
              <div className={styles.rowControl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    className={styles.formInput}
                    value={apiKeyInput}
                    placeholder={keySaved ? '••••••••••••' : 'Enter API key'}
                    aria-label="API key"
                    autoComplete="off"
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onBlur={() => {
                      if (apiKeyInput !== '') void handleSaveKey()
                    }}
                  />
                  <button
                    type="button"
                    className={styles.rowBtn}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    <EyeIcon open={showKey} />
                  </button>
                </div>
              </div>
            </div>
            {keySaved && apiKeyInput === '' && (
              <div
                className={styles.accountStatus}
                style={{ padding: '0 20px 12px', marginTop: -6 }}
              >
                <div className={`${styles.statusDot} ${styles.statusDotOk}`} />
                Key saved
                <button
                  type="button"
                  className={styles.rowBtn}
                  style={{ marginLeft: 8 }}
                  onClick={() => void handleClearKey()}
                >
                  Clear
                </button>
              </div>
            )}

            <div className={styles.row} data-component="setting-row" data-setting="ai-vision-model">
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>Model</div>
                <div className={styles.rowDesc}>
                  {modelFetchError
                    ? "Couldn't fetch model list — enter a model id manually."
                    : 'Vision-capable model used to read photos'}
                </div>
              </div>
              <div className={styles.rowControl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {modelFetchError || (models.length === 0 && !modelsLoading) ? (
                    <input
                      type="text"
                      className={styles.formInput}
                      value={model}
                      placeholder="model id"
                      aria-label="Model id"
                      onChange={(e) => setModel(e.target.value)}
                    />
                  ) : (
                    <select
                      className={styles.select}
                      value={model}
                      aria-label="Model"
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label ?? m.id}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className={styles.rowBtn}
                    aria-label="Refresh model list"
                    disabled={modelsLoading || !hasApiKey()}
                    onClick={() => void fetchModels()}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.group}>
            <div className={styles.row} data-component="setting-row" data-setting="ai-vision-test">
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>Test Connection</div>
                <div className={styles.rowDesc}>
                  Verify the key works and the model can read images
                </div>
                {testState?.status === 'testing' && (
                  <div className={styles.accountStatus}>
                    <div className={`${styles.statusDot} ${styles.statusDotTesting}`} />
                    Testing…
                  </div>
                )}
                {testState?.status === 'ok' && (
                  <div className={styles.accountStatus}>
                    <div className={`${styles.statusDot} ${styles.statusDotOk}`} />
                    Connection OK — vision-capable
                  </div>
                )}
                {testState?.status === 'warn' && (
                  <div className={styles.accountStatus}>
                    <div className={`${styles.statusDot} ${styles.statusDotWarn}`} />
                    {testState.hint ?? "Key works, but this model doesn't appear to support images"}
                  </div>
                )}
                {testState?.status === 'error' && (
                  <div className={styles.accountStatus}>
                    <div className={`${styles.statusDot} ${styles.statusDotWarn}`} />
                    {testState.message ? `Failed — ${testState.message}` : 'Connection failed'}
                  </div>
                )}
                {!testState && renderLastVerified()}
              </div>
              <div className={styles.rowControl}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  disabled={testState?.status === 'testing' || !hasApiKey()}
                  onClick={() => void handleTest()}
                  data-component="action-button"
                  data-action="test-ai-vision-connection"
                >
                  {testState?.status === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
