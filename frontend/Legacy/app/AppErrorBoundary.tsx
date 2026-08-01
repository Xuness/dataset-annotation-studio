import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "../shared/ui/Button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, details: ErrorInfo) {
    console.error("Unhandled application render error", error, details.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="placeholder-page" role="alert">
        <div>
          <span className="eyebrow">Interface recovery</span>
          <h1>界面遇到意外错误</h1>
          <p>当前页面已停止渲染，避免继续产生不一致操作。磁盘中的项目文件不会被自动删除。</p>
          <p className="form-error">{this.state.error.message || "未知界面错误"}</p>
          <Button tone="primary" onClick={() => window.location.reload()}>
            重新加载应用
          </Button>
        </div>
      </main>
    );
  }
}
