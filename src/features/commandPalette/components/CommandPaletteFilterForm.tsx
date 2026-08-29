import { useState, type JSX, type KeyboardEvent } from 'react'
import type { CommandPaletteFilter } from '../lib/eventFilters'
import { parseFilterTokens } from '../lib/eventFilters'
import styles from './CommandPalette.module.css'

const FILTER_ERROR_ID = 'command-palette-filter-error'

interface CommandPaletteFilterFormProps {
  filter: CommandPaletteFilter
  setIncludedTerms: (terms: string[]) => void
  setLocation: (location: string) => void
  setExcludedKeywords: (keywords: string[]) => void
  setFromDate: (date: string) => void
  setToDate: (date: string) => void
  onReset: () => void
  invalidDateRange: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

interface TokenInputProps {
  label: string
  placeholder: string
  tokens: string[]
  setTokens: (tokens: string[]) => void
  removeLabel: (token: string) => string
  id: string
  autoFocus?: boolean
}

function mergeTokens(tokens: string[], value: string): string[] {
  return mergeParsedTokens(tokens, parseFilterTokens(value))
}

function mergeParsedTokens(tokens: string[], additions: string[]): string[] {
  const merged = [...tokens]
  const seen = new Set(tokens.map((token) => token.toLocaleLowerCase()))
  for (const token of additions) {
    const key = token.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(token)
  }
  return merged
}

/** Split on commas outside quoted or escaped text, preserving the syntax. */
function splitDraftOnCommas(value: string): string[] {
  const parts: string[] = []
  let part = ''
  let quote: string | undefined
  let escaped = false

  for (const character of value) {
    if (escaped) {
      part += character
      escaped = false
      continue
    }
    if (character === '\\') {
      part += character
      escaped = true
      continue
    }
    if (quote) {
      part += character
      if (character === quote) quote = undefined
      continue
    }
    if ((character === '"' || character === "'") && part.trim() === '') {
      part += character
      quote = character
    } else if (character === '"' || character === "'") {
      part += character
    } else if (character === ',') {
      parts.push(part)
      part = ''
    } else {
      part += character
    }
  }
  parts.push(part)
  return parts
}

/**
 * The filter controls deliberately live outside cmdk's input. Comma/Enter
 * tokenization is useful here, but Enter must never select the first palette
 * result while a user is editing a token.
 */
function TokenInput({
  label,
  placeholder,
  tokens,
  setTokens,
  removeLabel,
  id,
  autoFocus = false,
}: TokenInputProps): JSX.Element {
  const [draft, setDraft] = useState('')

  const addDraft = (): void => {
    if (draft.trim()) setTokens(mergeTokens(tokens, draft))
    setDraft('')
  }

  const removeToken = (token: string): void => {
    // Include any text still being edited before removing the chip. This also
    // handles keyboard activation, where the input may blur before onClick and
    // React can otherwise run the click handler with the old token list.
    const nextTokens = mergeTokens(tokens, draft)
    setTokens(nextTokens.filter((candidate) => candidate !== token))
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addDraft()
    } else if (event.key === 'Backspace' && !draft && tokens.length > 0) {
      event.preventDefault()
      setTokens(tokens.slice(0, -1))
    }
  }

  return (
    <div className={styles.filterField}>
      <label className={styles.filterLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.tokenInput}>
        {tokens.map((token) => (
          <span className={styles.filterChip} key={token} data-component="command-palette-chip">
            <span>{token}</span>
            <button
              type="button"
              className={styles.filterChipRemove}
              aria-label={removeLabel(token)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => removeToken(token)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className={styles.tokenInputField}
          value={draft}
          placeholder={tokens.length > 0 ? '' : placeholder}
          onChange={(event) => {
            const value = event.target.value
            const parts = splitDraftOnCommas(value)
            if (parts.length > 1) {
              setTokens(
                mergeParsedTokens(
                  tokens,
                  parts.slice(0, -1).flatMap((part) => parseFilterTokens(part))
                )
              )
              setDraft(parts.at(-1) ?? '')
            } else {
              setDraft(value)
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={addDraft}
          autoFocus={autoFocus}
          autoComplete="off"
        />
      </div>
    </div>
  )
}

export function CommandPaletteFilterForm({
  filter,
  setIncludedTerms,
  setLocation,
  setExcludedKeywords,
  setFromDate,
  setToDate,
  onReset,
  invalidDateRange,
  t,
}: CommandPaletteFilterFormProps): JSX.Element {
  const [resetVersion, setResetVersion] = useState(0)

  const handleReset = (): void => {
    setResetVersion((version) => version + 1)
    onReset()
  }

  return (
    <section
      className={styles.filterForm}
      data-component="command-palette-filters"
      aria-labelledby="command-palette-filter-title"
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.stopPropagation()
      }}
    >
      <div className={styles.filterHeading}>
        <div>
          <h2 id="command-palette-filter-title" className={styles.filterTitle}>
            {t('palette.filter.title')}
          </h2>
          <p className={styles.filterHelp}>{t('palette.filter.help')}</p>
        </div>
        <button type="button" className={styles.resetButton} onClick={handleReset}>
          {t('palette.filter.reset')}
        </button>
      </div>

      <TokenInput
        key={`include-${resetVersion}`}
        id="command-palette-include"
        label={t('palette.filter.includeLabel')}
        placeholder={t('palette.filter.includePlaceholder')}
        tokens={filter.terms}
        setTokens={setIncludedTerms}
        removeLabel={(term) => t('palette.filter.removeTerm', { term })}
        autoFocus
      />

      <div className={styles.filterGrid}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="command-palette-location">
            {t('palette.filter.locationLabel')}
          </label>
          <input
            id="command-palette-location"
            className={styles.filterTextInput}
            value={filter.location}
            placeholder={t('palette.filter.locationPlaceholder')}
            onChange={(event) => setLocation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
        </div>

        <TokenInput
          key={`exclude-${resetVersion}`}
          id="command-palette-exclude"
          label={t('palette.filter.excludeLabel')}
          placeholder={t('palette.filter.excludePlaceholder')}
          tokens={filter.excludedKeywords}
          setTokens={setExcludedKeywords}
          removeLabel={(term) => t('palette.filter.removeExcludedKeyword', { term })}
        />
      </div>

      <div className={styles.filterDates}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="command-palette-from">
            {t('palette.filter.fromLabel')}
          </label>
          <input
            id="command-palette-from"
            className={`${styles.filterTextInput} ${invalidDateRange ? styles.invalidInput : ''}`}
            type="date"
            value={filter.fromDate ?? ''}
            onChange={(event) => setFromDate(event.target.value)}
            aria-invalid={invalidDateRange}
            aria-describedby={invalidDateRange ? FILTER_ERROR_ID : undefined}
          />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="command-palette-to">
            {t('palette.filter.toLabel')}
          </label>
          <input
            id="command-palette-to"
            className={`${styles.filterTextInput} ${invalidDateRange ? styles.invalidInput : ''}`}
            type="date"
            value={filter.toDate ?? ''}
            onChange={(event) => setToDate(event.target.value)}
            aria-invalid={invalidDateRange}
            aria-describedby={invalidDateRange ? FILTER_ERROR_ID : undefined}
          />
        </div>
      </div>

      {invalidDateRange && (
        <p id={FILTER_ERROR_ID} className={styles.filterError} role="alert">
          {t('palette.filter.invalidDateRange')}
        </p>
      )}

    </section>
  )
}
