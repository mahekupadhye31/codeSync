import { Component } from 'react';

/**
 * Global error boundary — catches any unhandled React render errors
 * and shows a friendly recovery page instead of a blank white screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Unhandled React error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          {/* Icon */}
          <div className="w-16 h-16 bg-red-900/30 border border-red-700/40 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <h1 className="text-xl font-semibold text-white mb-2">Something went wrong</h1>
          <p className="text-gray-400 text-sm mb-2">
            CodeSync hit an unexpected error. Your work is safe — this is a display issue.
          </p>

          {/* Error detail (collapsed) */}
          {this.state.error && (
            <details className="text-left mb-6 bg-dark-800 border border-dark-600 rounded-lg p-3 text-xs">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">
                Technical details
              </summary>
              <pre className="mt-2 text-red-400 whitespace-pre-wrap break-words overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
              {this.state.componentStack && (
                <pre className="mt-2 text-gray-500 whitespace-pre-wrap break-words overflow-auto max-h-40">
                  {this.state.componentStack}
                </pre>
              )}
            </details>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Reload page
            </button>
            <a
              href="/dashboard"
              className="px-5 py-2.5 bg-dark-700 hover:bg-dark-600 text-gray-300 text-sm font-medium rounded-xl transition-colors border border-dark-500"
            >
              Go to dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
