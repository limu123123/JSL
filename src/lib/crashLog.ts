// ==================== 崩溃黑匣子（进度 32，用户 2026-11-01 批准"黑匣子+读档防御"）====================
// 背景：全项目原本没有任何 ErrorBoundary，任何未捕获的渲染异常 = 整页白屏
//（用户实测偶发，场景=回合生成中，无稳定复现路径）。
// 机制：window.onerror / unhandledrejection 全局兜底 + React ErrorBoundary 钩子（ErrorBoundary.tsx），
// 把崩溃消息/堆栈/组件渲染栈写进 localStorage `trpg_crash_log`（上限 5 条，先进先出）。
// 这样即使页面白屏，重启后错误信息仍可取回，据此定位根治点。
// 纯客户端诊断：不打 AI API、不改变任何请求字节、不动存档数据。

export interface TrpgCrashRecord {
  ts: number;
  type: "react" | "error" | "unhandledrejection";
  message: string;
  stack?: string;
  componentStack?: string;
  source?: string; // error 事件来源 脚本:行:列
}

const CRASH_LOG_KEY = "trpg_crash_log";
const CRASH_LOG_LIMIT = 5;

export function getCrashLog(): TrpgCrashRecord[] {
  try {
    const raw = localStorage.getItem(CRASH_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearCrashLog(): void {
  try {
    localStorage.removeItem(CRASH_LOG_KEY);
  } catch {
    // ignore
  }
}

export function appendCrashLog(record: Omit<TrpgCrashRecord, "ts">): void {
  try {
    const list = getCrashLog();
    list.push({ ...record, ts: Date.now() });
    while (list.length > CRASH_LOG_LIMIT) list.shift();
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(list));
  } catch {
    // 配额满/不可写时静默放弃——不能因日志本身再引发次生崩溃
  }
}

// main.tsx 挂载前调用一次（幂等）
export function installGlobalCrashHandlers(): void {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (w.__trpgCrashHandlersInstalled) return;
  w.__trpgCrashHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    appendCrashLog({
      type: "error",
      message: String(event?.message || "脚本运行时错误"),
      stack: ((event as any)?.error as Error)?.stack || undefined,
      source: `${event?.filename || "?"}:${event?.lineno ?? "?"}:${event?.colno ?? "?"}`,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: any = (event as any)?.reason;
    appendCrashLog({
      type: "unhandledrejection",
      message: String(reason?.message || reason || "未处理的 Promise 异常"),
      stack: reason?.stack || undefined,
    });
  });
}
