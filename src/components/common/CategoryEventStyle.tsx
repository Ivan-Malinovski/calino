import type { CSSProperties, JSX, HTMLAttributes } from 'react'
import type { CalendarEvent } from '@/types'
import type { CategoryAppearance } from '@/lib/categoryStyles'
import { useCategoryEventStyle } from '@/hooks/useCategoryEventStyle'
import { categoryStyleProps } from '@/lib/categoryStylePresentation'
import styles from './CategoryEventStyle.module.css'

export function CategoryStyleTitle({
  title,
  appearance,
}: {
  title: string
  appearance: CategoryAppearance
}): JSX.Element {
  // Leave ordinary event titles in their original layout. Texture belongs to the surface.
  if (
    !appearance.sketch &&
    !appearance.marker &&
    !appearance.done &&
    !appearance.font &&
    !appearance.pencil
  ) {
    return <>{title}</>
  }
  const customStyle = {
    '--category-sketch': appearance.sketch,
    '--category-marker': appearance.marker,
  } as CSSProperties
  return (
    <span
      className={styles.title}
      style={customStyle}
      data-component="category-styled-title"
      data-sketch={appearance.sketch ? 'true' : undefined}
      data-font={appearance.font}
      data-pencil={appearance.pencil || undefined}
      data-marker={appearance.marker ? 'true' : undefined}
      data-finished={appearance.done || undefined}
    >
      <span className={styles.text}>{title}</span>
      {appearance.sketch && (
        <svg
          className={styles.loop}
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          data-component="category-sketch"
        >
          <path
            d={
              title.length % 2
                ? 'M168 10 C148 -3 127 7 108 2 C83 -5 57 8 36 11 C18 16 3 30 7 46 C3 63 19 77 35 83 C56 99 78 90 100 96 C127 104 151 91 172 85 C194 76 202 58 194 42 C193 27 176 17 158 12 C143 5 125 7 110 10'
                : 'M165 9 C143 -5 119 5 101 1 C76 -3 51 5 32 15 C12 20 2 35 7 51 C4 68 23 82 41 87 C65 101 86 92 107 97 C131 101 158 91 176 80 C198 69 199 49 190 34 C182 18 164 14 146 9 C132 4 118 9 104 10'
            }
          />
          <path className={styles.tail} d="M126 6 C99 10 73 -1 49 10 C20 14 5 31 10 51 C9 72 34 89 61 90 C89 102 118 94 143 94 C175 91 196 73 197 55 C200 32 180 18 159 14 C142 7 126 8 113 12" />
        </svg>
      )}
    </span>
  )
}

export function CategoryEventTitle({ event }: { event: CalendarEvent }): JSX.Element {
  const appearance = useCategoryEventStyle(event)
  return <CategoryStyleTitle title={event.title} appearance={appearance} />
}

/** Used by compact popup rows which do not share EventCard's layout. */
export function CategoryEventSurface({
  event,
  ...props
}: HTMLAttributes<HTMLDivElement> & { event: CalendarEvent }): JSX.Element {
  const appearance = useCategoryEventStyle(event)
  const presentation = categoryStyleProps(appearance)
  return (
    <div
      {...props}
      data-category-texture={presentation['data-category-texture']}
      style={{ ...props.style, ...presentation.style }}
    />
  )
}
