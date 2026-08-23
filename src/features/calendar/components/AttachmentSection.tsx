import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarAttachment } from '@/types'
import { putAttachments, deleteAttachments } from '@/lib/attachmentStore'
import { showToast } from '@/lib/toast'
import styles from './EventModal.module.css'

const MAX_ATTACHMENT_SIZE_MB = 5
const MAX_ATTACHMENT_SIZE_BYTES = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024
const MAX_ATTACHMENT_HARD_LIMIT_MB = 25
const MAX_ATTACHMENT_HARD_LIMIT_BYTES = MAX_ATTACHMENT_HARD_LIMIT_MB * 1024 * 1024

interface AttachmentSectionProps {
  attachments: CalendarAttachment[]
  onAttachmentsChange: (attachments: CalendarAttachment[]) => void
  eventId: string | null
  showLabel?: boolean
  compact?: boolean
}

export function AttachmentSection({
  attachments,
  onAttachmentsChange,
  eventId,
  showLabel = true,
  compact = false,
}: AttachmentSectionProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const storageKey = eventId || 'new'

  const handleRemove = (index: number): void => {
    const att = attachments[index]
    if (
      window.confirm(
        `Remove "${att.filename || 'attachment'}" from this event? It will be deleted from the server when you save.`
      )
    ) {
      const remaining = attachments.filter((_, i) => i !== index)
      onAttachmentsChange(remaining)
      if (remaining.length > 0) {
        putAttachments(storageKey, remaining).catch(() => {})
      } else {
        deleteAttachments(storageKey).catch(() => {})
      }
    }
  }

  const handleAdd = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    const filtered = files.filter((file) => {
      if (file.size > MAX_ATTACHMENT_HARD_LIMIT_BYTES) {
        showToast(`File "${file.name}" exceeds the ${MAX_ATTACHMENT_HARD_LIMIT_MB}MB limit`)
        return false
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        showToast(
          `File "${file.name}" is larger than ${MAX_ATTACHMENT_SIZE_MB}MB and may not sync properly`
        )
      }
      return true
    })

    const readPromises = filtered.map(
      (file) =>
        new Promise<CalendarAttachment>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            resolve({
              href: reader.result as string,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              filename: file.name,
            })
          }
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
          reader.readAsDataURL(file)
        })
    )

    Promise.all(readPromises)
      .then((newAttachments) => {
        const all = [...attachments, ...newAttachments]
        onAttachmentsChange(all)
        putAttachments(storageKey, all).catch(() => {
          showToast('Failed to save attachments locally')
        })
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'Failed to read files')
      })

    e.target.value = ''
  }

  return (
    <div className={compact ? styles.attachmentFieldCompact : styles.modalField}>
      {showLabel && (
        <div className={styles.fieldHeader}>
          <label className={styles.label}>{t('surface.attachments')}</label>
          {attachments.length > 0 && (
            <span className={styles.attachmentCount}>{attachments.length}</span>
          )}
        </div>
      )}
      {!compact && attachments.length > 0 && (
        <p className={styles.attachmentSyncNote}>
          Attachments will be synced to the CalDAV server when you save.
        </p>
      )}

      {attachments.length > 0 && (
        <div className={compact ? styles.attachmentListCompact : styles.attachmentList}>
          {attachments.map((att, index) => (
            <div
              key={index}
              className={compact ? styles.attachmentItemCompact : styles.attachmentItem}
            >
              <span className={styles.attachmentIcon}>📎</span>
              <button
                type="button"
                className={styles.attachmentName}
                title={t('surface.clickToDownload')}
                onClick={() => {
                  if (att.href) {
                    const a = document.createElement('a')
                    a.href = att.href
                    a.download = att.filename || 'attachment'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                  } else {
                    showToast('Attachment data not available. Try reopening the event.')
                  }
                }}
              >
                {att.filename || 'attachment'}
              </button>
              {att.size && (
                <span className={styles.attachmentSize}>
                  {att.size > 1024 * 1024
                    ? `${(att.size / (1024 * 1024)).toFixed(1)}MB`
                    : `${Math.round(att.size / 1024)}KB`}
                </span>
              )}
              <button
                type="button"
                className={styles.removeAttachment}
                title={t('surface.removeAttachment')}
                aria-label={t('surface.removeNamedAttachment', { name: att.filename || t('surface.attachment') })}
                onClick={() => handleRemove(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <label className={compact ? styles.addAttachmentButtonCompact : styles.addAttachmentButton}>
        <span>{compact ? '+ Attach' : '+ Add attachment'}</span>
        <input type="file" className={styles.hiddenFileInput} multiple onChange={handleAdd} />
      </label>
    </div>
  )
}
