import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { QUICK_START_USERNAME } from '@/lib/configLoader'
import { useConfigStore } from '@/store/configStore'
import styles from './MasterPasswordPrompt.module.css'

export function HostedConfigSignIn() {
  const runtimeSignIn = useConfigStore((state) => state.runtimeSignIn)
  const perUser = useConfigStore((state) => state.perUser)
  const quickStart = useConfigStore((state) => state.quickStart)
  const { pathname } = useLocation()
  if (runtimeSignIn !== 'required' || pathname === '/setup') return null
  return <SignInForm perUser={perUser} quickStart={quickStart} />
}

function SignInForm({ perUser, quickStart }: { perUser: boolean; quickStart: boolean }) {
  const { t } = useTranslation('settings', { keyPrefix: 'hostedConfigSignIn' })
  const signIn = useConfigStore((state) => state.signIn)
  const setOpen = useConfigStore((state) => state.setRuntimeSignInOpen)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<
    'unauthorized' | 'unavailable' | 'insecure' | 'otherProfile' | null
  >(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const secure = window.isSecureContext

  useFocusTrap(dialogRef, true)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending || !secure) return
    const fields = new FormData(event.currentTarget)
    const username = quickStart ? QUICK_START_USERNAME : String(fields.get('username') ?? '')
    const password = String(fields.get('password') ?? '')
    if (!username || !password) return

    setPending(true)
    setError(null)
    const result = await signIn(username, password)
    if (result === 'ok') return
    if (passwordRef.current) passwordRef.current.value = ''
    setError(result)
    setPending(false)
  }

  return (
    <div
      className={styles.overlay}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hosted-config-sign-in-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending && !perUser) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <form className={styles.modal} onSubmit={submit} aria-busy={pending}>
        <div className={styles.header}>
          <h2 className={styles.title} id="hosted-config-sign-in-title">
            {t('title')}
          </h2>
          <p className={styles.subtitle}>{t(secure ? 'description' : 'insecure')}</p>
        </div>

        {secure && (
          <>
            {!quickStart && (
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="hosted-config-username">
                  {t('username')}
                </label>
                <input
                  className={styles.input}
                  id="hosted-config-username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  readOnly={pending}
                  required
                />
              </div>
            )}
            <div className={styles.inputGroup}>
              <label className={styles.label} htmlFor="hosted-config-password">
                {t('password')}
              </label>
              <input
                ref={passwordRef}
                className={styles.input}
                id="hosted-config-password"
                name="password"
                type="password"
                autoComplete="current-password"
                readOnly={pending}
                required
              />
              {error && (
                <div className={styles.errorText} role="alert">
                  {t(error)}
                </div>
              )}
            </div>
          </>
        )}

        <div className={styles.actions}>
          {!perUser && (
            <button
              type="button"
              className={`${styles.button} ${styles.cancel}`}
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t('skip')}
            </button>
          )}
          {secure && (
            <button
              type="submit"
              className={`${styles.button} ${styles.submit}`}
              disabled={pending}
            >
              {t(pending ? 'signingIn' : 'signIn')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
