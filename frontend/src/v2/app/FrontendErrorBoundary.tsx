import { Component, type ErrorInfo, type ReactNode } from "react";

import { DEFAULT_FRONTEND_THEME_ID } from "../themes/themeRegistry";

interface FrontendErrorBoundaryProps {
  children: ReactNode;
}

interface FrontendErrorBoundaryState {
  failed: boolean;
}

export class FrontendErrorBoundary extends Component<
  FrontendErrorBoundaryProps,
  FrontendErrorBoundaryState
> {
  state: FrontendErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): FrontendErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Frontend interface failed to render", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="frontend-failure" role="alert">
        <span>INTERFACE RECOVERY</span>
        <h1>界面主题加载失败</h1>
        <p>当前视觉主题未能正常启动。你可以返回默认主题，或暂时进入旧版界面。</p>
        <div>
          <a href={`/?theme=${DEFAULT_FRONTEND_THEME_ID}`}>返回默认主题</a>
          <a href="/legacy.html">进入旧版界面</a>
        </div>
      </main>
    );
  }
}
