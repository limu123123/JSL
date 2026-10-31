// LLMRPG 存档 txt 文件模块
// 结构：可以用于导入导出的设定（完整存档 JSON）+ 总结的大纲（编年史）+ 每回合正文（#N 编号）
// 依赖 File System Access API（Chrome/Edge）实现静默自动写入。

const SAVE_DIR_DB = "trpg_save_file_db";
const SAVE_DIR_STORE = "handles";
const SAVE_DIR_KEY = "saveDir";

export const AUTO_SAVE_FILENAME = "LLMRPG自动存档.txt";
export const slotSaveFilename = (slot: number) => `LLMRPG存档${slot}.txt`;

const JSON_BEGIN = "<<<LLMRPG_SAVE_JSON>>>";
const JSON_END = "<<<END_LLMRPG_SAVE_JSON>>>";

// ---------- IndexedDB: 持久化目录句柄 ----------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SAVE_DIR_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SAVE_DIR_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_DIR_STORE, "readwrite");
    tx.objectStore(SAVE_DIR_STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_DIR_STORE, "readonly");
    const req = tx.objectStore(SAVE_DIR_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 目录句柄管理 ----------

let cachedDirHandle: FileSystemDirectoryHandle | null = null;

export function isFileSystemAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

export async function getStoredSaveDir(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedDirHandle) return cachedDirHandle;
  try {
    const handle = await idbGet<FileSystemDirectoryHandle>(SAVE_DIR_KEY);
    cachedDirHandle = handle || null;
  } catch {
    cachedDirHandle = null;
  }
  return cachedDirHandle;
}

export async function pickSaveDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("当前浏览器不支持文件系统访问（需要 Chrome / Edge），无法启用 TXT 自动存档。");
  }
  const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: "readwrite",
    id: "llmrpg-saves",
    startIn: "documents",
  });
  await idbSet(SAVE_DIR_KEY, handle);
  cachedDirHandle = handle;
  return handle;
}

// 检查/申请读写权限。request 需要在用户手势回调中调用。
export async function ensureSaveDirPermission(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getStoredSaveDir();
  if (!handle) return null;
  const opts: FsaPermissionOptions = { mode: "readwrite" };
  const status = await handle.queryPermission!(opts);
  if (status === "granted") return handle;
  const req = await handle.requestPermission!(opts);
  if (req === "granted") return handle;
  return null;
}

async function getWritableDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  const handle = await getStoredSaveDir();
  if (!handle) return null;
  try {
    const status = await handle.queryPermission!({ mode: "readwrite" });
    if (status === "granted") return handle;
    // 权限丢失（如浏览器重启后）：尝试申请恢复。
    // 在用户手势上下文中会弹出授权框或自动授予；后台流程中申请会失败，走原来的静默跳过。
    return await ensureSaveDirPermission();
  } catch {
    return null;
  }
}

// ---------- txt 构建 ----------

// 展示用题材短标签：自定义世界观的长文本截断显示。
// 仅用于 UI/文件头展示；存档数据中仍保留完整原文（读档后要原样发给 AI）。
export function genreShortLabel(genre?: string, maxLen = 12): string {
  if (!genre) return "未设置";
  const g = String(genre).trim();
  return g.length > maxLen ? g.slice(0, maxLen) + "…" : g;
}

