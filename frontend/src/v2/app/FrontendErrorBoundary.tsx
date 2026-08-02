import { Component, type ErrorInfo, type ReactNode } from "react";

import { DEFAULT_HOME_VARIANT_ID } from "../pages/home/homeVariantRegistry";

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
        <h1>首页方案加载失败</h1>
        <p>当前视觉方案未能正常启动。你可以返回默认方案，或暂时进入旧版界面。</p>
        <div>
          <a href={`/?home=${DEFAULT_HOME_VARIANT_ID}`}>返回默认方案</a>
          <a href="/legacy.html">进入旧版界面</a>
        </div>
      </main>
    );
  }
}
