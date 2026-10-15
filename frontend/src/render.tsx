import React, { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

class FirstRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('首屏渲染失败', error, info.componentStack);
    window.paperBoot?.fail(error);
  }
  render(): ReactNode {
    return this.state.failed
      ? <div className="empty-panel" role="alert"><strong>界面暂时无法显示</strong><button onClick={() => location.reload()}>重新加载界面</button></div>
      : this.props.children;
  }
}

function FirstFrame(): JSX.Element {
  useEffect(() => { window.paperBoot?.ready(); }, []);
  return <App />;
}

export function mountApplication(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><FirstRenderBoundary><FirstFrame /></FirstRenderBoundary></React.StrictMode>
  );
}
