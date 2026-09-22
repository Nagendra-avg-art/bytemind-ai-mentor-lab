import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ByteMind ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-card" role="alert">
          <div className="error-boundary-header">
            <span className="error-boundary-icon" aria-hidden="true">⚠️</span>
            <div>
              <h3 className="error-boundary-title">
                {this.props.fallbackTitle || 'Something went wrong in this section'}
              </h3>
              <p className="error-boundary-desc">
                {this.props.fallbackMessage ||
                  this.state.error?.message ||
                  'An unexpected error occurred while rendering this component.'}
              </p>
            </div>
          </div>
          <div className="error-boundary-actions">
            <button
              type="button"
              className="btn btn-secondary error-retry-btn"
              onClick={this.handleRetry}
            >
              🔄 Try Again
            </button>
            <button
              type="button"
              className="btn btn-text-reload"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
