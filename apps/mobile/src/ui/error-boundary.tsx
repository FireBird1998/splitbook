import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Shown in place of `children` after one of them throws while rendering. */
  fallback: ReactNode;
  /** The content is tried again only once this changes, such as for another draft. */
  resetKey: unknown;
  children: ReactNode;
}

/**
 * Contains a rendering error to the screen it happens on (#187). The fallback replaces the
 * content, which isn't rendered again until `resetKey` changes, so a value that failed to
 * render isn't read again. React still reports the error.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  { failed: boolean; resetKey: unknown }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: { failed: boolean; resetKey: unknown },
  ) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
