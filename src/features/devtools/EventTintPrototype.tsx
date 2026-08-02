/**
 * TEMPORARY — prototype for issue #31 ("On design language").
 *
 * Jan's point is about telling calendars apart at a glance, which is governed by
 * --event-bg-mix (how much of the calendar colour shows through the card) rather
 * than by any text colour. This panel flips between candidate mixes live so the
 * tradeoff can be judged on real data instead of in the abstract.
 *
 * The tradeoff is real: the tint sits *behind* the event's time and location, so
 * every step up costs contrast there. Each preset therefore carries its own
 * --event-ink-* values, chosen so time/location still clear WCAG AA (4.5:1) on
 * the most saturated calendar colour in Google's default palette (Tomato in
 * light, Banana in dark). Numbers shown per preset are that worst case.
 *
 * Delete this directory, its import in App.tsx, and the `devtools` chunk once a
 * mix is chosen — the chosen values go into src/themes/built-in.css.
 */
import { useEffect, useState } from 'react'
import { useTheme } from '../../components/ThemeContext'

type Preset = {
  id: string
  label: string
  note: string
  /** [bg mix, hover mix, event-ink-2, event-ink-3, worst-case ratio] */
  light: [string, string, string, string, number]
  dark: [string, string, string, string, number]
}

const PRESETS: Preset[] = [
  {
    id: 'current',
    label: 'Current',
    note: 'Ships today. Cards read as cream first, colour second.',
    light: ['9%', '12%', '#655f57', '#655f57', 5.07],
    dark: ['18%', '22%', '#b0aaa0', '#b0aaa0', 5.13],
  },
  {
    id: 'nudge',
    label: 'Nudge',
    note: 'Same character, colour a bit more present.',
    light: ['15%', '19%', '#655f57', '#655f57', 4.53],
    dark: ['24%', '29%', '#b7b1a7', '#b7b1a7', 4.74],
  },
  {
    id: 'clear',
    label: 'Clear',
    note: 'Colour is the first thing you see. Secondary ink darkens to keep up.',
    light: ['22%', '27%', '#5c564e', '#5c564e', 4.54],
    dark: ['30%', '36%', '#cac4ba', '#cac4ba', 4.94],
  },
  {
    id: 'bold',
    label: 'Bold',
    note: 'Roughly the Google-like end of the range Jan pointed at.',
    light: ['30%', '35%', '#4c463e', '#4c463e', 5.02],
    dark: ['40%', '46%', '#e4ded4', '#e4ded4', 4.86],
  },
]

const VARS = ['--event-bg-mix', '--event-bg-mix-hover', '--event-ink-2', '--event-ink-3'] as const
const STORAGE_KEY = 'calino:event-tint-prototype'

export function EventTintPrototype() {
  const { effectiveMode } = useTheme()
  const isDark = effectiveMode === 'dark'
  const [activeId, setActiveId] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? 'current',
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const preset = PRESETS.find((p) => p.id === activeId)
    const root = document.documentElement
    // "current" means "whatever the stylesheet says" — clear the overrides
    // rather than re-asserting them, so the panel can't mask a theme change.
    if (!preset || preset.id === 'current') {
      VARS.forEach((v) => root.style.removeProperty(v))
    } else {
      const values = isDark ? preset.dark : preset.light
      VARS.forEach((v, i) => root.style.setProperty(v, values[i] as string))
    }
    localStorage.setItem(STORAGE_KEY, activeId)
    return () => VARS.forEach((v) => root.style.removeProperty(v))
  }, [activeId, isDark])

  // Alt+T cycles presets, so you can flip through them while looking at the
  // grid instead of at this panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setActiveId((id) => {
          const i = PRESETS.findIndex((p) => p.id === id)
          return PRESETS[(i + 1) % PRESETS.length].id
        })
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = PRESETS.find((p) => p.id === activeId) ?? PRESETS[0]
  const worst = (isDark ? active.dark : active.light)[4]

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 99999,
        font: '12px/1.4 var(--font-sans)',
        background: 'var(--panel)',
        color: 'var(--ink)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        width: open ? 260 : 'auto',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          display: 'block',
          width: '100%',
          cursor: 'pointer',
          padding: '8px 12px',
          fontWeight: 600,
          background: 'var(--side)',
        }}
      >
        #31 tint: {active.label} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ padding: 8 }}>
          {PRESETS.map((p) => {
            const on = p.id === activeId
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'block',
                  width: '100%',
                  cursor: 'pointer',
                  padding: '6px 8px',
                  marginBottom: 2,
                  borderRadius: 6,
                  background: on ? 'var(--selected-bg)' : 'transparent',
                  outline: on ? '1px solid var(--accent)' : 'none',
                }}
              >
                <div style={{ fontWeight: on ? 600 : 400 }}>
                  {p.label}{' '}
                  <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                    {(isDark ? p.dark : p.light)[0]}
                  </span>
                </div>
                <div style={{ color: 'var(--ink-2)', fontSize: 11 }}>{p.note}</div>
              </button>
            )
          })}
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--line)',
              color: 'var(--ink-2)',
              fontSize: 11,
            }}
          >
            {isDark ? 'Dark' : 'Light'} · worst-case time/location contrast{' '}
            <strong style={{ color: worst >= 4.5 ? 'var(--ink)' : 'var(--color-error)' }}>
              {worst.toFixed(2)}:1
            </strong>
            {worst < 4.5 && ' — below AA'}
            <br />
            Alt+T cycles.
          </div>
        </div>
      )}
    </div>
  )
}
