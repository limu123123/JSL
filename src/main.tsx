import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {installGlobalCrashHandlers} from './lib/crashLog.ts';
import './index.css';

// 崩溃黑匣子（进度 32）：全局 onerror / unhandledrejection 兜底，先于 React 挂载安装
installGlobalCrashHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
