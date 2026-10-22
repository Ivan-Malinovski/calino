import type { CSSProperties } from 'react'
import type { CategoryAppearance } from './categoryStyles'

export function categoryStyleProps(appearance: CategoryAppearance) {
  const style: CSSProperties = {
    ...(appearance.fill
      ? { backgroundColor: `color-mix(in srgb, ${appearance.fill} 13%, var(--panel))` }
      : {}),
    ...(appearance.texture
      ? {
          backgroundImage: `repeating-linear-gradient(135deg, transparent 0, transparent 7px, color-mix(in srgb, ${appearance.texture} 18%, transparent) 7px, color-mix(in srgb, ${appearance.texture} 18%, transparent) 9px)`,
        }
      : {}),
    ...(appearance.dashed ? { border: `1px dashed ${appearance.dashed}` } : {}),
  }
  return { style, 'data-category-texture': appearance.texture ? 'true' : undefined }
}
