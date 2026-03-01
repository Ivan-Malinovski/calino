import type { JSX } from 'react'
import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearch } from './hooks/useSearch'
import { SearchBar } from './components/SearchBar'
import { SearchResults } from './components/SearchResults'
import { SearchFilters } from './components/SearchFilters'
import styles from './Search.module.css'

interface SearchProps {
  onSelectEvent?: (eventId: string) => void
}

export function Search({ onSelectEvent }: SearchProps): JSX.Element {
  const {
    query,
    results,
    isSearchOpen,
    filters,
    handleSearch,
    handleClear,
    openSearch,
    closeSearch,
    updateFilters,
    clearFilters,
  } = useSearch()

  const handleEventSelect = (eventId: string) => {
    onSelectEvent?.(eventId)
    closeSearch()
  }

  const showResults = isSearchOpen || query.length > 0
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isSearchOpen) return

    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeSearch()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSearchOpen, closeSearch])

  return (
    <div className={styles.searchContainer} ref={containerRef}>
      <SearchBar
        value={query}
        onChange={handleSearch}
        onClear={handleClear}
        onOpen={openSearch}
        onClose={closeSearch}
        isOpen={isSearchOpen}
      />
      <AnimatePresence>
        {showResults && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000 }}
          >
            <SearchFilters
              filters={filters}
              onUpdateFilters={updateFilters}
              onClearFilters={clearFilters}
            />
            <SearchResults results={results} onSelectEvent={handleEventSelect} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
