import type { JSX } from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { isValid } from 'date-fns'
import { formatDisplayDate, formatTime } from '@/lib/datetime'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { useSettingsStore } from '@/store/settingsStore'
import { parseNaturalLanguage, type NLPParseResult } from '../index'
import styles from './QuickAdd.module.css'

export interface QuickAddProps {
  onAdd: (result: NLPParseResult) => void
  onCancel?: () => void
}

export function QuickAdd({ onAdd, onCancel }: QuickAddProps): JSX.Element {
  const { t } = useTranslation(['calendar', 'common'])
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<NLPParseResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const language = useSettingsStore((state) => state.language)

  const parseInput = useCallback((text: string) => {
    if (!text.trim()) {
      setPreview(null)
      return
    }

    const result = parseNaturalLanguage(text)
    setPreview(result)
  }, [])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      parseInput(input)
    }, 150)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [input, parseInput])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (preview) {
        onAdd(preview)
        setInput('')
        setPreview(null)
      }
    },
    [preview, onAdd]
  )

  const handleCancel = useCallback(() => {
    setInput('')
    setPreview(null)
    onCancel?.()
  }, [onCancel])

  const formatDate = (date: Date): string => {
    if (!isValid(date)) return t('modals.quickAdd.invalidDate')
    return formatDisplayDate(date, 'EEEE, MMMM d, yyyy')
  }

  return (
    <form className={styles.container} onSubmit={handleSubmit}>
      <div className={styles.inputWrapper}>
        <Input
          type="text"
          placeholder={
            language === 'en'
              ? t('modals.quickAdd.placeholderNlp')
              : t('modals.quickAdd.placeholderSimple')
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
      </div>

      {preview && (
        <div className={styles.preview}>
          <div className={styles.previewTitle}>{preview.title}</div>
          <div className={styles.previewDetails}>
            <div className={styles.previewRow}>
              <span className={styles.previewLabel}>{t('modals.quickAdd.dateLabel')}</span>
              <span>{formatDate(preview.startDate)}</span>
            </div>
            {!preview.isAllDay && preview.startDate && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>{t('modals.quickAdd.timeLabel')}</span>
                <span>
                  {formatTime(preview.startDate, timeFormat)}
                  {preview.endDate && ` - ${formatTime(preview.endDate, timeFormat)}`}
                </span>
              </div>
            )}
            {preview.isAllDay && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>{t('modals.quickAdd.typeLabel')}</span>
                <span>{t('modals.quickAdd.allDay')}</span>
              </div>
            )}
            {preview.location && (
              <div className={styles.previewRow}>
              <span className={styles.previewLabel}>{t('modals.quickAdd.locationLabel')}</span>
                <span>{preview.location}</span>
              </div>
            )}
            {preview.recurrence && (
              <div className={styles.previewRow}>
              <span className={styles.previewLabel}>{t('modals.quickAdd.repeatsLabel')}</span>
                <span>{preview.recurrence.frequency}</span>
              </div>
            )}
            <div className={styles.confidence}>
              <span>{t('modals.quickAdd.confidence')}</span>
              <div className={styles.confidenceBar}>
                <div
                  className={styles.confidenceFill}
                  style={{ width: `${preview.confidence * 100}%` }}
                />
              </div>
              <span>{Math.round(preview.confidence * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {input && !preview && (
        <div className={styles.preview}>
          <span className={styles.empty}>{t('modals.quickAdd.empty')}</span>
        </div>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={handleCancel}>
            {t('common:actions.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={!preview}>
          {t('modals.quickAdd.addEvent')}
        </Button>
      </div>
    </form>
  )
}
