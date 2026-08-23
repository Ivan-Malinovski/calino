import type { JSX } from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import imageCompression from 'browser-image-compression'
import type { Contact, ContactEmail, ContactPhone, ContactAddress, ContactUrl } from '../types'
import { ContactPicker, MemberName } from './ContactPicker'
import { normalizeContactRef } from '../lib/contactRefs'
import styles from '@/features/calendar/components/EventModal.module.css'

interface ContactFormFieldsProps {
  value: Partial<Contact>
  onChange: (contact: Partial<Contact>) => void
}

export function ContactFormFields({ value, onChange }: ContactFormFieldsProps): JSX.Element {
  const { t } = useTranslation(['contacts', 'common'])
  // Local partial state derived from props
  const [local, setLocal] = useState<Partial<Contact>>(value)
  const valueRef = useRef(value)
  // Mirrors `local` so `update` can compute the next state without a state updater
  const localRef = useRef(local)
  useEffect(() => {
    localRef.current = local
  }, [local])

  // Reset local state when value prop changes (e.g. when modal opens with a different contact)
  // Use ref to avoid re-triggering on every parent render
  useEffect(() => {
    if (value !== valueRef.current) {
      valueRef.current = value
      setLocal(value)
    }
  }, [value])

  const update = useCallback(
    (partial: Partial<Contact>) => {
      // Compute the next value outside of setLocal: React runs a state updater during the
      // render phase, so calling the parent's onChange from inside one triggers
      // "Cannot update a component while rendering a different component".
      const next = { ...localRef.current, ...partial }
      localRef.current = next
      setLocal(next)
      onChange(next)
    },
    [onChange]
  )

  // -------------------------------------------------------------------------
  // Name block
  // -------------------------------------------------------------------------
  const [showMoreNames, setShowMoreNames] = useState(false)

  // -------------------------------------------------------------------------
  // Email helpers
  // -------------------------------------------------------------------------
  const addEmail = useCallback(() => {
    const emails = [...(local.emails || []), { value: '', type: 'home' as const, isPrimary: false }]
    update({ emails })
  }, [local.emails, update])

  const removeEmail = useCallback(
    (index: number) => {
      const emails = (local.emails || []).filter((_, i) => i !== index)
      update({ emails })
    },
    [local.emails, update]
  )

  const updateEmail = useCallback(
    (index: number, field: keyof ContactEmail, fieldValue: string | boolean) => {
      const emails = (local.emails || []).map((e, i) =>
        i === index ? { ...e, [field]: fieldValue } : e
      )
      update({ emails })
    },
    [local.emails, update]
  )

  // -------------------------------------------------------------------------
  // Phone helpers
  // -------------------------------------------------------------------------
  const addPhone = useCallback(() => {
    const phones = [...(local.phones || []), { value: '', type: 'home' as const, isPrimary: false }]
    update({ phones })
  }, [local.phones, update])

  const removePhone = useCallback(
    (index: number) => {
      const phones = (local.phones || []).filter((_, i) => i !== index)
      update({ phones })
    },
    [local.phones, update]
  )

  const updatePhone = useCallback(
    (index: number, field: keyof ContactPhone, fieldValue: string | boolean) => {
      const phones = (local.phones || []).map((p, i) =>
        i === index ? { ...p, [field]: fieldValue } : p
      )
      update({ phones })
    },
    [local.phones, update]
  )

  // -------------------------------------------------------------------------
  // Address helpers
  // -------------------------------------------------------------------------
  const addAddress = useCallback(() => {
    const addresses: ContactAddress[] = [
      ...(local.addresses || []),
      {
        type: 'home',
        isPrimary: false,
        poBox: '',
        extended: '',
        street: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    ]
    update({ addresses })
  }, [local.addresses, update])

  const removeAddress = useCallback(
    (index: number) => {
      const addresses = (local.addresses || []).filter((_, i) => i !== index)
      update({ addresses })
    },
    [local.addresses, update]
  )

  const updateAddress = useCallback(
    (index: number, field: keyof ContactAddress, fieldValue: string | boolean) => {
      const addresses = (local.addresses || []).map((a, i) =>
        i === index ? { ...a, [field]: fieldValue } : a
      )
      update({ addresses })
    },
    [local.addresses, update]
  )

  // -------------------------------------------------------------------------
  // URL helpers
  // -------------------------------------------------------------------------
  const addUrl = useCallback(() => {
    const urls = [...(local.urls || []), { value: '', type: 'home' as const, isPrimary: false }]
    update({ urls })
  }, [local.urls, update])

  const removeUrl = useCallback(
    (index: number) => {
      const urls = (local.urls || []).filter((_, i) => i !== index)
      update({ urls })
    },
    [local.urls, update]
  )

  const updateUrl = useCallback(
    (index: number, field: keyof ContactUrl, fieldValue: string | boolean) => {
      const urls = (local.urls || []).map((u, i) =>
        i === index ? { ...u, [field]: fieldValue } : u
      )
      update({ urls })
    },
    [local.urls, update]
  )

  // -------------------------------------------------------------------------
  // LANG helpers
  // -------------------------------------------------------------------------
  const addLang = useCallback(() => {
    const langs = [...(local.langs || []), { value: '', type: 'home' as const, isPrimary: false }]
    update({ langs })
  }, [local.langs, update])

  const removeLang = useCallback(
    (index: number) => {
      const langs = (local.langs || []).filter((_, i) => i !== index)
      update({ langs })
    },
    [local.langs, update]
  )

  const updateLang = useCallback(
    (index: number, field: string, value: string | boolean) => {
      const langs = (local.langs || []).map((l, i) => (i === index ? { ...l, [field]: value } : l))
      update({ langs })
    },
    [local.langs, update]
  )

  // -------------------------------------------------------------------------
  // RELATED helpers
  // -------------------------------------------------------------------------
  const addRelated = useCallback(() => {
    const related = [
      ...(local.related || []),
      { value: '', type: 'other' as const, isPrimary: false },
    ]
    update({ related })
  }, [local.related, update])

  const removeRelated = useCallback(
    (index: number) => {
      const related = (local.related || []).filter((_, i) => i !== index)
      update({ related })
    },
    [local.related, update]
  )

  const updateRelated = useCallback(
    (index: number, field: string, value: string | boolean) => {
      const related = (local.related || []).map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      )
      update({ related })
    },
    [local.related, update]
  )

  // --------------------------------------------------------------------------
  // Photo upload
  // --------------------------------------------------------------------------
  const [photoUploading, setPhotoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setPhotoUploading(true)
      try {
        // Compress and resize to max 300×300, JPEG quality 0.8
        const compressed = await imageCompression(file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 300,
          useWebWorker: true,
          initialQuality: 0.8,
          fileType: 'image/jpeg',
        })
        const dataUri = await imageCompression.getDataUrlFromFile(compressed)
        update({ photo: dataUri })
      } catch (err) {
        console.error('Failed to process photo:', err)
      } finally {
        setPhotoUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [update]
  )

  const handlePhotoRemove = useCallback(() => {
    update({ photo: null })
  }, [update])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className={styles.modalBody}>
      {/* ---- Photo ---- */}
      <div className={styles.modalField} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--radius-full)',
            border: '2px dashed var(--color-border-visible, rgba(0,0,0,0.12))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            overflow: 'hidden',
            flexShrink: 0,
            background: local.photo ? 'none' : 'var(--color-bg-tertiary)',
            transition: 'border-color 0.2s',
          }}
          title={t('form.clickToUploadPhoto')}
        >
          {local.photo ? (
            <img
              src={local.photo}
              alt={t('form.contactPhoto')}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoUpload}
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {photoUploading ? (
            t('form.processing')
          ) : local.photo ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                {t('form.changePhoto')}
              </button>
              {' · '}
              <button
                type="button"
                onClick={handlePhotoRemove}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                {t('common:actions.remove')}
              </button>
            </>
          ) : (
            t('form.clickToUploadAPhoto')
          )}
        </div>
      </div>

      {/* ---- Name block ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.name')}</label>
        <div className={styles.row}>
          <input
            type="text"
            placeholder={t('form.givenName')}
            value={local.givenName || ''}
            onChange={(e) => update({ givenName: e.target.value })}
            className={styles.input}
            style={{ flex: 1 }}
          />
          <input
            type="text"
            placeholder={t('form.familyName')}
            value={local.familyName || ''}
            onChange={(e) => update({ familyName: e.target.value })}
            className={styles.input}
            style={{ flex: 1 }}
          />
        </div>
        <button
          type="button"
          className={styles.moreToggle}
          onClick={() => setShowMoreNames((v) => !v)}
        >
          {showMoreNames ? t('form.less') : t('form.moreNameOptions')}
        </button>
        {showMoreNames && (
          <div className={`${styles.moreOptionsWrapper} ${styles.moreOptionsOpen}`}>
            <div className={styles.moreOptionsSection}>
              <input
                type="text"
                placeholder={t('form.additionalNames')}
                value={local.additionalNames || ''}
                onChange={(e) => update({ additionalNames: e.target.value })}
                className={styles.input}
              />
              <div className={styles.row}>
                <input
                  type="text"
                  placeholder={t('form.prefixPlaceholder')}
                  value={local.prefixes || ''}
                  onChange={(e) => update({ prefixes: e.target.value })}
                  className={styles.input}
                  style={{ flex: 1 }}
                />
                <input
                  type="text"
                  placeholder={t('form.suffixPlaceholder')}
                  value={local.suffixes || ''}
                  onChange={(e) => update({ suffixes: e.target.value })}
                  className={styles.input}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- Nickname ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.nickname')}</label>
        <input
          type="text"
          placeholder={t('form.nickname')}
          value={local.nickname || ''}
          onChange={(e) => update({ nickname: e.target.value })}
          className={styles.input}
        />
      </div>

      {/* ---- Organization block ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.organization')}</label>
        <div className={styles.row}>
          <input
            type="text"
            placeholder={t('form.organization')}
            value={local.organization || ''}
            onChange={(e) => update({ organization: e.target.value })}
            className={styles.input}
            style={{ flex: 1.5 }}
          />
          <input
            type="text"
            placeholder={t('form.department')}
            value={local.department || ''}
            onChange={(e) => update({ department: e.target.value })}
            className={styles.input}
            style={{ flex: 1 }}
          />
        </div>
        <input
          type="text"
          placeholder={t('form.roleTitle')}
          value={local.role || ''}
          onChange={(e) => update({ role: e.target.value })}
          className={styles.input}
          style={{ marginTop: 6 }}
        />
      </div>

      {/* ---- Categories / Tags ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.tags')}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {(local.categories || []).map((cat, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--color-border-visible, rgba(0,0,0,0.08))',
                background: 'var(--color-accent-light, rgba(176,125,79,0.08))',
                color: 'var(--accent, #b07d4f)',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              {cat}
              <button
                type="button"
                onClick={() => {
                  const categories = (local.categories || []).filter((_, idx) => idx !== i)
                  update({ categories })
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                  opacity: 0.7,
                }}
                aria-label={t('form.removeTag', { tag: cat })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          placeholder={t('form.addTagPlaceholder')}
          className={styles.input}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const input = e.target as HTMLInputElement
              const newTag = input.value.trim()
              if (newTag && !(local.categories || []).includes(newTag)) {
                update({ categories: [...(local.categories || []), newTag] })
              }
              input.value = ''
            }
          }}
        />
      </div>

      {/* ---- Emails ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.emails')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(local.emails || []).map((email, i) => (
            <div key={i} className={styles.modalFieldRow}>
              <select
                value={email.type}
                onChange={(e) => updateEmail(i, 'type', e.target.value as ContactEmail['type'])}
                className={styles.input}
                style={{ flex: 0, minWidth: 100 }}
              >
                <option value="home">{t('detail.type.home')}</option>
                <option value="work">{t('detail.type.work')}</option>
                <option value="other">{t('detail.type.other')}</option>
                <option value="pref">{t('detail.type.preferred')}</option>
              </select>
              <input
                type="email"
                placeholder={t('form.emailAddress')}
                value={email.value}
                onChange={(e) => updateEmail(i, 'value', e.target.value)}
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className={styles.removeFieldButton}
                onClick={() => removeEmail(i)}
                aria-label={t('form.removeEmail')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addEmail}>
            {t('form.addEmail')}
          </button>
        </div>
      </div>

      {/* ---- Phones ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.phones')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(local.phones || []).map((phone, i) => (
            <div key={i} className={styles.modalFieldRow}>
              <select
                value={phone.type}
                onChange={(e) => updatePhone(i, 'type', e.target.value as ContactPhone['type'])}
                className={styles.input}
                style={{ flex: 0, minWidth: 100 }}
              >
                <option value="home">{t('detail.type.home')}</option>
                <option value="work">{t('detail.type.work')}</option>
                <option value="cell">{t('detail.type.mobile')}</option>
                <option value="fax">{t('detail.type.fax')}</option>
                <option value="other">{t('detail.type.other')}</option>
                <option value="pref">{t('detail.type.preferred')}</option>
              </select>
              <input
                type="tel"
                placeholder={t('form.phoneNumber')}
                value={phone.value}
                onChange={(e) => updatePhone(i, 'value', e.target.value)}
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className={styles.removeFieldButton}
                onClick={() => removePhone(i)}
                aria-label={t('form.removePhone')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addPhone}>
            {t('form.addPhone')}
          </button>
        </div>
      </div>

      {/* ---- Addresses ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.addresses')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(local.addresses || []).map((addr, i) => (
            <div
              key={i}
              style={{
                background: 'var(--color-bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                padding: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <select
                  value={addr.type}
                  onChange={(e) =>
                    updateAddress(i, 'type', e.target.value as ContactAddress['type'])
                  }
                  className={styles.input}
                  style={{ flex: 0, minWidth: 100 }}
                >
                  <option value="home">{t('detail.type.home')}</option>
                  <option value="work">{t('detail.type.work')}</option>
                  <option value="other">{t('detail.type.other')}</option>
                  <option value="pref">{t('detail.type.preferred')}</option>
                </select>
                <button
                  type="button"
                  className={styles.removeFieldButton}
                  onClick={() => removeAddress(i)}
                  aria-label={t('form.removeAddress')}
                >
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  placeholder={t('form.streetAddress')}
                  value={addr.street}
                  onChange={(e) => updateAddress(i, 'street', e.target.value)}
                  className={styles.input}
                />
                <div className={styles.row}>
                  <input
                    type="text"
                    placeholder={t('form.cityRegion')}
                    value={addr.city}
                    onChange={(e) => updateAddress(i, 'city', e.target.value)}
                    className={styles.input}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    placeholder={t('form.postalCode')}
                    value={addr.postalCode}
                    onChange={(e) => updateAddress(i, 'postalCode', e.target.value)}
                    className={styles.input}
                    style={{ flex: 1 }}
                  />
                </div>
                <div className={styles.row}>
                  <input
                    type="text"
                    placeholder={t('form.country')}
                    value={addr.country}
                    onChange={(e) => updateAddress(i, 'country', e.target.value)}
                    className={styles.input}
                    style={{ flex: 1 }}
                  />
                  <div style={{ flex: 1 }} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addAddress}>
            {t('form.addAddress')}
          </button>
        </div>
      </div>

      {/* ---- URLs ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.urls')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(local.urls || []).map((url, i) => (
            <div key={i} className={styles.modalFieldRow}>
              <select
                value={url.type}
                onChange={(e) => updateUrl(i, 'type', e.target.value as ContactUrl['type'])}
                className={styles.input}
                style={{ flex: 0, minWidth: 100 }}
              >
                <option value="home">{t('detail.type.home')}</option>
                <option value="work">{t('detail.type.work')}</option>
                <option value="other">{t('detail.type.other')}</option>
                <option value="pref">{t('detail.type.preferred')}</option>
              </select>
              <input
                type="url"
                placeholder="https://"
                value={url.value}
                onChange={(e) => updateUrl(i, 'value', e.target.value)}
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className={styles.removeFieldButton}
                onClick={() => removeUrl(i)}
                aria-label={t('form.removeUrl')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addUrl}>
            {t('form.addUrl')}
          </button>
        </div>
      </div>

      {/* ---- Birthday ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('detail.field.birthday')}</label>
        <input
          type="date"
          value={local.birthday || ''}
          onChange={(e) => update({ birthday: e.target.value || null })}
          className={styles.input}
        />
      </div>

      {/* ---- Anniversary ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('detail.field.anniversary')}</label>
        <input
          type="date"
          value={local.anniversary || ''}
          onChange={(e) => update({ anniversary: e.target.value || null })}
          className={styles.input}
        />
      </div>

      {/* ---- Note ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>
          <Trans i18nKey="contacts:form.noteLabel" components={{ strong: <strong /> }} />
        </label>
        <textarea
          placeholder={t('form.notePlaceholder')}
          value={local.note || ''}
          onChange={(e) => update({ note: e.target.value })}
          className={`${styles.input} ${styles.modalTextarea}`}
          rows={6}
          style={{ fontFamily: 'monospace', fontSize: '13px' }}
        />
      </div>

      {/* ---- Languages ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('detail.field.language_other')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(local.langs || []).map((lang, i) => (
            <div key={i} className={styles.modalFieldRow}>
              <select
                value={lang.type}
                onChange={(e) => updateLang(i, 'type', e.target.value)}
                className={styles.input}
                style={{ flex: 0, minWidth: 100 }}
              >
                <option value="home">{t('detail.type.home')}</option>
                <option value="work">{t('detail.type.work')}</option>
                <option value="other">{t('detail.type.other')}</option>
                <option value="pref">{t('detail.type.preferred')}</option>
              </select>
              <input
                type="text"
                placeholder={t('form.languageCodePlaceholder')}
                value={lang.value}
                onChange={(e) => updateLang(i, 'value', e.target.value)}
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className={styles.removeFieldButton}
                onClick={() => removeLang(i)}
                aria-label={t('form.removeLanguage')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addLang}>
            {t('form.addLanguage')}
          </button>
        </div>
      </div>

      {/* ---- Related Contacts ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.relatedContacts')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(local.related || []).map((rel, i) => (
            <div key={i} className={styles.modalFieldRow}>
              <select
                value={rel.type}
                onChange={(e) => updateRelated(i, 'type', e.target.value)}
                className={styles.input}
                style={{ flex: 0, minWidth: 110 }}
              >
                <option value="friend">{t('detail.relatedType.friend')}</option>
                <option value="co-worker">{t('detail.relatedType.coworker')}</option>
                <option value="family">{t('detail.relatedType.family')}</option>
                <option value="child">{t('detail.relatedType.child')}</option>
                <option value="spouse">{t('detail.relatedType.spouse')}</option>
                <option value="agent">{t('detail.relatedType.agent')}</option>
                <option value="emergency">{t('detail.relatedType.emergency')}</option>
                <option value="other">{t('detail.type.other')}</option>
              </select>
              <ContactPicker
                value={rel.value}
                onChange={(v) => updateRelated(i, 'value', v)}
                excludeIds={local.id ? [local.id] : []}
                allowFreeText
                placeholder={t('form.searchContactsOrTypeName')}
                data-component="related-contact-picker"
              />
              <button
                type="button"
                className={styles.removeFieldButton}
                onClick={() => removeRelated(i)}
                aria-label={t('form.removeRelatedContact')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className={styles.modalAddDesc} onClick={addRelated}>
            {t('form.addRelatedContact')}
          </button>
        </div>
      </div>

      {/* ---- Group toggle ---- */}
      <div className={styles.modalField}>
        <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={local.isGroup || false}
            onChange={(e) => update({ isGroup: e.target.checked })}
          />
          {t('form.thisIsAGroup')}
        </label>
      </div>

      {/* ---- Group Members ---- */}
      {local.isGroup && (
        <div className={styles.modalField}>
          <label className={styles.label}>{t('detail.field.members')}</label>
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: 8,
            }}
          >
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 8 }}>
              {t('form.selectContactsToAddAsMembers')}
            </div>
            {(local.memberUids || []).length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {(local.memberUids || []).map((uid) => (
                  <div
                    key={uid}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                  >
                    <MemberName uid={uid} />
                    <button
                      type="button"
                      className={styles.removeFieldButton}
                      onClick={() => {
                        const memberUids = (local.memberUids || []).filter((u) => u !== uid)
                        update({ memberUids })
                      }}
                      aria-label={t('form.removeMember')}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/*
              Picker-only: unlike RELATED, a MEMBER that doesn't reference a real
              contact is meaningless, so free text isn't accepted here. Selecting
              a contact appends it and resets the picker via the bumped key.
            */}
            <ContactPicker
              key={`member-picker-${(local.memberUids || []).length}`}
              value=""
              onChange={(v) => {
                if (!v) return
                const memberUids = local.memberUids || []
                if (!memberUids.includes(v)) update({ memberUids: [...memberUids, v] })
              }}
              excludeIds={[
                ...(local.id ? [local.id] : []),
                ...(local.memberUids || []).map(normalizeContactRef),
              ]}
              placeholder={t('form.addAMember')}
              data-component="member-contact-picker"
            />
          </div>
        </div>
      )}

      {/* ---- Extended Data (XML) ---- */}
      <div className={styles.modalField}>
        <label className={styles.label}>{t('form.extendedDataXml')}</label>
        <textarea
          placeholder={t('form.xmlDataPlaceholder')}
          value={local.xmlData || ''}
          onChange={(e) => update({ xmlData: e.target.value || null })}
          className={`${styles.input} ${styles.modalTextarea}`}
          rows={4}
          style={{ fontFamily: 'monospace', fontSize: '12px' }}
        />
      </div>
    </div>
  )
}
