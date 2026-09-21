import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown in place of the subtree once it has thrown. */
  fallback: (error: Error) => ReactNode;
  /**
   * Value the boundary watches to know the input has changed: when it does,
   * the subtree is given another chance to render.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a throwing subtree from taking the whole application down with it.
 *
 * React unmounts the entire tree when a render throws, which turns any bug in
 * one panel into a blank page, so the panels that render user-provided content
 * are wrapped in one of these.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in a rendered subtree', error, info.componentStack);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;

    return error ? this.props.fallback(error) : this.props.children;
  }
}
