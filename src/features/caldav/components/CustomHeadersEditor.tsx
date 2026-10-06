import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export interface ForceCalDAVField {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  hint: string
  /** Subtitle fragment shown while the option is on, e.g. "CalDAV only". */
  summary: string
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
  forceCalDAV,
  open: controlledOpen,
  onOpenChange,
  nudge,
  nudgeLabel,
}: {
  rows: HeaderRow[]
  onChange: (rows: HeaderRow[]) => void
  proxy?: ProxyField
  /** Offer to skip JMAP detection (new accounts only). */
  forceCalDAV?: ForceCalDAVField
  open?: boolean
  onOpenChange?: (open: boolean) => void
  nudge?: ConnectionNudge | null
  /** Subtitle shown while nudged, e.g. "A proxy may fix this". */
  nudgeLabel?: string
}): JSX.Element {
  const { t } = useTranslation('caldav')
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [visible, setVisible] = useState<Record<number, boolean>>({})
  const proxySet = Boolean(proxy?.value.trim())
  const open =
    controlledOpen ?? manualOpen ?? (rows.length > 0 || proxySet || Boolean(forceCalDAV?.checked))
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
  const headerSummary = headerCount ? t('ui.headers.count', { count: headerCount }) : ''

  let subtitle: string
  if (nudge && nudgeLabel) {
    subtitle = nudgeLabel
  } else if (proxy) {
    const parts = [
      forceCalDAV?.checked ? forceCalDAV.summary : '',
      proxySet ? t('ui.headers.proxyOn') : '',
      headerSummary,
    ].filter(Boolean)
    subtitle = parts.length ? parts.join(' · ') : t('ui.headers.optional')
  } else {
    subtitle = headerSummary || t('ui.headers.protectedServers')
  }

  const title = proxy ? t('ui.headers.connectionSettings') : t('ui.headers.gatewayAccess')
  const panelId = proxy ? 'connection-settings-panel' : 'gateway-headers-panel'

  const headerCards = rows.map((row, index) => (
    <div key={index} className={styles.card}>
      <div className={styles.cardHeader}>
        <span>{t('ui.headers.headerN', { n: index + 1 })}</span>
        <button
          className={styles.remove}
          type="button"
          aria-label={t('ui.headers.removeHeaderN', { n: index + 1 })}
          title={t('ui.headers.removeHeader')}
          onClick={() => onChange(rows.filter((_, i) => i !== index))}
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.fields}>
        <label className={styles.fieldLabel}>
          {t('ui.headers.name')}
          <input
            className={styles.input}
            aria-label={t('ui.headers.nameAria', { n: index + 1 })}
            placeholder={t('ui.headers.namePlaceholder')}
            value={row.name}
            onChange={(event) =>
              onChange(
                rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item))
              )
            }
          />
        </label>
        <label className={styles.fieldLabel}>
          {t('ui.headers.value')}
          <span className={styles.secretField}>
            <input
              className={styles.secretInput}
              aria-label={t('ui.headers.valueAria', { n: index + 1 })}
              placeholder={t('ui.headers.valuePlaceholder')}
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
              aria-label={t(visible[index] ? 'ui.headers.hideAria' : 'ui.headers.revealAria', {
                n: index + 1,
              })}
              title={visible[index] ? t('ui.headers.hideValue') : t('ui.headers.showValue')}
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
      <Plus size={16} /> {t('ui.headers.addHeader')}
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
              {t('ui.headers.proxyUrl')}
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
              {t('ui.headers.proxyWarning')}{' '}
              <a
                href={`https://github.com/${config.githubRepo}/blob/main/docs/CORS_PROXY.md`}
                target="_blank"
                rel="noreferrer"
              >
                {t('ui.headers.learnMore')}
              </a>
            </div>
          </div>
          <div className={styles.group} ref={headersRef}>
            <span className={styles.groupLabel}>{t('ui.headers.customHeaders')}</span>
            <div className={styles.groupHint}>{t('ui.headers.gatewayHint')}</div>
            {headerCards}
            {addButton}
          </div>
          {forceCalDAV && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>Protocol</span>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={forceCalDAV.checked}
                  onChange={(event) => forceCalDAV.onChange(event.target.checked)}
                  disabled={forceCalDAV.disabled}
                  data-action="force-caldav"
                />
                <span>{forceCalDAV.label}</span>
              </label>
              <div className={styles.groupHint}>{forceCalDAV.hint}</div>
            </div>
          )}
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
