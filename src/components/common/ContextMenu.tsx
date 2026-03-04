import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { useContextMenuStore } from '@/store/contextMenuStore'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  icon?: JSX.Element
  danger?: boolean
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

  useEffect(() => {
    if (openMenuId && openMenuId !== menuId) {
      onClose()
    }
  }, [openMenuId, menuId, onClose])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let adjustedX = x
      let adjustedY = y

      if (x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8
      }
      if (y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8
      }

      menuRef.current.style.left = `${adjustedX}px`
      menuRef.current.style.top = `${adjustedY}px`
    }
  }, [x, y])

  return (
    <div ref={menuRef} className={styles.menu} style={{ left: x, top: y }}>
      {items.map((item, index) => (
        <button
          key={index}
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            item.onClick()
            onClose()
          }}
        >
          {item.icon && <span className={styles.icon}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