export function buildSaveTxt(saveState: any): string {
  const character = saveState.character || {};
  const history: any[] = Array.isArray(saveState.history) ? saveState.history : [];
  const longTerm: string[] = Array.isArray(saveState.longTermHistory) ? saveState.longTermHistory : [];

  const lines: string[] = [];
  lines.push("============================================================");
  lines.push("LLMRPG 跑团存档");
  if (saveState.saveName) lines.push(`存档名: ${saveState.saveName}`);
  lines.push(`题材: ${genreShortLabel(saveState.genre)}`);
  lines.push(`角色: ${character.name || "未命名"}（${character.class || "未设定"}）`);
  lines.push(`回合数: ${String(saveState.turnCount ?? 1)}`);
  lines.push(`保存时间: ${new Date().toLocaleString()}`);
  lines.push("============================================================");
  lines.push("");
  lines.push("## 设定");
  lines.push("（导入时读取此区块中的 JSON；缩进排版，可直接阅读）");
  lines.push(JSON_BEGIN);
  // 纯阅读用文件：剔除回合快照（体积大头，回滚数据随 JSON 存档走，不必进 TXT）
  const readableState = { ...saveState, turnSnapshots: undefined };
  lines.push(JSON.stringify(readableState, null, 2));
  lines.push(JSON_END);
  lines.push("");
  lines.push("## 大纲");
  if (longTerm.length > 0) {
    longTerm.forEach((s, i) => lines.push(`阶段 ${i + 1}: ${s}`));
  } else {
    lines.push("（暂无编年史摘要，游玩 30 回合后自动归档生成）");
  }
  lines.push("");
  lines.push("## 正文");

  // 正文 = 全本归档（历史被编年史压缩摘除前的章节原文）∪ 当前内存详文，按回合号合并 → 从第 1 回合铺到最新
  const archive: any[] = Array.isArray(saveState.fullStoryArchive)
    ? saveState.fullStoryArchive
    : [];
  const byTurn = new Map<number, any>();
  [...archive, ...history].forEach((h) => {
    const t = h?.turn;
    if (typeof t === "number" && Number.isFinite(t) && !byTurn.has(t)) {
      byTurn.set(t, h);
    }
  });
  const allTurns = [...byTurn.values()].sort((a, b) => a.turn - b.turn);

  let count = 0;
  allTurns.forEach((h) => {
    count++;
    const turnNo = h.turn ?? count;
    lines.push("");
    lines.push(`#${turnNo}`);
    if (h.narrative) {
      lines.push("【场景】");
      lines.push(String(h.narrative));
    }
    if (h.choiceOrAction) {
      lines.push(`【行动】${h.choiceOrAction}`);
    }
    if (h.rollResult) {
      lines.push(`【判定】${h.rollResult}`);
    }
    if (h.gmCommentary) {
      lines.push(`【GM点评】${h.gmCommentary}`);
    }
  });

  // 当前画面上的最新剧情（尚未进入 history 的这一回合）
  if (saveState.currentEventText) {
    count++;
    lines.push("");
    lines.push(`#${saveState.turnCount ?? count}（当前剧情）`);
    lines.push("【场景】");
    lines.push(String(saveState.currentEventText));
    if (saveState.currentGmCommentary) {
      lines.push(`【GM点评】${saveState.currentGmCommentary}`);
    }
  }

  return lines.join("\r\n");
}

// ---------- 文件读写 ----------

// 静默写入；眉头未授权/未选择文件夹时静默跳过（返回 false），不干扰游玩。
export async function writeSaveTxt(fileName: string, saveState: any): Promise<boolean> {
  try {
    const dir = await getWritableDir();
    if (!dir) return false;
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buildSaveTxt(saveState));
    await writable.close();
    return true;
  } catch (err) {
    console.warn("[saveFile] 写入 TXT 存档失败（不影响游戏进行）:", err);
    return false;
  }
}

export async function deleteSaveTxt(fileName: string): Promise<void> {
  try {
    const dir = await getWritableDir();
    if (!dir) return;
    await dir.removeEntry(fileName);
  } catch {
    // 文件不存在等情况忽略
  }
}

// ---------- 动态 txt 命名（文件名 = 存档名称） ----------

// 清理 Windows 文件名非法字符与首尾点/空格
function sanitizeFileName(name: string): string {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .trim();
  return cleaned.slice(0, 50);
}

// 由存档推导 txt 文件名：有自定义存档名用之；否则自动档=自动存档.txt、手动槽=存档N.txt
export function defaultTxtNameFor(saveState: any, kind: "auto" | number): string {
  const custom = saveState?.saveName
    ? sanitizeFileName(String(saveState.saveName))
    : "";
  if (custom) return `${custom}.txt`;
  return kind === "auto" ? "自动存档.txt" : `存档${kind}.txt`;
}

// 每个槽位最近一次写入的文件名记录（改名/覆盖/删除时据此清理旧文件）
const TXT_NAMES_KEY = "trpg_txt_names";

type TxtNamesMap = { auto?: string; slots?: Record<string, string> };

