import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronDown, Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react'
import type { HeaderRow } from './headerRows'
import styles from './CustomHeadersEditor.module.css'

export function CustomHeadersEditor({
  rows,
  onChange,
}: {
  rows: HeaderRow[]
  onChange: (rows: HeaderRow[]) => void
}): JSX.Element {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [visible, setVisible] = useState<Record<number, boolean>>({})
  const open = manualOpen ?? rows.length > 0

  return (
    <section className={styles.section} aria-label="Gateway access">
      <button
        className={styles.toggle}
        type="button"
        aria-expanded={open}
        aria-controls="gateway-headers-panel"
        onClick={() => setManualOpen(!open)}
      >
        <span className={styles.iconBox}>
          <KeyRound size={18} strokeWidth={1.8} />
        </span>
        <span className={styles.toggleCopy}>
          <span className={styles.title}>Gateway access</span>
          <span className={styles.subtitle}>
            {rows.length
              ? `${rows.length} custom ${rows.length === 1 ? 'header' : 'headers'}`
              : 'For protected CalDAV servers'}
          </span>
        </span>
        <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} size={18} />
      </button>
      {open && (
        <div className={styles.panel} id="gateway-headers-panel">
          {rows.map((row, index) => (
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
                        rows.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item
                        )
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
          ))}
          <button
            className={styles.add}
            type="button"
            onClick={() => onChange([...rows, { name: '', value: '' }])}
          >
            <Plus size={16} /> Add header
          </button>
        </div>
      )}
    </section>
  )
}
