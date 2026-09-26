import type { JSX } from 'react'
import styles from './Settings.module.css'

interface SettingsPageHeadingProps {
  title: string
  searchControl?: JSX.Element
}

export function SettingsPageHeading({
  title,
  searchControl,
}: SettingsPageHeadingProps): JSX.Element {
  return (
    <div className={styles.pageTitleRow}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {searchControl && <div className={styles.pageTitleSearch}>{searchControl}</div>}
    </div>
  )
}
