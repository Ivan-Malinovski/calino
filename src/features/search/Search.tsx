import type { JSX } from 'react'
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

  return (
    <div className={styles.searchContainer}>
      <SearchBar
        value={query}
        onChange={handleSearch}
        onClear={handleClear}
        onOpen={openSearch}
        onClose={closeSearch}
        isOpen={isSearchOpen}
      />
      {isSearchOpen && (
        <>
          <SearchFilters
            filters={filters}
            onUpdateFilters={updateFilters}
            onClearFilters={clearFilters}
          />
          <SearchResults results={results} onSelectEvent={handleEventSelect} />
        </>
      )}
    </div>
  )
}
