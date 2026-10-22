import { categoryStyleProps } from '@/lib/categoryStylePresentation'
import { useId, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { DEFAULT_CATEGORY_STYLE_RULES, resolveCategoryAppearance } from '@/lib/categoryStyles'
import {
  CATEGORY_STYLE_TREATMENTS,
  type CategoryStyleFont,
  type CategoryStyleRule,
  type CategoryStyleTreatment,
} from '@/types/categoryStyles'
import { CategoryStyleTitle } from '@/components/common/CategoryEventStyle'
import shared from './Settings.module.css'
import styles from './CategoryStyleSettings.module.css'

const PRESETS: Omit<CategoryStyleRule, 'id'>[] = [
  { categories: 'draft', treatment: 'tentative', font: 'hand', color: '#777985', enabled: true },
  { categories: 'focus', treatment: 'focus', font: 'inherit', color: '#648574', enabled: true },
  { categories: 'travel', treatment: 'travel', font: 'inherit', color: '#607fa3', enabled: true },
  {
    categories: 'deadline',
    treatment: 'deadline',
    font: 'inherit',
    color: '#ac7332',
    enabled: true,
  },
  { categories: 'done', treatment: 'done', font: 'inherit', color: '#777985', enabled: true },
]

function RulePreview({ rule }: { rule: CategoryStyleRule }): JSX.Element {
  const { t } = useTranslation('settings')
  const appearance = resolveCategoryAppearance(
    { categories: rule.categories.split(',').map((c) => c.trim()) },
    [],
    [rule]
  )
  const props = categoryStyleProps(appearance)
  return (
    <div {...props} className={styles.preview} data-component="category-style-preview">
      <span className={styles.previewTime}>10:00 – 11:00</span>
      <CategoryStyleTitle title={t('theme.categoryStyles.sample')} appearance={appearance} />
      <span className={styles.previewCategory}>
        {rule.categories || t('theme.categoryStyles.noCategories')}
      </span>
    </div>
  )
}

export function CategoryStyleSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const id = useId()
  const rules = useSettingsStore((s) => s.categoryStyleRules)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [selectedId, setSelectedId] = useState(rules[0]?.id)
  const selected = rules.find((r) => r.id === selectedId) ?? rules[0]
  const index = selected ? rules.indexOf(selected) : -1
  const save = (next: CategoryStyleRule[]) => updateSettings({ categoryStyleRules: next })
  const update = (patch: Partial<CategoryStyleRule>) =>
    save(rules.map((r) => (r.id === selected?.id ? { ...r, ...patch } : r)))
  const add = (preset = PRESETS[0]) => {
    const rule = { ...preset, id: crypto.randomUUID() }
    save([...rules, rule])
    setSelectedId(rule.id)
  }
  const move = (offset: number) => {
    const next = [...rules]
    const target = index + offset
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    save(next)
  }
  return (
    <section
      className={shared.group}
      aria-labelledby={`${id}-heading`}
      data-component="category-style-settings"
    >
      <div className={styles.header}>
        <div>
          <h2 id={`${id}-heading`} className={shared.rowLabel}>
            {t('theme.categoryStyles.title')}
          </h2>
          <p className={shared.rowDesc}>{t('theme.categoryStyles.description')}</p>
        </div>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            save(structuredClone(DEFAULT_CATEGORY_STYLE_RULES))
            setSelectedId(DEFAULT_CATEGORY_STYLE_RULES[0].id)
          }}
        >
          {t('theme.categoryStyles.reset')}
        </button>
      </div>
      <div className={styles.layout}>
        <div className={styles.ruleList}>
          {rules.map((rule, i) => (
            <button
              type="button"
              key={rule.id}
              className={`${styles.rule} ${selected?.id === rule.id ? styles.selected : ''}`}
              aria-pressed={selected?.id === rule.id}
              onClick={() => setSelectedId(rule.id)}
            >
              <span className={styles.ruleNumber}>{i + 1}</span>
              <span>
                <strong>{rule.categories || t('theme.categoryStyles.newRule')}</strong>
                <small>
                  {rule.enabled
                    ? t(`theme.categoryStyles.treatments.${rule.treatment}`)
                    : t('theme.categoryStyles.disabled')}
                </small>
              </span>
            </button>
          ))}
          <button type="button" className={styles.button} onClick={() => add()}>
            {t('theme.categoryStyles.addRule')}
          </button>
        </div>
        {selected ? (
          <div className={styles.editor}>
            <label className={styles.enabled}>
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              {t('theme.categoryStyles.enabled')}
            </label>
            <label className={styles.field}>
              {t('theme.categoryStyles.categories')}
              <input
                className={shared.textInput}
                aria-label={t('theme.categoryStyles.categories')}
                aria-describedby={`${id}-hint`}
                value={selected.categories}
                onChange={(e) => update({ categories: e.target.value })}
              />
              <small id={`${id}-hint`}>{t('theme.categoryStyles.matchHint')}</small>
            </label>
            <label className={styles.field}>
              {t('theme.categoryStyles.style')}
              <select
                className={shared.select}
                aria-label={t('theme.categoryStyles.style')}
                value={selected.treatment}
                onChange={(e) => update({ treatment: e.target.value as CategoryStyleTreatment })}
              >
                {CATEGORY_STYLE_TREATMENTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`theme.categoryStyles.treatments.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.fields}>
              <label className={styles.field}>
                {t('theme.categoryStyles.lettering')}
                <select
                  className={shared.select}
                  aria-label={t('theme.categoryStyles.lettering')}
                  value={selected.font}
                  onChange={(e) => update({ font: e.target.value as CategoryStyleFont })}
                >
                  {(['inherit', 'hand', 'standard'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`theme.categoryStyles.fonts.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                {t('theme.categoryStyles.accent')}
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => update({ color: e.target.value })}
                />
              </label>
            </div>
            <RulePreview rule={selected} />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                {t('theme.categoryStyles.earlier')}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={index === rules.length - 1}
                onClick={() => move(1)}
              >
                {t('theme.categoryStyles.later')}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => save(rules.filter((r) => r.id !== selected.id))}
              >
                {t('theme.categoryStyles.remove')}
              </button>
            </div>
          </div>
        ) : (
          <p className={shared.rowDesc}>{t('theme.categoryStyles.empty')}</p>
        )}
      </div>
      <p className={styles.explanation}>{t('theme.categoryStyles.precedence')}</p>
      <div className={styles.suggestions}>
        <h3>{t('theme.categoryStyles.suggestions')}</h3>
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <button
              type="button"
              className={styles.button}
              key={preset.treatment}
              onClick={() => add(preset)}
            >
              + {t(`theme.categoryStyles.treatments.${preset.treatment}`)}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
