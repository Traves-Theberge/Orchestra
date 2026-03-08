import { Component, type ErrorInfo, type ReactNode } from 'react'

type CrashBoundaryProps = {
  children: ReactNode
}

type CrashBoundaryState = {
  hasError: boolean
  message: string
}

export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
  state: CrashBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return {
      hasError: true,
      message: error.message || 'unknown renderer error',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('renderer crash boundary caught error', { error, info })
  }

  private resetTheme = () => {
    try {
      // Clear all possible stored state that might cause render loops
      window.localStorage.removeItem('orchestra-theme')
      window.localStorage.removeItem('orchestra-sidebar-collapsed')
      window.localStorage.removeItem('orchestra-active-section')
      window.localStorage.clear() // Hard clear just in case
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl">
          <h1 className="text-xl font-semibold">Renderer failed to load</h1>
          <p className="mt-2 text-sm text-muted-foreground">The desktop app hit an unrecovered runtime error instead of rendering your dashboard.</p>
          <p className="mt-3 rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">{this.state.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80 transition"
              onClick={this.resetTheme}
            >
              Reset Theme And Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
