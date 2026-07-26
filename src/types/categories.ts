export interface Category {
  id: string
  name: string
  color: string
}

export interface AutoCategoryRule {
  id: string
  keywords: string[]
  categoryId: string
}
