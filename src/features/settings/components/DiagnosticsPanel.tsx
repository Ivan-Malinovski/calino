import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
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

const STATUS_TEXT: Record<DiagnosticCheck['status'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  warn: 'Warning',
  skipped: 'Skipped',
  unknown: 'Unknown',
}

const SUMMARY_TEXT: Record<DiagnosticsReport['summary'], string> = {
  ok: 'Everything checks out.',
  degraded: 'Sync will work, but your server could be configured better.',
  broken: 'Something is wrong with this server.',
}

/**
 * Runs `runDiagnostics` and renders the checks as they arrive.
 *
 * Results stream rather than appearing at the end because a full run can take
 * the better part of a minute against a slow server, and the first failing
 * check is usually the answer — the user shouldn't wait for the rest.
 */
export function DiagnosticsPanel({ options, autoRun = false }: DiagnosticsPanelProps): JSX.Element {
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
          {running ? 'Running…' : checks.length > 0 ? 'Run again' : 'Run diagnostics'}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void run(true)}
          disabled={running}
          data-action="run-write-test"
          title="Creates a temporary event on your server and deletes it again"
        >
          Run with write test
        </button>
        {report && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void handleCopy()}
            data-action="copy-report"
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
      </div>

      <p className={styles.note}>
        The write test creates one temporary event on your server and deletes it immediately.
        Everything else only reads.
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
                    aria-label={STATUS_TEXT[check.status]}
                  >
                    {STATUS_TEXT[check.status]}
                  </span>
                  <span className={styles.checkLabel}>{check.label}</span>
                  {check.evidence === 'inferred' && (
                    <span
                      className={styles.inferred}
                      title="Your browser hides the relevant header, so this was deduced from how the server behaved."
                    >
                      inferred
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className={styles.checkBody}>
                    <p className={styles.detail}>{check.detail}</p>
                    {check.raw && <pre className={styles.raw}>{check.raw}</pre>}
                    {check.fix && (
                      <>
                        <div className={styles.fixLabel}>How to fix</div>
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
          {SUMMARY_TEXT[report.summary]}
          {report.platform === 'web' && !report.viaProxy && (
            <span className={styles.summaryNote}>
              {' '}
              Checks marked “inferred” could not be read directly — browsers hide a server's CORS
              headers from JavaScript.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
