import type { JSX } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { config } from '@/config'
import styles from './PrivacyPolicy.module.css'

export function PrivacyPolicy(): JSX.Element {
  const navigate = useNavigate()
  const { t } = useTranslation('settings')

  return (
    <main className={styles.container} id="main-content" tabIndex={-1}>
      <div className={styles.header}>
        <button onClick={() => navigate(-1)} className={styles.backButton}>
          {t('privacy.back')}
        </button>
        <h1>{t('privacy.title')}</h1>
      </div>

      <div className={styles.content}>
        <p className={styles.lastUpdated}>{t('privacy.lastUpdated')}</p>

        <section>
          <h2>{t('privacy.section1.heading')}</h2>
          <p>{t('privacy.section1.body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section2.heading')}</h2>
          <p>
            {t('privacy.section2.intro')}
          </p>
          <ul>
            <li>
              {t('privacy.section2.item1')}
            </li>
            <li>{t('privacy.section2.item2')}</li>
            <li>{t('privacy.section2.item3')}</li>
          </ul>
        </section>

        <section>
          <h2>{t('privacy.section3.heading')}</h2>
          <p>{t('privacy.section3.intro')}</p>
          <p><strong>{t('privacy.section3.hostedProxyLabel')}</strong> {t('privacy.section3.hostedProxyIntro', { proxy: 'proxy.calino.io' })}</p>
          <ul>
            <li>
              {t('privacy.section3.item1')}
            </li>
            <li>
              {t('privacy.section3.item2')}
            </li>
            <li>{t('privacy.section3.item3')}</li>
            <li>{t('privacy.section3.item4')}</li>
          </ul>
          <p>
            <strong>{t('privacy.section3.thirdPartyLabel')}</strong> {t('privacy.section3.thirdPartyBody')}
          </p>
          <p>
            {t('privacy.section3.maxPrivacy')}
          </p>
        </section>

        <section>
          <h2>{t('privacy.section4.heading')}</h2>
          <p>{t('privacy.section4.intro')}</p>
          <ul>
            <li>{t('privacy.section4.item1')}</li>
            <li>{t('privacy.section4.item2')}</li>
          </ul>
          <p>
            {t('privacy.section4.outro')}
          </p>
        </section>

        <section>
          <h2>{t('privacy.section5.heading')}</h2>
          <p>{t('privacy.section5.body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section6.heading')}</h2>
          <p>
            {t('privacy.section6.body')}
            <br />
            <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
          </p>
        </section>
      </div>
    </main>
  )
}
