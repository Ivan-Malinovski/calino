import type { JSX } from 'react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EVENT_COLORS } from '@/store/settingsStore'
import type { AutoCategoryRule } from '@/types/categories'
import styles from './Settings.module.css'

function KeywordInput({
  keywords,
  onChange,
}: {
  keywords: string[]
  onChange: (keywords: string[]) => void
}): JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const { t } = useTranslation('settings')

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const newKeyword = inputValue.trim().toLowerCase()
      if (newKeyword && !keywords.includes(newKeyword)) {
        onChange([...keywords, newKeyword])
      }
      setInputValue('')
    } else if (e.key === 'Backspace' && inputValue === '' && keywords.length > 0) {
      onChange(keywords.slice(0, -1))
    }
  }

  const removeKeyword = (keyword: string): void => {
    onChange(keywords.filter((k) => k !== keyword))
  }

  return (
    <div className={styles.keywordInput} role="list" aria-label={t('categories.keywords.ariaLabel')}>
      {keywords.map((keyword) => (
        <span key={keyword} className={styles.keywordTag} role="listitem">
          {keyword}
          <button
            type="button"
            className={styles.keywordRemove}
            aria-label={t('categories.keywords.removeKeyword', { keyword })}
            onClick={() => removeKeyword(keyword)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className={styles.keywordField}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={keywords.length === 0 ? t('categories.keywords.placeholder') : ''}
        aria-label={t('categories.keywords.addAriaLabel')}
      />
    </div>
  )
}

export function CategoriesSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const categories = useCalendarStore((s) => s.categories)
  const calendars = useCalendarStore((s) => s.calendars)
  const addCategory = useCalendarStore((s) => s.addCategory)
  const updateCategory = useCalendarStore((s) => s.updateCategory)
  const deleteCategory = useCalendarStore((s) => s.deleteCategory)
  const events = useCalendarStore((s) => s.events)
  const autoCategoryRules = useCalendarStore((s) => s.autoCategoryRules)
  const addAutoCategoryRule = useCalendarStore((s) => s.addAutoCategoryRule)
  const updateAutoCategoryRule = useCalendarStore((s) => s.updateAutoCategoryRule)
  const deleteAutoCategoryRule = useCalendarStore((s) => s.deleteAutoCategoryRule)
  const useCategoryColors = useSettingsStore((s) => s.useCategoryColors)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // Category editor state
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState<string>(EVENT_COLORS[0])
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')
  const [editCategoryColor, setEditCategoryColor] = useState('')

  // Auto-categorize rule editor state
  const [showAddRule, setShowAddRule] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [newRuleKeywords, setNewRuleKeywords] = useState<string[]>([])
  const [newRuleCategoryId, setNewRuleCategoryId] = useState('')
  const [editRuleKeywords, setEditRuleKeywords] = useState<string[]>([])
  const [editRuleCategoryId, setEditRuleCategoryId] = useState('')

  const getEventCountForCategory = (categoryName: string): number => {
    return events.filter((e) => e.categories?.includes(categoryName)).length
  }

  // Category CRUD
  const handleAddCategory = (): void => {
    if (!newCategoryName.trim()) return
    addCategory({
      id: crypto.randomUUID(),
      name: newCategoryName.trim(),
      color: newCategoryColor,
    })
    setNewCategoryName('')
    setNewCategoryColor(EVENT_COLORS[0])
    setShowAddCategory(false)
  }

  const handleUpdateCategory = (id: string): void => {
    if (!editCategoryName.trim()) return
    updateCategory(id, { name: editCategoryName.trim(), color: editCategoryColor })
    setEditingCategoryId(null)
    setEditCategoryName('')
    setEditCategoryColor('')
  }

  const handleDeleteCategory = (id: string): void => {
    deleteCategory(id)
  }

  // Auto-categorize rule CRUD
  const handleAddRule = (): void => {
    if (newRuleKeywords.length === 0 || !newRuleCategoryId) return
    addAutoCategoryRule({
      id: crypto.randomUUID(),
      keywords: newRuleKeywords,
      categoryId: newRuleCategoryId,
    })
    setNewRuleKeywords([])
    setNewRuleCategoryId('')
    setShowAddRule(false)
  }

  const handleUpdateRule = (id: string): void => {
    if (editRuleKeywords.length === 0 || !editRuleCategoryId) return
    updateAutoCategoryRule(id, {
      keywords: editRuleKeywords,
      categoryId: editRuleCategoryId,
    })
    setEditingRuleId(null)
    setEditRuleKeywords([])
    setEditRuleCategoryId('')
  }

  const handleDeleteRule = (id: string): void => {
    deleteAutoCategoryRule(id)
  }

  const startEditRule = (rule: AutoCategoryRule): void => {
    setEditingRuleId(rule.id)
    setEditRuleKeywords([...rule.keywords])
    setEditRuleCategoryId(rule.categoryId)
  }

  const cancelEditRule = (): void => {
    setEditingRuleId(null)
    setEditRuleKeywords([])
    setEditRuleCategoryId('')
  }

  const cancelAddRule = (): void => {
    setShowAddRule(false)
    setNewRuleKeywords([])
    setNewRuleCategoryId('')
  }

  // Apply rules to existing events
  const handleApplyToExisting = (): void => {
    const { getState } = useCalendarStore
    const state = getState()
    let changesMade = 0

    for (const rule of state.autoCategoryRules) {
      const category = state.categories.find((c) => c.id === rule.categoryId)
      if (!category) continue

      const lowerKeywords = rule.keywords.map((k) => k.toLowerCase())

      for (const event of state.events) {
        const lowerTitle = event.title.toLowerCase()
        const matches = lowerKeywords.some((kw) => lowerTitle.includes(kw))
        if (!matches) continue

        const currentCategories = event.categories || []
        if (currentCategories.includes(category.name)) continue

        // Add the category
        useCalendarStore.getState().updateEvent(event.id, {
          categories: [...currentCategories, category.name],
        })
        changesMade++
      }
    }

    if (changesMade > 0) {
      console.log(`[AutoCategory] Applied rules to ${changesMade} events`)
    }
  }

  // Preview: events that would match but don't have the category yet
  const rulePreviews = useMemo(() => {
    return autoCategoryRules.map((rule) => {
      const category = categories.find((c) => c.id === rule.categoryId)
      if (!category) return { rule, matchingCount: 0, uncategorizedCount: 0, byCalendar: [] }

      const lowerKeywords = rule.keywords.map((k) => k.toLowerCase())
      let matchingCount = 0
      let uncategorizedCount = 0
      const byCalendar = new Map<string, number>()

      for (const event of events) {
        const lowerTitle = event.title.toLowerCase()
        const matches = lowerKeywords.some((kw) => lowerTitle.includes(kw))
        if (matches) {
          matchingCount++
          if (!event.categories?.includes(category.name)) {
            uncategorizedCount++
          }
          const calId = event.calendarId
          byCalendar.set(calId, (byCalendar.get(calId) || 0) + 1)
        }
      }

      const byCalendarArray = Array.from(byCalendar.entries()).map(([calId, count]) => {
        const cal = calendars.find((c) => c.id === calId)
        return { name: cal?.name || 'Unknown', count }
      })

      return {
        rule,
        matchingCount,
        uncategorizedCount,
        categoryName: category.name,
        byCalendar: byCalendarArray,
      }
    })
  }, [autoCategoryRules, categories, events, calendars])

  // Preview for new rule being created
  const newRulePreview = useMemo(() => {
    if (newRuleKeywords.length === 0 || !newRuleCategoryId) return null
    const category = categories.find((c) => c.id === newRuleCategoryId)
    if (!category) return null

    const lowerKeywords = newRuleKeywords.map((k) => k.toLowerCase())
    let matchingCount = 0
    let uncategorizedCount = 0
    const byCalendar = new Map<string, number>()

    for (const event of events) {
      const lowerTitle = event.title.toLowerCase()
      const matches = lowerKeywords.some((kw) => lowerTitle.includes(kw))
      if (matches) {
        matchingCount++
        if (!event.categories?.includes(category.name)) {
          uncategorizedCount++
        }
        const calId = event.calendarId
        byCalendar.set(calId, (byCalendar.get(calId) || 0) + 1)
      }
    }

    const byCalendarArray = Array.from(byCalendar.entries()).map(([calId, count]) => {
      const cal = calendars.find((c) => c.id === calId)
      return { name: cal?.name || 'Unknown', count }
    })

    return {
      matchingCount,
      uncategorizedCount,
      categoryName: category.name,
      byCalendar: byCalendarArray,
    }
  }, [newRuleKeywords, newRuleCategoryId, categories, events, calendars])

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="categories-settings"
    >
      <h1 className={styles.pageTitle}>{t('categories.title')}</h1>

      <div className={styles.group}>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="use-category-colors"
          data-value={String(useCategoryColors)}
        >
          <div>
            <div className={styles.rowLabel}>{t('categories.useCategoryColors.label')}</div>
            <div className={styles.rowDesc}>{t('categories.useCategoryColors.desc')}</div>
          </div>
          <label
            className={styles.toggle}
            data-component="toggle"
            data-setting="use-category-colors"
          >
            <input
              type="checkbox"
              checked={useCategoryColors}
              aria-label={t('categories.useCategoryColors.ariaLabel')}
              onChange={() => updateSettings({ useCategoryColors: !useCategoryColors })}
            />
            <span className={styles.pill} />
            <span className={styles.knob} />
          </label>
        </div>
      </div>

      {/* Categories List */}
      <div className={styles.group} data-component="categories-list">
        <div className={styles.catList}>
          {categories.map((category) => (
            <div
              key={category.id}
              className={styles.catRow}
              data-component="category-row"
              data-category-id={category.id}
              data-category-name={category.name}
              data-category-color={category.color}
              onBlur={(event) => {
                // Native dialogs, including the color picker, blur the input
                // without moving focus to another DOM element.
                if (!event.relatedTarget) return
                if (
                  editingCategoryId === category.id &&
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  handleUpdateCategory(category.id)
                }
              }}
            >
              {editingCategoryId === category.id ? (
                <>
                  <div className={`${styles.swatches} ${styles.catSwatches}`}>
                    {EVENT_COLORS.map((color) => (
                      <button
                        key={color}
                        className={`${styles.swatch} ${styles.swatchSm} ${editCategoryColor === color ? styles.swatchActive : ''}`}
                        style={{ '--swatch-color': color } as React.CSSProperties}
                        aria-label={t('categories.color.swatchAriaLabel', { color })}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setEditCategoryColor(color)
                        }}
                        type="button"
                      />
                    ))}
                    <span
                      className={`${styles.customColorPicker} ${
                        !EVENT_COLORS.some((color) => color === editCategoryColor)
                          ? styles.customColorPickerSelected
                          : ''
                      }`}
                    >
                      <input
                        type="color"
                        value={editCategoryColor}
                        onChange={(e) => {
                          updateCategory(category.id, {
                            name: editCategoryName.trim() || category.name,
                            color: e.target.value,
                          })
                          setEditingCategoryId(null)
                          setEditCategoryName('')
                          setEditCategoryColor('')
                        }}
                        aria-label={t('categories.color.customAriaLabel', { name: category.name })}
                      />
                    </span>
                  </div>
                  <input
                    type="text"
                    className={styles.catEditInput}
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory(category.id)}
                    autoFocus
                    aria-label={t('categories.editName')}
                  />
                  <span className={styles.catCount}>
                    {getEventCountForCategory(category.name)} events
                  </span>
                </>
              ) : (
                <>
                  <div
                    className={styles.catSwatch}
                    style={
                      { '--cat-color': category.color, cursor: 'pointer' } as React.CSSProperties
                    }
                    role="button"
                    tabIndex={0}
                    aria-label={t('categories.editAriaLabel', { name: category.name })}
                    onClick={() => {
                      setEditingCategoryId(category.id)
                      setEditCategoryName(category.name)
                      setEditCategoryColor(category.color)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setEditingCategoryId(category.id)
                        setEditCategoryName(category.name)
                        setEditCategoryColor(category.color)
                      }
                    }}
                  />
                  <span
                    className={styles.catName}
                    style={{ cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    aria-label={t('categories.editAriaLabel', { name: category.name })}
                    onClick={() => {
                      setEditingCategoryId(category.id)
                      setEditCategoryName(category.name)
                      setEditCategoryColor(category.color)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setEditingCategoryId(category.id)
                        setEditCategoryName(category.name)
                        setEditCategoryColor(category.color)
                      }
                    }}
                  >
                    {category.name}
                  </span>
                  <span className={styles.catCount}>
                    {getEventCountForCategory(category.name)} events
                  </span>
                  <div className={styles.catActions}>
                    <button
                      className={`${styles.catBtn} ${styles.catBtnDanger}`}
                      onClick={() => handleDeleteCategory(category.id)}
                      aria-label={t('categories.deleteAriaLabel', { name: category.name })}
                      type="button"
                    >
                      {t('categories.delete')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {showAddCategory ? (
            <div className={styles.catRow} data-component="add-category-form">
              <input
                type="text"
                className={styles.formInput}
                placeholder={t('categories.addForm.namePlaceholder')}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                autoFocus
                aria-label={t('categories.addForm.nameAriaLabel')}
              />
              <div className={`${styles.swatches} ${styles.catSwatches}`}>
                {EVENT_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`${styles.swatch} ${styles.swatchSm} ${newCategoryColor === color ? styles.swatchActive : ''}`}
                    style={{ '--swatch-color': color } as React.CSSProperties}
                    aria-label={t('categories.color.swatchAriaLabel', { color })}
                    onClick={() => setNewCategoryColor(color)}
                    type="button"
                  />
                ))}
                <span
                  className={`${styles.customColorPicker} ${
                    !EVENT_COLORS.some((color) => color === newCategoryColor)
                      ? styles.customColorPickerSelected
                      : ''
                  }`}
                >
                  <input
                    type="color"
                    value={newCategoryColor}
                    onChange={(e) => setNewCategoryColor(e.target.value)}
                    aria-label={t('categories.color.customNewAriaLabel')}
                  />
                </span>
              </div>
              <button className={styles.actionBtn} onClick={handleAddCategory} type="button">
                {t('categories.addForm.add')}
              </button>
              <button
                className={styles.actionBtn}
                onClick={() => setShowAddCategory(false)}
                type="button"
              >
                {t('categories.addForm.cancel')}
              </button>
            </div>
          ) : (
            <button
              className={styles.catAdd}
              onClick={() => setShowAddCategory(true)}
              data-component="action-button"
              data-action="add-category"
              type="button"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M8 2v12M2 8h12" />
              </svg>
              {t('categories.addCategory')}
            </button>
          )}
        </div>
      </div>

      {/* Auto-categorize Rules */}
      <div className={styles.group} data-component="auto-categorize-rules">
        <div className={styles.autoCatHeader}>
          <div className={styles.autoCatTitle}>{t('categories.autoCategorize.title')}</div>
          <div className={styles.autoCatDesc}>
            {t('categories.autoCategorize.desc')}
          </div>
        </div>

        <div className={styles.catList}>
          {rulePreviews.map(
            ({ rule, matchingCount, uncategorizedCount, categoryName, byCalendar }) => (
              <div
                key={rule.id}
                className={`${styles.catRow} ${styles.ruleRow}`}
                data-component="auto-rule-row"
                data-rule-id={rule.id}
                data-rule-keywords={rule.keywords.join(',')}
                data-rule-category-id={rule.categoryId}
              >
                {editingRuleId === rule.id ? (
                  <>
                    <div className={styles.formRow}>
                      <KeywordInput keywords={editRuleKeywords} onChange={setEditRuleKeywords} />
                      <span className={styles.ruleArrow}>→</span>
                      <select
                        className={styles.ruleSelect}
                        value={editRuleCategoryId}
                        onChange={(e) => setEditRuleCategoryId(e.target.value)}
                        aria-label={t('categories.autoCategorize.selectCategoryAriaLabel')}
                      >
                        <option value="">{t('categories.autoCategorize.selectCategory')}</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleUpdateRule(rule.id)}
                        type="button"
                      >
                          {t('categories.autoCategorize.save')}
                      </button>
                      <button className={styles.actionBtn} onClick={cancelEditRule} type="button">
                        {t('categories.autoCategorize.cancel')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.ruleMainRow}>
                      <div className={styles.ruleKeywords}>
                        {rule.keywords.map((kw) => (
                          <span key={kw} className={styles.ruleKeywordTag}>
                            {kw}
                          </span>
                        ))}
                      </div>
                      <span className={styles.ruleArrow}>→</span>
                      <span className={styles.ruleCategoryBadge}>{categoryName}</span>
                      <span className={styles.catCount}>
                        {matchingCount} match{matchingCount !== 1 ? 'es' : ''}
                        {uncategorizedCount > 0 && (
                          <span style={{ color: 'var(--accent)', marginLeft: '4px' }}>
                            ({uncategorizedCount} uncategorized)
                          </span>
                        )}
                      </span>
                      {byCalendar.length > 0 && (
                        <div className={styles.rulePreviewCalendar}>
                          {byCalendar.map((cal) => (
                            <span key={cal.name}>
                              {cal.count} in {cal.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={styles.catActions}>
                        <button
                          className={styles.catBtn}
                          onClick={() => startEditRule(rule)}
                          type="button"
                        >
                          {t('categories.autoCategorize.edit')}
                        </button>
                        <button
                          className={`${styles.catBtn} ${styles.catBtnDanger}`}
                          onClick={() => handleDeleteRule(rule.id)}
                          type="button"
                        >
                          {t('categories.autoCategorize.delete')}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          )}

          {showAddRule ? (
            <div className={`${styles.catRow} ${styles.ruleRow}`} data-component="add-rule-form">
              <div className={styles.formRow}>
                <KeywordInput keywords={newRuleKeywords} onChange={setNewRuleKeywords} />
                <span className={styles.ruleArrow}>→</span>
                <select
                  className={styles.ruleSelect}
                  value={newRuleCategoryId}
                  onChange={(e) => setNewRuleCategoryId(e.target.value)}
                  aria-label={t('categories.autoCategorize.selectCategoryForNewRuleAriaLabel')}
                >
                  <option value="">{t('categories.autoCategorize.selectCategory')}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                <button className={styles.actionBtn} onClick={handleAddRule} type="button">
                  Add
                </button>
                <button className={styles.actionBtn} onClick={cancelAddRule} type="button">
                  Cancel
                </button>
              </div>
              {newRulePreview && (
                <div className={styles.rulePreview}>
                  Will match {newRulePreview.matchingCount} event
                  {newRulePreview.matchingCount !== 1 ? 's' : ''}
                  {newRulePreview.uncategorizedCount > 0 && (
                    <span> ({newRulePreview.uncategorizedCount} currently uncategorized)</span>
                  )}
                  {newRulePreview.byCalendar.length > 0 && (
                    <div className={styles.rulePreviewCalendar}>
                      {newRulePreview.byCalendar.map((cal) => (
                        <span key={cal.name}>
                          {cal.count} in {cal.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              className={styles.catAdd}
              onClick={() => setShowAddRule(true)}
              data-component="action-button"
              data-action="add-auto-rule"
              type="button"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M8 2v12M2 8h12" />
              </svg>
              {t('categories.autoCategorize.addRule')}
            </button>
          )}

          {autoCategoryRules.length > 0 && (
            <div className={styles.applySection}>
              <button
                className={styles.actionBtn}
                onClick={handleApplyToExisting}
                data-component="action-button"
                data-action="apply-rules-to-existing"
                type="button"
              >
                {t('categories.autoCategorize.applyToExisting')}
              </button>
              <span className={styles.applySectionText}>
                {t('categories.autoCategorize.applyToExistingDesc')}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