function readTxtNames(): TxtNamesMap {
  try {
    return JSON.parse(localStorage.getItem(TXT_NAMES_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeTxtNames(map: TxtNamesMap): void {
  try {
    localStorage.setItem(TXT_NAMES_KEY, JSON.stringify(map));
  } catch {
    // 存不下则放弃追踪（旧文件最多残留一份）
  }
}

function getRecordedTxtName(kind: "auto" | number): string | undefined {
  const map = readTxtNames();
  return kind === "auto" ? map.auto : map.slots?.[String(kind)];
}

function setRecordedTxtName(
  kind: "auto" | number,
  fileName: string | undefined,
): void {
  const map = readTxtNames();
  if (kind === "auto") {
    if (fileName) map.auto = fileName;
    else delete map.auto;
  } else {
    map.slots = map.slots || {};
    if (fileName) map.slots[String(kind)] = fileName;
    else delete map.slots[String(kind)];
  }
  writeTxtNames(map);
}

function legacyFixedName(kind: "auto" | number): string {
  return kind === "auto" ? AUTO_SAVE_FILENAME : slotSaveFilename(Number(kind));
}

// 写入某个存档槽的 txt 镜像（自动清理旧名文件）。成功才更新记录。
export async function writeSlotSaveTxt(
  saveState: any,
  kind: "auto" | number,
): Promise<boolean> {
  const newName = defaultTxtNameFor(saveState, kind);
  const ok = await writeSaveTxt(newName, saveState);
  if (!ok) return false;
  const oldName = getRecordedTxtName(kind);
  setRecordedTxtName(kind, newName);
  // 清理可能遗留的其他文件名（改过名 / 旧版固定名）
  const stale = [oldName, legacyFixedName(kind)].filter(
    (n) => n && n !== newName,
  );
  const seen = new Set<string>();
  for (const n of stale) {
    if (seen.has(n)) continue;
    seen.add(n);
    await deleteSaveTxt(n);
  }
  return true;
}

// 删除某个存档槽的 txt 镜像（记录 + 默认名 + 旧版固定名都尝试）
export async function deleteSlotSaveTxt(kind: "auto" | number): Promise<void> {
  const candidates = [getRecordedTxtName(kind), legacyFixedName(kind)];
  const seen = new Set<string>();
  for (const n of candidates) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    await deleteSaveTxt(n);
  }
  setRecordedTxtName(kind, undefined);
}

// ---------- 导入 ----------

export interface ParsedSaveTxt {
  saveState: any;
}

export function parseSaveTxtContent(text: string): ParsedSaveTxt {
  const begin = text.indexOf(JSON_BEGIN);
  const end = text.indexOf(JSON_END, begin >= 0 ? begin : 0);
  if (begin < 0 || end < 0) {
    throw new Error("未找到存档数据区块（<<<LLMRPG_SAVE_JSON>>>），该 txt 可能不是本程序生成的存档文件。");
  }
  const jsonStr = text.slice(begin + JSON_BEGIN.length, end).trim();
  const saveState = JSON.parse(jsonStr);
  if (!saveState || typeof saveState !== "object" || !("character" in saveState)) {
    throw new Error("存档 JSON 区块解析成功但内容不完整（缺少 character）。");
  }
  return { saveState };
}

export async function parseSaveTxtFile(file: File): Promise<ParsedSaveTxt> {
  const text = await file.text();
  return parseSaveTxtContent(text);
}

// ---------- 回填同步 ----------

// 判断是否已关联过存档文件夹（用于 UI 提示，不弹任何窗）
export async function isSaveDirConfigured(): Promise<boolean> {
  return (await getStoredSaveDir()) != null;
}

// 把 localStorage 里现有的全部存档（自动 + 手动 1-9）回填写入已授权的文件夹，
// 适用于先存了档、后关联文件夹的场景。返回成功写入的文件数。
export async function syncAllSavesToFolder(): Promise<number> {
  try {
    const dir = await getWritableDir();
    if (!dir) return 0;
    const entries: Array<{ kind: "auto" | number; state: any }> = [];
    try {
      const autoRaw = localStorage.getItem("trpg_autosave");
      if (autoRaw) entries.push({ kind: "auto", state: JSON.parse(autoRaw) });
    } catch {
      // 自动存档损坏则跳过
    }
    for (let slot = 1; slot <= 9; slot++) {
      try {
        const raw = localStorage.getItem(`trpg_manual_save_${slot}`);
        if (raw) entries.push({ kind: slot, state: JSON.parse(raw) });
      } catch {
        // 单个槽损坏不影响其他槽
      }
    }
    let written = 0;
    for (const { kind, state } of entries) {
      const fileName = defaultTxtNameFor(state, kind);
      try {
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(buildSaveTxt(state));
        await writable.close();
        written++;
        const oldName = getRecordedTxtName(kind);
        setRecordedTxtName(kind, fileName);
        const stale = [oldName, legacyFixedName(kind)].filter(
          (n) => n && n !== fileName,
        );
        const seen = new Set<string>();
        for (const n of stale) {
          if (seen.has(n)) continue;
          seen.add(n);
          try {
            await dir.removeEntry(n);
          } catch {
            // 不存在则忽略
          }
        }
      } catch (err) {
        console.warn("[saveFile] 回填写入失败:", fileName, err);
      }
    }
    return written;
  } catch (err) {
    console.warn("[saveFile] 回填同步未执行:", err);
    return 0;
  }
}
