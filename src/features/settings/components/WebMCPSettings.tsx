import { useTranslation } from 'react-i18next'
import { useWebMCPSettings } from '@/features/webmcp/settings'
import { getModelContext } from '@/features/webmcp/useWebMCP'
import styles from './Settings.module.css'

export function WebMCPSettings(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const enabled = useWebMCPSettings((state) => state.enabled)
  const setEnabled = useWebMCPSettings((state) => state.setEnabled)
  return (
    <div className={styles.group}>
      <div
        className={styles.row}
        data-component="setting-row"
        data-setting="webmcp"
        data-value={String(enabled)}
      >
        <div className={styles.rowInfo}>
          <div className={styles.rowLabel}>{t('data.webmcp.label')}</div>
          <div className={styles.rowDesc}>{t('data.webmcp.desc')}</div>
          {!getModelContext() && (
            <div className={styles.rowDesc}>{t('data.webmcp.unavailable')}</div>
          )}
        </div>
        <div className={styles.rowControl}>
          <label className={styles.toggle} data-component="toggle" data-setting="webmcp">
            <input
              type="checkbox"
              aria-label={t('data.webmcp.label')}
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span className={styles.pill} />
            <span className={styles.knob} />
          </label>
        </div>
      </div>
    </div>
  )
}
