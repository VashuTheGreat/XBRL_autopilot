/**
 * Keeps a failing pane from taking the whole window down: React unmounts the entire tree when a component throws
 * while rendering or in an effect (a white window). The boundary shows a message in that pane instead, with a way to
 * try again; the error goes to the console (and so to the main process log in development).
 */
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/primitives'
import { EmptyState } from './EmptyState'

interface Props {
  /** what failed, in the user's words ("The Excel view") */
  what: string
  children: ReactNode
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.what}]`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <EmptyState icon={AlertTriangle} title={`${this.props.what} stopped working`}>
        <p className="max-w-md text-[11px]">{this.state.error.message}</p>
        <p>Your filing is safe: it lives in the project, not in this view.</p>
        <div className="mt-3">
          <Button onClick={() => this.setState({ error: null })} data-testid="error-retry">
            <RotateCcw size={14} /> Try again
          </Button>
        </div>
      </EmptyState>
    )
  }
}
