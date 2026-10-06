import { type ReactNode } from 'react'
import { Component, type ErrorInfo } from 'react'
import i18n from '@/lib/i18n'
import styles from './ErrorBoundary.module.css'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

export interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      // R3.1 — themed fallback. Uses the same --color-* / --space-* /
      // --radius-* tokens the rest of the app uses, so dark mode (and any
      // future custom theme) renders correctly instead of being stuck on
      // hardcoded light-mode colors.
      return (
        <div className={styles.errorFallback} role="alert">
          <h2 className={styles.title}>{i18n.t('common:ui.errorBoundary.title')}</h2>
          <p className={styles.message}>
            {this.state.error?.message || i18n.t('common:ui.errorBoundary.unexpected')}
          </p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {i18n.t('common:ui.errorBoundary.retry')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
