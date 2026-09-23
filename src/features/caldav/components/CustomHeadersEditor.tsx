import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react'
import { config } from '@/config'
import type { ConnectionNudge } from './connectionNudge'
import type { HeaderRow } from './headerRows'
import styles from './CustomHeadersEditor.module.css'

export interface ProxyField {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/**
 * The collapsible card for how the connection reaches the server. With `proxy`
 * it is the "Connection settings" card used by the Add/Edit dialog and /setup
 * (proxy URL + custom headers); without it, a header-only "Gateway access" card.
 *
 * `open`/`onOpenChange` make the card controlled, so a failed connect can open
 * it from outside. `nudge` gives it the accent treatment and focuses the
 * relevant field whenever the card opens while nudged.
 */
export function CustomHeadersEditor({
  rows,
  onChange,
  proxy,
  open: controlledOpen,
  onOpenChange,
  nudge,
  nudgeLabel,
}: {
  rows: HeaderRow[]
  onChange: (rows: HeaderRow[]) => void
  proxy?: ProxyField
  open?: boolean
  onOpenChange?: (open: boolean) => void
  nudge?: ConnectionNudge | null
  /** Subtitle shown while nudged, e.g. "A proxy may fix this". */
  nudgeLabel?: string
}): JSX.Element {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [visible, setVisible] = useState<Record<number, boolean>>({})
  const proxySet = Boolean(proxy?.value.trim())
  const open = controlledOpen ?? manualOpen ?? (rows.length > 0 || proxySet)
  const setOpen = (next: boolean): void => {
    setManualOpen(next)
    onOpenChange?.(next)
  }

  const proxyInputRef = useRef<HTMLInputElement>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !nudge) return
    if (nudge === 'proxy') {
      proxyInputRef.current?.focus()
    } else {
      headersRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [open, nudge])

  const headerCount = rows.filter((row) => row.name.trim() || row.value).length
  const headerSummary = headerCount
    ? `${headerCount} custom ${headerCount === 1 ? 'header' : 'headers'}`
    : ''

  let subtitle: string
  if (nudge && nudgeLabel) {
    subtitle = nudgeLabel
  } else if (proxy) {
    const parts = [proxySet ? 'Proxy on' : '', headerSummary].filter(Boolean)
    subtitle = parts.length ? parts.join(' · ') : 'Optional'
  } else {
    subtitle = headerSummary || 'For protected CalDAV servers'
  }

  const title = proxy ? 'Connection settings' : 'Gateway access'
  const panelId = proxy ? 'connection-settings-panel' : 'gateway-headers-panel'

  const headerCards = rows.map((row, index) => (
    <div key={index} className={styles.card}>
      <div className={styles.cardHeader}>
        <span>Header {index + 1}</span>
        <button
          className={styles.remove}
          type="button"
          aria-label={`Remove header ${index + 1}`}
          title="Remove header"
          onClick={() => onChange(rows.filter((_, i) => i !== index))}
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.fields}>
        <label className={styles.fieldLabel}>
          Name
          <input
            className={styles.input}
            aria-label={`Header ${index + 1} name`}
            placeholder="e.g. P-Access-Token-Id"
            value={row.name}
            onChange={(event) =>
              onChange(
                rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item))
              )
            }
          />
        </label>
        <label className={styles.fieldLabel}>
          Value
          <span className={styles.secretField}>
            <input
              className={styles.secretInput}
              aria-label={`Header ${index + 1} value`}
              placeholder="Enter secret value"
              type={visible[index] ? 'text' : 'password'}
              autoComplete="off"
              value={row.value}
              onChange={(event) =>
                onChange(
                  rows.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item
                  )
                )
              }
            />
            <button
              className={styles.reveal}
              type="button"
              aria-label={`${visible[index] ? 'Hide' : 'Reveal'} secret for header ${index + 1}`}
              title={visible[index] ? 'Hide value' : 'Show value'}
              onClick={() => setVisible({ ...visible, [index]: !visible[index] })}
            >
              {visible[index] ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
      </div>
    </div>
  ))

  const addButton = (
    <button
      className={styles.add}
      type="button"
      onClick={() => onChange([...rows, { name: '', value: '' }])}
    >
      <Plus size={16} /> Add header
    </button>
  )

  return (
    <section
      className={`${styles.section} ${nudge ? styles.nudged : ''}`}
      aria-label={title}
      data-component="connection-settings"
      data-nudge={nudge ?? undefined}
    >
      <button
        className={styles.toggle}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.iconBox}>
          <KeyRound size={18} strokeWidth={1.8} />
        </span>
        <span className={styles.toggleCopy}>
          <span className={styles.title}>{title}</span>
          <span className={`${styles.subtitle} ${nudge ? styles.subtitleNudge : ''}`}>
            {subtitle}
          </span>
        </span>
        <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} size={18} />
      </button>
      {proxy ? (
        // Kept mounted while collapsed so the proxy input still posts with the form.
        <div className={styles.settingsPanel} id={panelId} hidden={!open}>
          <div className={styles.group}>
            <label className={styles.groupLabel} htmlFor="proxyUrl">
              Proxy URL
            </label>
            <input
              ref={proxyInputRef}
              id="proxyUrl"
              name="proxyUrl"
              className={`${styles.input} ${styles.groupInput} ${
                nudge === 'proxy' ? styles.inputNudge : ''
              }`}
              placeholder={proxy.placeholder}
              value={proxy.value}
              onChange={(event) => proxy.onChange(event.target.value)}
            />
            <div className={styles.groupHint}>
              Credentials and calendar data pass through this server. Only use a proxy you trust.{' '}
              <a
                href={`https://github.com/${config.githubRepo}/blob/main/docs/CORS_PROXY.md`}
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </a>
            </div>
          </div>
          <div className={styles.group} ref={headersRef}>
            <span className={styles.groupLabel}>Custom headers</span>
            <div className={styles.groupHint}>For servers behind an auth gateway</div>
            {headerCards}
            {addButton}
          </div>
        </div>
      ) : (
        open && (
          <div className={styles.panel} id={panelId}>
            {headerCards}
            {addButton}
          </div>
        )
      )}
    </section>
  )
}
