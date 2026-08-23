import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatReportForClipboard,
  runDiagnostics,
  type DiagnosticCheck,
  type DiagnosticsOptions,
  type DiagnosticsReport,
} from '@/features/caldav/client/diagnostics'
import styles from './DiagnosticsPanel.module.css'

interface DiagnosticsPanelProps {
  /** Everything `runDiagnostics` needs except the opt-in write test. */
  options: Omit<DiagnosticsOptions, 'includeWriteTest' | 'onProgress'>
  /** Start a read-only run as soon as the panel mounts. */
  autoRun?: boolean
}

/**
 * Runs `runDiagnostics` and renders the checks as they arrive.
 *
 * Results stream rather than appearing at the end because a full run can take
 * the better part of a minute against a slow server, and the first failing
 * check is usually the answer — the user shouldn't wait for the rest.
 */
export function DiagnosticsPanel({ options, autoRun = false }: DiagnosticsPanelProps): JSX.Element {
  const { t } = useTranslation('settings')
  const [checks, setChecks] = useState<DiagnosticCheck[]>([])
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // A run outlives a re-render, and options is a fresh object every time —
  // keep the latest in a ref so `run` stays stable and autoRun fires once.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const run = useCallback(async (includeWriteTest: boolean): Promise<void> => {
    setRunning(true)
    setChecks([])
    setReport(null)
    setCopied(false)
    try {
      const result = await runDiagnostics({
        ...optionsRef.current,
        includeWriteTest,
        onProgress: (check) => setChecks((prev) => [...prev, check]),
      })
      setReport(result)
      // The report is authoritative: streamed checks can be superseded (the
      // write test's cleanup warning is appended under the same id).
      setChecks(result.checks)
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    if (autoRun) void run(false)
  }, [autoRun, run])

  const handleCopy = async (): Promise<void> => {
    if (!report) return
    await navigator.clipboard.writeText(formatReportForClipboard(report))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className={styles.panel} data-component="diagnostics-panel">
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => void run(false)}
          disabled={running}
          data-action="run-diagnostics"
        >
          {running ? t('diagnostics.running') : checks.length > 0 ? t('diagnostics.runAgain') : t('diagnostics.runDiagnostics')}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void run(true)}
          disabled={running}
          data-action="run-write-test"
          title={t('diagnostics.runWithWriteTestTitle')}
        >
          {t('diagnostics.runWithWriteTest')}
        </button>
        {report && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void handleCopy()}
            data-action="copy-report"
          >
            {copied ? t('diagnostics.copied') : t('diagnostics.copyReport')}
          </button>
        )}
      </div>

      <p className={styles.note}>
        {t('diagnostics.note')}
      </p>

      {checks.length > 0 && (
        <ul className={styles.checks}>
          {checks.map((check, index) => {
            const key = `${check.id}-${index}`
            const isOpen = expanded.has(key)
            return (
              <li
                key={key}
                className={styles.check}
                data-check={check.id}
                data-status={check.status}
              >
                <button
                  type="button"
                  className={styles.checkHeader}
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                >
                  <span
                    className={styles.badge}
                    data-status={check.status}
                    aria-label={t(`diagnostics.status.${check.status}`)}
                  >
                    {t(`diagnostics.status.${check.status}`)}
                  </span>
                  <span className={styles.checkLabel}>{check.label}</span>
                  {check.evidence === 'inferred' && (
                    <span
                      className={styles.inferred}
                      title={t('diagnostics.inferredTitle')}
                    >
                      {t('diagnostics.inferred')}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className={styles.checkBody}>
                    <p className={styles.detail}>{check.detail}</p>
                    {check.raw && <pre className={styles.raw}>{check.raw}</pre>}
                    {check.fix && (
                      <>
                        <div className={styles.fixLabel}>{t('diagnostics.howToFix')}</div>
                        <pre className={styles.fix}>{check.fix}</pre>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {report && (
        <div className={styles.summary} data-summary={report.summary}>
          {t(`diagnostics.summary.${report.summary}`)}
          {report.platform === 'web' && !report.viaProxy && (
            <span className={styles.summaryNote}>
              {' '}
              {t('diagnostics.corsNote')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
