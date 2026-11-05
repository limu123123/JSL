import React from "react";
import { appendCrashLog, getCrashLog } from "../lib/crashLog";
import { copyTextToClipboard } from "../lib/clipboard";

type Props = { children: React.ReactNode };
type State = { error: unknown; componentStack?: string };

// 渲染层黑匣子（进度 32）：任何子树渲染崩溃不再整页白屏，改为显示错误信息界面。
// 捕获瞬间的堆栈已写入 localStorage trpg_crash_log（见 lib/crashLog.ts），重启后也不丢。
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown, info: any) {
    const componentStack: string | undefined = info?.componentStack || undefined;
    this.setState({ error, componentStack });
    try {
      appendCrashLog({
        type: "react",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        componentStack,
      });
    } catch {
      // 记录失败不影响错误展示
    }
  }

  private buildDetail = (): string => {
    const error = this.state.error;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return [
      `抛出时间: ${new Date().toLocaleString()}`,
      `错误消息: ${message}`,
      stack ? `\n错误堆栈:\n${stack}` : "",
      this.state.componentStack ? `\n组件渲染栈:\n${this.state.componentStack}` : "",
      `\n（同步写入 React 崩溃日志；localStorage 最近 ${getCrashLog().length} 条）`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  private handleCopy = async () => {
    const ok = await copyTextToClipboard(this.buildDetail());
    alert(ok ? "错误信息已复制到剪贴板" : "复制失败，请手动选中上方文本复制");
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[100] bg-zinc-950 text-zinc-200 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-xl font-bold text-amber-400">
            😵 界面崩溃捕获（黑匣子生效中）
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            游戏界面遇到了未处理的渲染错误——改动前这里会直接白屏。错误堆栈已写入崩溃日志，
            点击【复制错误信息】发给 AI 助手即可精确定位根治。存档数据未被破坏：重新加载后可从主页继续。
          </p>
          <pre className="whitespace-pre-wrap break-all bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs font-mono leading-relaxed max-h-[55vh] overflow-auto">
            {this.buildDetail()}
          </pre>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={this.handleCopy}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-colors"
            >
              📋 复制错误信息
            </button>
            <button
              onClick={() => this.setState({ error: null, componentStack: undefined })}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-sm font-semibold transition-colors"
            >
              🔄 尝试恢复界面
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-sm font-semibold transition-colors"
            >
              ♻️ 重新加载页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
