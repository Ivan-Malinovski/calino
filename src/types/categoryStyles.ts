export const CATEGORY_STYLE_TREATMENTS = [
  'tentative',
  'important',
  'focus',
  'travel',
  'deadline',
  'done',
] as const
export type CategoryStyleTreatment = (typeof CATEGORY_STYLE_TREATMENTS)[number]
export type CategoryStyleFont = 'inherit' | 'standard' | 'hand'

export interface CategoryStyleRule {
  id: string
  categories: string
  treatment: CategoryStyleTreatment
  font: CategoryStyleFont
  color: string
  enabled: boolean
}
