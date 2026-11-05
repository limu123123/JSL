// ==================== 剪贴板工具（进度 31/32 公用，纯 UI 层）====================
// 优先 navigator.clipboard（需要 https/localhost 安全上下文）；
// 失败回退 execCommand（局域网 http://192.168.x.x:5174 这类非安全上下文时必需——进度 13 实测环境）。
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 安全上下文判定或写入失败 → 回退
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
