import { Component, type ErrorInfo, type ReactNode } from "react";

export class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error("工作区渲染失败", error, info.componentStack); }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <div className="empty-panel" role="alert"><strong>当前模块暂时无法显示</strong><p>请重新加载模块；仍有问题可切换其他页面，已有数据不会被删除。</p><button type="button" onClick={() => this.setState({ failed: false })}>重新加载模块</button></div>;
  }
}
