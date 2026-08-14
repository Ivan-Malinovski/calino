import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  icon?: JSX.Element
  danger?: boolean
  /** Emitted as `data-component` so tests can target a specific item. */
  dataComponent?: string
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  menuId: string
}

export function ContextMenu({ x, y, items, onClose, menuId }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const openMenuId = useContextMenuStore((state) => state.openMenuId)
  // The parent mounts/unmounts this component; animate out before unmounting by
  // routing every dismissal through requestClose (isOpen stays true while mounted).
  const { closing, requestClose } = useAnimatedClose(true, onClose, 100)

  useEffect(() => {
    if (openMenuId && openMenuId !== menuId) {
      requestClose()
    }
  }, [openMenuId, menuId, requestClose])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        requestClose()
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        requestClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [requestClose])

  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current
      const rect = menu.getBoundingClientRect()
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight

      let adjustedX = x
      let adjustedY = y

      // Flip horizontally if overflowing right edge
      if (x + rect.width > viewportW) {
        adjustedX = x - rect.width
      }
      // Flip vertically if overflowing bottom edge
      if (y + rect.height > viewportH) {
        adjustedY = y - rect.height
      }
      // Clamp to viewport edges
      adjustedX = Math.max(0, adjustedX)
      adjustedY = Math.max(0, adjustedY)

      menu.style.left = `${adjustedX}px`
      menu.style.top = `${adjustedY}px`
    }
  }, [x, y])

  return (
    <div
      ref={menuRef}
      className={`${styles.menu} ${closing ? styles.closing : ''}`}
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          data-component={item.dataComponent}
          onClick={(e) => {
            e.stopPropagation()
            item.onClick()
            requestClose()
          }}
        >
          {item.icon && <span className={styles.icon}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
