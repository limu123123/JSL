import React, { useState, useEffect, useRef } from "react";
import { saveAs } from "file-saver";
import { GameState, Character, HistoryTurn, TurnSnapshot, PERSONALITIES } from "./types";
import CharacterCreator from "./components/CharacterCreator";
import GameScreen from "./components/GameScreen";
import {
  buildSaveTxt,
  defaultTxtNameFor,
  deleteSlotSaveTxt,
  genreShortLabel,
  isSaveDirConfigured,
  syncAllSavesToFolder,
  isFileSystemAccessSupported,
  parseSaveTxtFile,
  pickSaveDirectory,
  writeSlotSaveTxt,
} from "./lib/saveFile";
import {
  Sparkles,
  Scroll,
  HelpCircle,
  Swords,
  FileText,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  Settings,
  Cpu,
  Download,
  Upload,
  Copy,
  Pencil,
  Trash2,
  History,
} from "lucide-react";

// ==================== 自动档防覆盖轮转（2026-10-30，用户反馈"打开其他存档时自动存档被覆盖、未保存的当次进度丢失"）====================
// 覆盖时刻 = 载入手动槽 / TXT·JSON 导入 / creator 完成（新开局或换世界观）进入游戏屏的瞬间——
// GameScreen 的自动存档 effect 一进场就会重写 trpg_autosave。此机制在覆盖发生前把现自动档内容原样存入
// trpg_autosave_backups（环形最多3份；同档后续覆盖只更新该档那一份），主页提供恢复/删除入口找回进度。
// 纯本地存档安全网（localStorage），与 AI API 无关、暂不随 JSON 备份导出/导入（后续可议）。
type AutoBackupMeta = {
  ts: number;
  reason: string;
  saveName: string;
  charName: string;
  genre: string;
  turnCount: number;
  raw: string;
};
const AUTO_BACKUPS_KEY = "trpg_autosave_backups";
const AUTO_BACKUPS_MAX = 3;

const readAutoBackups = (): AutoBackupMeta[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTO_BACKUPS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAutoBackups = (list: AutoBackupMeta[]): void => {
  try {
    localStorage.setItem(AUTO_BACKUPS_KEY, JSON.stringify(list));
  } catch {
    // 配额不足：丢最旧的再试；仍不行就清空备份区本身（不影响任何存档数据）
    try {
      localStorage.setItem(AUTO_BACKUPS_KEY, JSON.stringify(list.slice(-1)));
    } catch {
      try { localStorage.setItem(AUTO_BACKUPS_KEY, "[]"); } catch {}
    }
  }
};

export default function App() {
  // Navigation: "home" | "creator" | "game"
  const [currentScreen, setCurrentScreen] = useState<
    "home" | "creator" | "game"
  >("home");

  // Game configuration states
  const [activeGenre, setActiveGenre] = useState("");
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(
    null,
  );
  const [gmPersonality, setGmPersonality] = useState("Dramatic");
  const [activePersonality, setActivePersonality] = useState("Dramatic");
  const [activeInitialEvent, setActiveInitialEvent] = useState<any>(null);
  const [activeHistory, setActiveHistory] = useState<HistoryTurn[]>([]);
  const [activeLongTermHistory, setActiveLongTermHistory] = useState<string[]>(
    [],
  );
  const [activeTurnCount, setActiveTurnCount] = useState<number>(1);
  const [activeLastActionText, setActiveLastActionText] = useState<string>("");
  const [activeLastDiceRoll, setActiveLastDiceRoll] = useState<any>(null);
  const [activeTurnSnapshots, setActiveTurnSnapshots] = useState<TurnSnapshot[]>([]);
  const [activeFullStoryArchive, setActiveFullStoryArchive] = useState<HistoryTurn[]>([]);
  const [activePinnedMemo, setActivePinnedMemo] = useState<string>("");

  // Archive Slots
  const [hasAutosave, setHasAutosave] = useState(false);
  const [manualSaves, setManualSaves] = useState<(any | null)[]>(
    new Array(9).fill(null)
  );
  const [showArchivedSaves, setShowArchivedSaves] = useState(false);
  const [saveFolderReady, setSaveFolderReady] = useState<boolean>(false);
  const [saveFolderSupported] = useState<boolean>(() => isFileSystemAccessSupported());

  // Custom Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Input Prompt Dialog State（自绘输入弹窗，替代 window.prompt）
  const [promptDialog, setPromptDialog] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    defaultValue: string;
    confirmText?: string;
    onConfirm: (value: string) => void;
  }>({
    isOpen: false,
    title: "",
    defaultValue: "",
    onConfirm: () => {},
  });
  const [promptInputValue, setPromptInputValue] = useState("");
  const promptInputRef = useRef<HTMLInputElement>(null);

  // 进入创作者界面时预选的题材（null = 默认入口，不带预填）
  const [creatorGenrePrefill, setCreatorGenrePrefill] = useState<
    string | null
  >(null);

  // API settings states
  const [modelEngine, setModelEngine] = useState<"gemini" | "deepseek" | "openai">(
    "gemini",
  );
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [deepseekApiUrl, setDeepseekApiUrl] = useState(
    "https://api.deepseek.com",
  );
  const [deepseekModel, setDeepseekModel] = useState("deepseek-v4-pro");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiApiUrl, setOpenaiApiUrl] = useState("https://api.openai.com/v1");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiSaveSuccess, setApiSaveSuccess] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showDsKey, setShowDsKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [connCheckStatus, setConnCheckStatus] = useState<
    "idle" | "checking" | "success" | "error"
  >("idle");
  const [connCheckMsg, setConnCheckMsg] = useState("");

  // Load API config on mount
  useEffect(() => {
    try {
      const configStr = localStorage.getItem("trpg_api_config");
      if (configStr) {
        const config = JSON.parse(configStr);
        if (config.modelEngine) setModelEngine(config.modelEngine);
        if (config.geminiApiKey) setGeminiApiKey(config.geminiApiKey);
        if (config.deepseekApiKey) setDeepseekApiKey(config.deepseekApiKey);
        if (config.deepseekApiUrl) setDeepseekApiUrl(config.deepseekApiUrl);
        if (config.deepseekModel) setDeepseekModel(config.deepseekModel);
        if (config.openaiApiKey) setOpenaiApiKey(config.openaiApiKey);
        if (config.openaiApiUrl) setOpenaiApiUrl(config.openaiApiUrl);
        if (config.openaiModel) setOpenaiModel(config.openaiModel);
        if (config.gmPersonality) {
          setGmPersonality(config.gmPersonality);
          setActivePersonality(config.gmPersonality);
        }
      }
    } catch (e) {
      console.error("Error loading API config", e);
    }
  }, []);

  const handleSaveApiConfig = () => {
    try {
      const config = {
        modelEngine,
        geminiApiKey,
        deepseekApiKey,
        deepseekApiUrl: deepseekApiUrl || "https://api.deepseek.com",
        deepseekModel: deepseekModel || "deepseek-v4-pro",
        openaiApiKey,
        openaiApiUrl: openaiApiUrl || "https://api.openai.com/v1",
        openaiModel: openaiModel || "gpt-4o",
        gmPersonality,
      };
      localStorage.setItem("trpg_api_config", JSON.stringify(config));
      setActivePersonality(gmPersonality);
      setApiSaveSuccess(true);
      setTimeout(() => setApiSaveSuccess(false), 3000);
    } catch (err) {
      alert("保存设置失败，请检查浏览器存储权限。");
    }
  };

  const handleCheckConnection = async () => {
    setConnCheckStatus("checking");
    setConnCheckMsg("");
    try {
      const { checkConnectivity } = await import("./lib/api");
      const ok = await checkConnectivity({
        modelEngine,
        geminiApiKey,
        deepseekApiKey,
        deepseekApiUrl,
        deepseekModel,
        openaiApiKey,
        openaiApiUrl,
        openaiModel,
      });
      if (ok) {
        setConnCheckStatus("success");
        setConnCheckMsg("连接成功！引擎配置可用。");
      } else {
        setConnCheckStatus("error");
        setConnCheckMsg("连接失败：API 无有效返回。");
      }
    } catch (err: any) {
      setConnCheckStatus("error");
      setConnCheckMsg(err.message || "连接失败");
    }
  };

  // Check for saves on mount and when returning to home
  useEffect(() => {
    checkSaves();
  }, [currentScreen]);

  // 探测是否已关联过 TXT 存档文件夹（File System Access 句柄存于 IndexedDB）
  useEffect(() => {
    import("./lib/saveFile").then((m) => {
      m.getStoredSaveDir().then((h) => setSaveFolderReady(!!h));
    });
  }, []);

  const checkSaves = () => {
    try {
      const autosave = localStorage.getItem("trpg_autosave");
      setHasAutosave(!!autosave);

      // Migrate old manual save to slot 1 if exists
      const oldManualSave = localStorage.getItem("trpg_manual_save");
      if (oldManualSave && !localStorage.getItem("trpg_manual_save_1")) {
        localStorage.setItem("trpg_manual_save_1", oldManualSave);
        localStorage.removeItem("trpg_manual_save");
      }

      const newManualSaves = [];
      for (let i = 1; i <= 9; i++) {
        const slotData = localStorage.getItem(`trpg_manual_save_${i}`);
        newManualSaves.push(slotData ? JSON.parse(slotData) : null);
      }
      setManualSaves(newManualSaves);
      // 防覆盖备份区同步刷新（主页存档列表显示"自动档防覆盖备份"）
      setAutoBackups(readAutoBackups());
    } catch (e) {
      console.error("Error loading saves", e);
    }
  };

  // Launch from autosave
  const handleLoadAutosave = () => {
    try {
      const savedStr = localStorage.getItem("trpg_autosave");
      if (!savedStr) return;

      const savedState = JSON.parse(savedStr);
      setActiveGenre(savedState.genre);
      setActiveCharacter(savedState.character);
      setActivePersonality(savedState.gmPersonality || "Dramatic");
      setActiveHistory(savedState.history || []);
      setActiveLongTermHistory(savedState.longTermHistory || []);
      setActiveTurnCount(savedState.turnCount || 1);
      setActiveLastActionText(savedState.lastActionText || "");
      setActiveLastDiceRoll(savedState.lastDiceRoll || null);
      setActiveTurnSnapshots(savedState.turnSnapshots || []);
      setActiveFullStoryArchive(savedState.fullStoryArchive || []);
      setActivePinnedMemo(savedState.pinnedMemo || "");

      // Mimic an initial event format from current state
      setActiveInitialEvent({
        storyText: savedState.currentEventText,
        gmCommentary: savedState.currentGmCommentary,
        recommendedChoices: savedState.currentChoices,
        isGameOver: savedState.isGameOver,
        gameEndingType: savedState.gameEndingType,
      });

      setCurrentScreen("game");
    } catch (err) {
      alert("读取自动存档失败，存档可能已损坏。");
    }
  };

  // Launch from manual slot
  const handleLoadManualSave = (index: number) => {
    const saveData = manualSaves[index];
    if (!saveData) return;
    // 覆盖前保护：现自动档（可能是另一档未手动保存的进度）转入防覆盖备份区
    stashAutosaveBackup(`载入「${saveData.saveName || `存档 ${index + 1}`}」前`);
    try {
      setActiveGenre(saveData.genre);
      setActiveCharacter(saveData.character);
      setActivePersonality(saveData.gmPersonality || "Dramatic");
      setActiveHistory(saveData.history || []);
      setActiveLongTermHistory(saveData.longTermHistory || []);
      setActiveTurnCount(saveData.turnCount || 1);
      setActiveLastActionText(saveData.lastActionText || "");
      setActiveLastDiceRoll(saveData.lastDiceRoll || null);
      setActiveTurnSnapshots(saveData.turnSnapshots || []);
      setActiveFullStoryArchive(saveData.fullStoryArchive || []);
      setActivePinnedMemo(saveData.pinnedMemo || "");

      setActiveInitialEvent({
        storyText: saveData.currentEventText,
        gmCommentary: saveData.currentGmCommentary,
        recommendedChoices: saveData.currentChoices,
        isGameOver: saveData.isGameOver,
        gameEndingType: saveData.gameEndingType,
      });

      setCurrentScreen("game");
    } catch (err) {
      alert("读取手动存档失败。");
    }
  };

  // Start new setup
  const handleStartNewGame = () => {
    setCreatorGenrePrefill(null); // 主页入口不带预填
    setCurrentScreen("creator");
  };

  // 游戏内"换世界观"：跳转设定界面并预选当前世界观（角色从零开始）
  const handleChangeWorldview = () => {
    setConfirmDialog({
      isOpen: true,
      title: "更改世界观",
      message:
        "将跳转到世界观与角色设定界面：\n· 世界观预选为当前值（可改选其他）\n· 角色从零开始创建，开启全新一局\n\n当前游戏进度未保存的部分将丢失（可先点【保存进度】）。",
      confirmText: "前往设定界面",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        // 覆盖前保护：换世界观=角色从零开始、进游戏屏会重写自动存档——先转存现有进度
        stashAutosaveBackup("换世界观前");
        setCreatorGenrePrefill(activeGenre || null);
        setCurrentScreen("creator");
      },
    });
  };

  // Callback from CharacterCreator on completion
  const handleCreatorComplete = (
    genre: string,
    character: Character,
    initialEvent: any,
  ) => {
    // 覆盖前保护：开局新一局（含换世界观完成的共用回调）会重写自动存档——先转存现有进度
    stashAutosaveBackup("开局新一局前");
    setActiveGenre(genre);
    setActiveCharacter(character);
    setActivePersonality(gmPersonality);
    setActiveInitialEvent(initialEvent);
    setActiveHistory([]);
    setActiveLongTermHistory([]);
    setActiveTurnCount(1);
    setActiveLastActionText("");
    setActiveLastDiceRoll(null);
    setActiveTurnSnapshots([]);
    setActiveFullStoryArchive([]);
    setActivePinnedMemo("");
    setCurrentScreen("game");
  };

  // Delete saves
  const handleDeleteAllSaves = () => {
    setConfirmDialog({
      isOpen: true,
      title: "清除所有存档",
      message: "确定要删除所有本地游玩进度和存档吗？此操作无法撤销。",
      confirmText: "确定删除",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        localStorage.removeItem("trpg_autosave");
        for (let i = 1; i <= 9; i++) {
          localStorage.removeItem(`trpg_manual_save_${i}`);
        }
        // 同步删除 TXT 存档文件夹中的镜像文件
        deleteSlotSaveTxt("auto");
        for (let i = 1; i <= 9; i++) {
          deleteSlotSaveTxt(i);
        }
        setHasAutosave(false);
        setManualSaves(new Array(9).fill(null));
        checkSaves();
      },
    });
  };

  // ---------- 存档管理：改名 / 复制 / 删除 ----------

  const slotDisplayName = (saveData: any, index: number) =>
    saveData?.saveName || `存档 ${index + 1}`;

  const parseSlotJson = (slot: number) => {
    const raw = localStorage.getItem(`trpg_manual_save_${slot}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const persistSlot = (slot: number, saveData: any | null) => {
    if (saveData === null) {
      localStorage.removeItem(`trpg_manual_save_${slot}`);
    } else {
      localStorage.setItem(`trpg_manual_save_${slot}`, JSON.stringify(saveData));
    }
    const next = [...manualSaves];
    next[slot - 1] = saveData;
    setManualSaves(next);
    if (saveData !== null) {
      writeSlotSaveTxt(saveData, slot);
    } else {
      deleteSlotSaveTxt(slot);
    }
  };

  const firstFreeSlot = () => {
    for (let i = 1; i <= 9; i++) {
      if (!localStorage.getItem(`trpg_manual_save_${i}`)) return i;
    }
    return null;
  };

  // 改名（手动槽位）
  const handleRenameSave = (slot: number) => {
    const saveData = parseSlotJson(slot);
    if (!saveData) return;
    const currentName = saveData.saveName || slotDisplayName(saveData, slot - 1);
    setPromptInputValue(currentName);
    setPromptDialog({
      isOpen: true,
      title: "重命名存档",
      message: `当前名称：${currentName}`,
      defaultValue: currentName,
      confirmText: "保存名称",
      onConfirm: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        saveData.saveName = trimmed;
        persistSlot(slot, saveData);
        setPromptDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  // 复制存档：from 可为槽位号或 "autosave"
  const handleCopySave = (from: number | "autosave") => {
    const source =
      from === "autosave"
        ? (() => {
            try {
              return JSON.parse(localStorage.getItem("trpg_autosave") || "null");
            } catch {
              return null;
            }
          })()
        : parseSlotJson(from);
    if (!source) return;
    const target = firstFreeSlot();
    if (!target) {
      alert("9 个存档槽已满，没有空位可复制。");
      return;
    }
    const defaultName = `${source.saveName || (from === "autosave" ? "自动存档" : `存档 ${from}`)} 副本`;
    setPromptInputValue(defaultName);
    setPromptDialog({
      isOpen: true,
      title: "复制存档",
      message: `将复制到空槽位 ${target}，请为副本命名：`,
      defaultValue: defaultName,
      confirmText: "复制",
      onConfirm: (value) => {
        const copy = { ...source, saveName: value.trim() || defaultName };
        persistSlot(target, copy);
        setPromptDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  // 删除单个手动存档
  const handleDeleteSave = (slot: number) => {
    const saveData = parseSlotJson(slot);
    if (!saveData) return;
    setConfirmDialog({
      isOpen: true,
      title: "删除存档",
      message: `确定删除【${slotDisplayName(saveData, slot - 1)}】（${saveData.character?.name || "未命名"}）吗？此操作无法撤销。`,
      confirmText: "确定删除",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        persistSlot(slot, null);
      },
    });
  };

  // 删除自动存档
  const handleDeleteAutosave = () => {
    setConfirmDialog({
      isOpen: true,
      title: "删除自动存档",
      message: "确定删除自动存档吗？此操作无法撤销。",
      confirmText: "确定删除",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        localStorage.removeItem("trpg_autosave");
        deleteSlotSaveTxt("auto");
        setHasAutosave(false);
        checkSaves();
      },
    });
  };

  // 授权（或重新授权）TXT 自动存档文件夹
  const handlePickSaveFolder = async () => {
    try {
      const handle = await pickSaveDirectory();
      setSaveFolderReady(!!handle);
      // 回填：把 localStorage 里已有的全部存档（自动 + 手动）写入刚授权的文件夹
      const synced = await syncAllSavesToFolder();
      alert(
        `存档文件夹已关联！之后每回合生成、编辑、手动保存都会自动同步更新对应的 TXT 文件。\n\n本次回填写入 ${synced} 个已有存档文件（自动存档 + 手动槽；空槽跳过）。\n\n注意：浏览器重启后首次游玩时，点击该按钮可恢复读写权限并自动回填。`,
      );
    } catch (err: any) {
      if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return;
      alert(err.message || "选择文件夹失败。");
    }
  };

  // 从 TXT 存档文件导入（读取 <<<LLMRPG_SAVE_JSON>>> 区块）
  const handleImportTxtSave = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const { saveState } = await parseSaveTxtFile(file);
      setConfirmDialog({
        isOpen: true,
        title: "导入 TXT 存档",
        message: `读取到存档：\n题材【${genreShortLabel(saveState.genre, 20)}】 角色【${saveState.character?.name || "未命名"}】 回合 ${saveState.turnCount ?? 1}\n\n确定导入吗？将覆盖当前的自动存档位（主界面可通过【继续上次的自动存档】进入）。`,
        confirmText: "导入",
        cancelText: "取消",
        onConfirm: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          // 覆盖前保护：现自动档先转入防覆盖备份区再被导入内容覆盖
          stashAutosaveBackup("导入TXT存档前");
          const json = JSON.stringify(saveState);
          localStorage.setItem("trpg_autosave", json);
          writeSlotSaveTxt(saveState, "auto");
          setHasAutosave(true);
          alert("TXT 存档导入成功！");
        },
      });
    } catch (err: any) {
      alert("导入失败：" + (err.message || err));
    }
  };

  // 手动保存 TXT：把当前自动存档通过系统"另存为"对话框导出为 TXT 文件
  const handleExportCurrentTxt = async () => {
    try {
      const raw = localStorage.getItem("trpg_autosave");
      if (!raw) {
        alert("当前没有自动存档可导出（先游玩一局即可）。");
        return;
      }
      const saveState = JSON.parse(raw);
      const fileName = defaultTxtNameFor(saveState, "auto");
      // 优先使用系统"另存为"对话框（Chrome / Edge 支持）
      if (isFileSystemAccessSupported() && (window as any).showSaveFilePicker) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: "LLMRPG 存档",
                accept: { "text/plain": [".txt"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(buildSaveTxt(saveState));
          await writable.close();
          return;
        } catch (err: any) {
          if (err && err.name === "AbortError") return; // 用户取消了另存为
          // 其余异常降级为浏览器下载
        }
      }
      const blob = new Blob([buildSaveTxt(saveState)], {
        type: "text/plain;charset=utf-8",
      });
      saveAs(blob, fileName);
    } catch (err: any) {
      alert("导出 TXT 失败：" + (err?.message || err));
    }
  };

  // ==================== 自动档防覆盖轮转（组件侧处理，见文件顶部机制说明）====================
  const [autoBackups, setAutoBackups] = useState<AutoBackupMeta[]>(() =>
    readAutoBackups(),
  );
  const [showAutoBackups, setShowAutoBackups] = useState(false);

  // 覆盖前调用：把现 trpg_autosave 转入备份栈（同档已有备份时用最新一份替换；内容一字未变则跳过）
  const stashAutosaveBackup = (reason: string): void => {
    try {
      const raw = localStorage.getItem("trpg_autosave");
      if (!raw) return;
      let state: any = null;
      try {
        state = JSON.parse(raw);
      } catch {
        return;
      }
      const meta: AutoBackupMeta = {
        ts: Date.now(),
        reason,
        saveName: state?.saveName || "自动存档",
        charName: state?.character?.name || "未命名",
        genre: state?.genre || "",
        turnCount: state?.turnCount ?? 1,
        raw,
      };
      const prev = readAutoBackups();
      const identity = (b: AutoBackupMeta) => `${b.saveName}|${b.charName}`;
      if (prev.some((b) => b.raw === meta.raw)) return; // 内容未变（如同档反复读卡），不入栈
      const sameDocIdx = prev.findIndex(
        (b) => identity(b) === identity(meta),
      );
      const next = (
        sameDocIdx >= 0
          ? prev.map((b, i) => (i === sameDocIdx ? meta : b))
          : [...prev, meta]
      ).slice(-AUTO_BACKUPS_MAX);
      writeAutoBackups(next);
      setAutoBackups(next);
    } catch {}
  };

  // 恢复某条备份：写回自动存档槽（confirmDialog 二次确认；现自动档也对称转入备份栈）
  const handleRestoreAutoBackup = (index: number) => {
    const backup = autoBackups[index];
    if (!backup) return;
    setConfirmDialog({
      isOpen: true,
      title: "恢复到自动存档",
      message: `将把备份「${backup.saveName} · ${backup.charName} · 第${backup.turnCount}回合」写回自动存档位。\n\n当前自动存档内的内容也会先转入本备份区（不会硬丢）。\n\n恢复后可回主页用【继续上次的自动存档】进入。`,
      confirmText: "恢复",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          stashAutosaveBackup("恢复备份前");
          localStorage.setItem("trpg_autosave", backup.raw);
          try {
            writeSlotSaveTxt(JSON.parse(backup.raw), "auto");
          } catch {}
          setHasAutosave(true);
          // 已恢复的条目从备份区移除（按 ts 精确匹配，避免误删同时新增的条目）
          const cur = readAutoBackups();
          const removed = cur.filter((b) => b.ts !== backup.ts);
          writeAutoBackups(removed);
          setAutoBackups(removed);
          checkSaves();
        } catch {}
      },
    });
  };

  // 删除某条备份
  const handleDeleteAutoBackup = (index: number) => {
    const backup = autoBackups[index];
    if (!backup) return;
    setConfirmDialog({
      isOpen: true,
      title: "删除备份",
      message: `确定删除备份「${backup.saveName} · ${backup.charName} · 第${backup.turnCount}回合」？删除后不可找回。`,
      confirmText: "删除",
      cancelText: "取消",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        const next = autoBackups.filter((_, i) => i !== index);
        writeAutoBackups(next);
        setAutoBackups(next);
      },
    });
  };

  // ==================== 共享存档（局域网服务器槽，2026-10-28）====================
  // 说明：请求打向本游戏自己服务器的 /api/shared-saves/*（vite.config.ts 内置插件），与 AI API 无关。
  const [showSharedSaves, setShowSharedSaves] = useState(false);
  const [sharedSaves, setSharedSaves] = useState<
    Array<{ name: string; turn: number | null; charName: string; saveDate: string; mtime: number }>
  >([]);
  const [sharedSlotPick, setSharedSlotPick] = useState(0); // 0=自动存档，1-9=手动槽
  const [sharedBusy, setSharedBusy] = useState(false);

  const sharedSlotKey = (pick: number) =>
    pick === 0 ? "trpg_autosave" : `trpg_manual_save_${pick}`;
  const sharedSlotLabel = (pick: number) =>
    pick === 0 ? "自动存档" : `存档${pick}`;

  const handleSharedRefresh = async () => {
    try {
      const res = await fetch("/api/shared-saves/list");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSharedSaves(Array.isArray(data?.saves) ? data.saves : []);
    } catch (err: any) {
      setSharedSaves([]);
      alert(
        "读取服务器共享存档失败：" +
          (err.message || err) +
          "\n\n提示：本功能需要通过 启动_局域网.cmd 启动的开发服务器（端口 5174）访问本页。",
      );
    }
  };

  const handleSharedUpload = async () => {
    if (sharedBusy) return;
    let slotRaw: string | null = null;
    try {
      slotRaw = localStorage.getItem(sharedSlotKey(sharedSlotPick));
    } catch {}
    if (!slotRaw) {
      alert(`「${sharedSlotLabel(sharedSlotPick)}」还是空的，先在游戏里存档再上传。`);
      return;
    }
    let slotObj: any = null;
    try {
      slotObj = JSON.parse(slotRaw);
    } catch {
      alert("该槽位数据损坏，无法上传。");
      return;
    }
    const defaultName =
      String(slotObj?.saveName || "").trim() ||
      `${sharedSlotLabel(sharedSlotPick)}·${slotObj?.character?.name || "未命名"}·第${slotObj?.turnCount ?? 1}回合`;
    const nameInput = window.prompt(
      "上传到服务器的存档名（服务器上同名旧档会被覆盖）：",
      defaultName,
    );
    if (!nameInput) return;
    setSharedBusy(true);
    try {
      const res = await fetch("/api/shared-saves/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput, json: slotRaw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await handleSharedRefresh();
      alert(
        `已上传「${nameInput}」到服务器共享存档！\n局域网里其他电脑刷新主页即可在共享存档区看到它。`,
      );
    } catch (err: any) {
      alert("上传失败：" + (err.message || err));
    } finally {
      setSharedBusy(false);
    }
  };

  const handleSharedLoad = (name: string) => {
    setSharedBusy(true);
    fetch(`/api/shared-saves/load?name=${encodeURIComponent(name)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const json = typeof data?.json === "string" ? data.json : "";
        const slotObj = JSON.parse(json);
        setConfirmDialog({
          isOpen: true,
          title: "从服务器拉回共享存档",
          message: `读取到共享存档：\n存档名【${name}】 题材【${genreShortLabel(slotObj?.genre, 20)}】 角色【${slotObj?.character?.name || "未命名"}】 回合 ${slotObj?.turnCount ?? 1}\n\n确定拉回吗？将覆盖本机的自动存档位（主界面可通过【继续上次的自动存档】进入）。`,
          confirmText: "拉回",
          cancelText: "取消",
          onConfirm: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            localStorage.setItem("trpg_autosave", json);
            writeSlotSaveTxt(slotObj, "auto");
            setHasAutosave(true);
            alert("共享存档已拉回本机自动存档位！");
          },
        });
      })
      .catch((err) => alert("拉取失败：" + (err?.message || err)))
      .finally(() => setSharedBusy(false));
  };

  const handleSharedDelete = (name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "删除服务器共享存档",
      message: `确定删除服务器上的「${name}」吗？\n删除后所有局域网玩家都无法再拉回它。`,
      confirmText: "删除",
      cancelText: "取消",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch("/api/shared-saves/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          await handleSharedRefresh();
        } catch (err: any) {
          alert("删除失败：" + (err.message || err));
        }
      },
    });
  };

  // Export saves
  const handleExportSaves = () => {
    try {
      const autosave = localStorage.getItem("trpg_autosave");
      const apiConfig = localStorage.getItem("trpg_api_config");
      const setupTemplates = localStorage.getItem("trpg_setup_templates");
      
      const manualSavesExport: Record<string, string | null> = {};
      for (let i = 1; i <= 9; i++) {
        manualSavesExport[`trpg_manual_save_${i}`] = localStorage.getItem(`trpg_manual_save_${i}`);
      }

      const backupData = {
        type: "ai_trpg_backup",
        version: "1.2",
        exportedAt: new Date().toISOString(),
        saves: {
          trpg_autosave: autosave,
          trpg_api_config: apiConfig,
          trpg_setup_templates: setupTemplates,
          ...manualSavesExport
        },
      };

      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: "application/json;charset=utf-8" });
      const exportFileDefaultName = `ai_trpg_backup_${new Date().toISOString().slice(0, 10)}.json`;

      saveAs(blob, exportFileDefaultName);
    } catch (err) {
      alert("导出存档失败：" + err);
    }
  };

  // Import saves
  const handleImportSaves = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const file = event.target.files?.[0];
    if (!file) return;

    fileReader.onload = (e) => {
      try {
        const content = e.target?.result;
        if (typeof content !== "string") return;

        const parsed = JSON.parse(content);
        if (parsed.type !== "ai_trpg_backup" && !parsed.saves) {
          alert("导入失败：该文件不是合法的 AI 跑团存档备份文件。");
          return;
        }

        const saves = parsed.saves;
        let importedCount = 0;

        if (saves.trpg_autosave) {
          // 覆盖前保护：现有自动档先转入防覆盖备份区，再被备份文件里的自动档覆盖
          stashAutosaveBackup("导入JSON备份前");
          localStorage.setItem("trpg_autosave", saves.trpg_autosave);
          // 同步刷新 TXT 存档镜像
          try { writeSlotSaveTxt(JSON.parse(saves.trpg_autosave), "auto"); } catch {}
          importedCount++;
        }
        
        // Import old manual save format
        if (saves.trpg_manual_save) {
          localStorage.setItem("trpg_manual_save_1", saves.trpg_manual_save);
          try { writeSlotSaveTxt(JSON.parse(saves.trpg_manual_save), 1); } catch {}
          importedCount++;
        }
        
        // Import new manual save format
        for (let i = 1; i <= 9; i++) {
          if (saves[`trpg_manual_save_${i}`]) {
            localStorage.setItem(`trpg_manual_save_${i}`, saves[`trpg_manual_save_${i}`]);
            try { writeSlotSaveTxt(JSON.parse(saves[`trpg_manual_save_${i}`]), i); } catch {}
            importedCount++;
          }
        }
        if (saves.trpg_api_config) {
          localStorage.setItem("trpg_api_config", saves.trpg_api_config);
          try {
            const config = JSON.parse(saves.trpg_api_config);
            if (config.engine) setModelEngine(config.engine);
            if (config.geminiApiKey) setGeminiApiKey(config.geminiApiKey);
            if (config.deepseekApiKey) setDeepseekApiKey(config.deepseekApiKey);
            if (config.deepseekModel) setDeepseekModel(config.deepseekModel);
          } catch (e) {}
        }

        // 恢复开局配置模板库（如果有）
        if (typeof saves.trpg_setup_templates === "string" && saves.trpg_setup_templates) {
          localStorage.setItem("trpg_setup_templates", saves.trpg_setup_templates);
        }

        if (importedCount > 0) {
          setConfirmDialog({
            isOpen: true,
            title: "导入存档成功",
            message: `成功导入了 ${importedCount} 个存档插槽${saves.trpg_api_config ? "，已恢复 API 接入配置" : ""}${saves.trpg_setup_templates ? "，已恢复开局模板库" : ""}！你可以继续上次的冒险了。`,
            confirmText: "太好了",
            onConfirm: () => {
              setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
              checkSaves();
            },
          });
          checkSaves();
        } else {
          alert("未在备份文件中找到可导入的有效存档。");
        }
      } catch (err) {
        alert("导入存档解析失败：" + err);
      }
    };

    fileReader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans selection:bg-amber-200 selection:text-amber-900">
      {/* Top beautiful nav banner */}
      <header className="border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-900/60 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => setCurrentScreen("home")}
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-zinc-950 font-serif font-extrabold text-lg shadow-inner">
              魂
            </div>
            <span className="font-serif font-extrabold tracking-tight text-lg text-zinc-900 dark:text-zinc-50">
              AI 跑团模拟器
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold">
            {currentScreen !== "home" && (
              <button
                onClick={() => setCurrentScreen("home")}
                className="text-zinc-500 hover:text-amber-800 dark:hover:text-amber-400 transition-colors"
              >
                主页大厅
              </button>
            )}
            <button
              onClick={() => {
                if (currentScreen !== "home") setCurrentScreen("home");
                setShowApiSettings(true);
              }}
              className="text-zinc-600 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 flex items-center gap-1 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>系统设置</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main body content area */}
      <main className="flex-1 flex flex-col justify-center">
        {currentScreen === "home" && (
          <div
            className="max-w-4xl mx-auto px-6 py-12 space-y-12 animate-fadeIn"
            id="home-screen"
          >
            {/* HERO LANDING SLIDE */}
            <div className="text-center max-w-2xl mx-auto pb-2">
              <h1 className="font-serif text-5xl md:text-6xl font-extrabold tracking-tight text-amber-900 dark:text-amber-500 leading-tight">
                掌握你自己的命运
              </h1>
            </div>

            {/* ACTION TRIGGERS PANEL */}
            <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-lg max-w-xl mx-auto space-y-4">
              <button
                onClick={handleStartNewGame}
                className="w-full py-4 px-6 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-extrabold rounded-2xl transition-all shadow-md hover:shadow-lg flex items-center justify-between group text-sm"
              >
                <div className="flex items-center gap-3">
                  <Swords className="w-5 h-5 text-zinc-950" />
                  <span>开启全新跑团冒险</span>
                </div>
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>

              {hasAutosave && (
                <button
                  onClick={handleLoadAutosave}
                  className="w-full py-4 px-6 bg-zinc-100 dark:bg-zinc-850 hover:bg-amber-50 dark:hover:bg-amber-950/20 text-zinc-800 dark:text-zinc-200 font-extrabold rounded-2xl transition-all border border-zinc-200 dark:border-zinc-800 flex items-center justify-between group text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Scroll className="w-5 h-5 text-amber-600" />
                    <span>继续上次的自动存档</span>
                  </div>
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>
              )}

              {manualSaves.map((saveData, index) => {
                if (!saveData) return null;
                const slot = index + 1;
                return (
                  <div
                    key={index}
                    className="w-full bg-zinc-100 dark:bg-zinc-850 text-zinc-800 dark:text-zinc-200 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                  >
                    <button
                      onClick={() => handleLoadManualSave(index)}
                      className="w-full py-4 px-6 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-all flex items-center justify-between group text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-amber-600 shrink-0" />
                        <span className="text-left">
                          <span className="font-extrabold">{saveData.saveName || `载入手动存档 ${slot}`}</span>
                          <span
                            className="text-zinc-500 font-normal"
                            title={saveData.genre}
                          >
                            （{saveData.character?.name} - {genreShortLabel(saveData.genre)}）
                          </span>
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </button>
                    <div className="flex border-t border-zinc-200 dark:border-zinc-800 divide-x divide-zinc-200 dark:divide-zinc-800">
                      <button
                        onClick={() => handleRenameSave(slot)}
                        className="flex-1 py-1.5 text-[11px] font-semibold text-zinc-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors flex items-center justify-center gap-1"
                        title="重命名此存档"
                      >
                        <Pencil className="w-3 h-3" />
                        改名
                      </button>
                      <button
                        onClick={() => handleCopySave(slot)}
                        className="flex-1 py-1.5 text-[11px] font-semibold text-zinc-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors flex items-center justify-center gap-1"
                        title="复制此存档到空槽位"
                      >
                        <Copy className="w-3 h-3" />
                        复制
                      </button>
                      <button
                        onClick={() => handleDeleteSave(slot)}
                        className="flex-1 py-1.5 text-[11px] font-semibold text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center justify-center gap-1"
                        title="删除此存档"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* SAVE MANAGEMENT COLLAPSIBLE */}
              <div className="pt-2 text-center">
                <button
                  onClick={() => setShowArchivedSaves(!showArchivedSaves)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 font-semibold inline-flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {showArchivedSaves
                    ? "隐藏存档与备份管理"
                    : "显示存档与备份管理"}
                </button>

                {showArchivedSaves && (
                  <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-left space-y-3 animate-fadeIn text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-500">
                        自动存档状态:
                      </span>
                      <span className="flex items-center gap-2">
                        {hasAutosave && (
                          <>
                            <button
                              onClick={() => handleCopySave("autosave")}
                              className="px-2 py-0.5 text-[10px] font-semibold text-zinc-500 hover:text-amber-600 bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded transition-colors flex items-center gap-1"
                              title="把自动存档复制到一个空的存档槽"
                            >
                              <Copy className="w-3 h-3" />
                              复制到空槽
                            </button>
                            <button
                              onClick={handleDeleteAutosave}
                              className="px-2 py-0.5 text-[10px] font-semibold text-zinc-500 hover:text-red-600 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors flex items-center gap-1"
                              title="删除自动存档"
                            >
                              <Trash2 className="w-3 h-3" />
                              删除
                            </button>
                          </>
                        )}
                        <span
                          className={
                            hasAutosave
                              ? "text-green-600 font-bold"
                              : "text-zinc-400"
                          }
                        >
                          {hasAutosave ? "已就绪" : "无数据"}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-2">
                      <span className="font-bold text-zinc-500">
                        手动存档数量:
                      </span>
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {manualSaves.filter(s => s !== null).length} / 9
                      </span>
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                      <button
                        onClick={handlePickSaveFolder}
                        className={`flex-1 py-2 rounded-lg font-bold text-center transition-colors flex items-center justify-center gap-1 ${
                          saveFolderReady
                            ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                            : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                        }`}
                        title="授权一个本地文件夹后，每回合生成、编辑、重新生成、手动保存都会自动同步更新为 TXT 存档文件（需 Chrome/Edge）"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {saveFolderReady
                          ? "TXT存档文件夹：已关联"
                          : "关联TXT存档文件夹"}
                      </button>
                      <label
                        className="flex-1 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-bold text-center transition-colors flex items-center justify-center gap-1 cursor-pointer"
                        title="从本程序生成的 TXT 存档文件导入（读取其设定区块）"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        导入TXT存档
                        <input
                          type="file"
                          accept=".txt"
                          onChange={handleImportTxtSave}
                          className="hidden"
                        />
                      </label>
                      <button
                        onClick={handleExportCurrentTxt}
                        className="flex-1 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-bold text-center transition-colors flex items-center justify-center gap-1"
                        title="把当前自动存档的手动导出为 TXT 文件（弹出保存对话框，可自选位置与文件名）"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        手动保存TXT
                      </button>
                    </div>
                    {!saveFolderSupported && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-relaxed">
                        当前浏览器不支持静默写入文件夹（ 需要 Chrome / Edge ），TXT 存档文件夹功能不可用。
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleExportSaves}
                        disabled={!hasAutosave && manualSaves.every(s => s === null)}
                        className="flex-1 py-2 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 disabled:hover:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg font-bold text-center transition-colors flex items-center justify-center gap-1"
                        title="导出所有游玩数据为 JSON 备份文件"
                      >
                        <Download className="w-3.5 h-3.5" />
                        导出备份
                      </button>
                      <label className="flex-1 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-bold text-center transition-colors flex items-center justify-center gap-1 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        导入备份
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImportSaves}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* 自动档防覆盖备份（2026-10-30：读其他档/导入/开新档覆盖自动档之前，未保存的进度自动暂存于此） */}
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-900 space-y-2">
                      <button
                        onClick={() => setShowAutoBackups((v) => !v)}
                        className="w-full py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg font-bold text-[11px] text-center transition-colors flex items-center justify-center gap-1.5"
                        title="载入其他存档、导入TXT/JSON备份、或开新一局之前，若自动存档里有未手动保存的进度，会自动暂存到此（最多3份，同档只留最新一份）——找回来了就点「恢复到自动存档」。"
                      >
                        <History className="w-3.5 h-3.5" />
                        {showAutoBackups
                          ? "收起自动档防覆盖备份"
                          : `自动档防覆盖备份（${autoBackups.length}）`}
                      </button>

                      {showAutoBackups && (
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs animate-fadeIn">
                          {autoBackups.length === 0 ? (
                            <p className="text-[10px] text-zinc-400 leading-relaxed text-center py-2">
                              暂无备份。
                              <br />
                              以后载入其他存档、导入TXT/JSON备份、或开新一局时，若自动存档里有另一档的进度，会先自动暂存到这里（最多3份），再也不怕忘了手动保存。
                            </p>
                          ) : (
                            autoBackups.map((b, i) => (
                              <div
                                key={b.ts}
                                className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className="font-bold text-zinc-800 dark:text-zinc-200 text-[11px] truncate cursor-help"
                                    title={`存档名：${b.saveName}\n角色：${b.charName}${b.genre ? `\n题材：${b.genre}` : ""}`}
                                  >
                                    {b.saveName} · {b.charName} · 第
                                    {b.turnCount}回合
                                  </span>
                                  <button
                                    onClick={() => handleDeleteAutoBackup(i)}
                                    title="删除此备份"
                                    className="p-0.5 text-zinc-300 hover:text-red-500 transition-colors cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className="text-[10px] text-zinc-400">
                                  {b.reason} · {new Date(b.ts).toLocaleString()}
                                </div>
                                <button
                                  onClick={() => handleRestoreAutoBackup(i)}
                                  className="w-full py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-md font-bold text-[10px] transition-colors"
                                >
                                  恢复到自动存档
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* SHARED SAVES ON LAN SERVER（局域网共享存档，2026-10-28） */}
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-900 space-y-2">
                      <button
                        onClick={() => {
                          const opening = !showSharedSaves;
                          setShowSharedSaves(opening);
                          if (opening) handleSharedRefresh();
                        }}
                        className="w-full py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg font-bold text-[11px] text-center transition-colors flex items-center justify-center gap-1.5"
                        title="把存档上传到游戏服务器（项目目录 shared_saves 文件夹），局域网里任何一台电脑的浏览器都能拉回继续玩。无鉴权，家庭局域网信任模型。"
                      >
                        <Scroll className="w-3.5 h-3.5" />
                        {showSharedSaves ? "收起共享存档（服务器/局域网）" : "共享存档（服务器/局域网）"}
                      </button>

                      {showSharedSaves && (
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs animate-fadeIn">
                          <div className="flex gap-1.5 items-center">
                            <select
                              value={sharedSlotPick}
                              onChange={(e) => setSharedSlotPick(parseInt(e.target.value, 10))}
                              className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 text-[11px] cursor-pointer"
                            >
                              <option value={0}>来源：自动存档</option>
                              {Array.from({ length: 9 }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                  来源：手动槽 存档{i + 1}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={handleSharedUpload}
                              disabled={sharedBusy}
                              className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 text-amber-700 dark:text-amber-400 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              上传到服务器
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="font-bold text-zinc-500">
                              服务器上的共享档（{sharedSaves.length}）：
                            </span>
                            <button
                              onClick={handleSharedRefresh}
                              className="text-[10px] text-zinc-500 hover:text-amber-600 font-semibold flex items-center gap-0.5 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                              刷新
                            </button>
                          </div>

                          {sharedSaves.length === 0 ? (
                            <p className="text-[10px] text-zinc-400 text-center py-2 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
                              服务器上暂无共享存档（主机玩家上传后，其他电脑点开这里刷新即可看到）
                            </p>
                          ) : (
                            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                              {sharedSaves.map((s) => (
                                <div
                                  key={s.name}
                                  className="flex items-center justify-between gap-2 bg-white dark:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-zinc-800 dark:text-zinc-200 truncate text-[11px]">
                                      {s.name}
                                    </div>
                                    <div className="text-[9px] text-zinc-400 truncate">
                                      {s.charName || "未命名"} · 第{s.turn ?? "?"}回合 ·{" "}
                                      {s.saveDate || new Date(s.mtime).toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="flex gap-1 shrink-0">
                                    <button
                                      onClick={() => handleSharedLoad(s.name)}
                                      disabled={sharedBusy}
                                      className="px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 text-emerald-700 dark:text-emerald-400 rounded text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                                      title="拉回本机：覆盖本机自动存档位"
                                    >
                                      <Download className="w-3 h-3" />
                                      拉回
                                    </button>
                                    <button
                                      onClick={() => handleSharedDelete(s.name)}
                                      className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded text-[10px] font-bold cursor-pointer"
                                      title="删除服务器上的这份共享档（影响所有玩家）"
                                    >
                                      删除
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <p className="text-[10px] text-zinc-400 leading-relaxed">
                            同名上传会覆盖旧档；拉回 = 覆盖本机自动存档位；删除影响所有玩家。局域网内无鉴权，仅限可信网络使用。
                          </p>
                        </div>
                      )}
                    </div>

                    {(hasAutosave || manualSaves.some(s => s !== null)) && (
                      <button
                        onClick={handleDeleteAllSaves}
                        className="w-full mt-2 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg font-bold text-center transition-colors block"
                      >
                        清空所有本地数据
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* SYSTEM AND API ENGINE CONFIGURATION */}
              <div className="pt-2 text-center border-t border-zinc-100 dark:border-zinc-800/60 mt-4 pt-4">
                <button
                  onClick={() => setShowApiSettings(!showApiSettings)}
                  className="text-xs text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 font-semibold inline-flex items-center gap-1.5"
                >
                  <Settings className="w-3.5 h-3.5" />
                  {showApiSettings
                    ? "收起系统设置"
                    : "系统设置（主持人人设与接口配置）"}
                </button>

                {showApiSettings && (
                  <div className="mt-4 p-5 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-left space-y-5 animate-fadeIn text-xs">
                    {/* GM PERSONALITY SECTION */}
                    <div className="space-y-2.5 pb-4 border-b border-zinc-200 dark:border-zinc-850">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">
                          跑团主持人 (GM) 叙事风格
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        全局指定 AI 主持人的行文风格与叙事调性，可在游玩前或游玩中随时生效。
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        {PERSONALITIES.map((pers) => {
                          const isSelected = gmPersonality === pers.id;
                          return (
                            <div
                              key={pers.id}
                              onClick={() => setGmPersonality(pers.id)}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                isSelected
                                  ? "border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-300 shadow-sm"
                                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-400 bg-white dark:bg-zinc-900"
                              }`}
                            >
                              <div className="text-xs font-bold mb-1 flex items-center justify-between">
                                <span>{pers.name}</span>
                                {isSelected && (
                                  <span className="text-[10px] bg-amber-500 text-zinc-950 px-1.5 py-0.2 rounded font-bold">
                                    选用中
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                {pers.desc}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* AI ENGINE SECTION */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 pb-1 border-b border-zinc-150 dark:border-zinc-900">
                        <Cpu className="w-4 h-4 text-amber-500" />
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          大模型引擎配置
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                          选择 AI 引擎
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setModelEngine("gemini")}
                            className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                              modelEngine === "gemini"
                                ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/15 text-amber-800 dark:text-amber-400"
                                : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            }`}
                          >
                            Gemini 引擎
                          </button>
                          <button
                            type="button"
                            onClick={() => setModelEngine("deepseek")}
                            className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                              modelEngine === "deepseek"
                                ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/15 text-amber-800 dark:text-amber-400"
                                : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            }`}
                          >
                            DeepSeek 引擎
                          </button>
                          <button
                            type="button"
                            onClick={() => setModelEngine("openai")}
                            className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                              modelEngine === "openai"
                                ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/15 text-amber-800 dark:text-amber-400"
                                : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            }`}
                          >
                            OpenAI 引擎
                          </button>
                        </div>
                      </div>

                      {modelEngine === "deepseek" ? (
                        <div className="space-y-3 pt-1 animate-fadeIn">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              DeepSeek 接口密钥
                            </label>
                            <div className="relative">
                              <input
                                type={showDsKey ? "text" : "password"}
                                value={deepseekApiKey}
                                onChange={(e) =>
                                  setDeepseekApiKey(e.target.value)
                                }
                                placeholder="sk-..."
                                className="w-full text-xs p-2.5 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                              <button
                                type="button"
                                onClick={() => setShowDsKey(!showDsKey)}
                                className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                              >
                                {showDsKey ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              接口节点请求地址
                            </label>
                            <input
                              type="text"
                              value={deepseekApiUrl}
                              onChange={(e) => setDeepseekApiUrl(e.target.value)}
                              placeholder="https://api.deepseek.com"
                              className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              模型代号
                            </label>
                            <input
                              type="text"
                              value={deepseekModel}
                              onChange={(e) => setDeepseekModel(e.target.value)}
                              placeholder="deepseek-v4-pro"
                              className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>
                        </div>
                      ) : modelEngine === "openai" ? (
                        <div className="space-y-3 pt-1 animate-fadeIn">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              OpenAI 接口密钥
                            </label>
                            <div className="relative">
                              <input
                                type={showOpenaiKey ? "text" : "password"}
                                value={openaiApiKey}
                                onChange={(e) =>
                                  setOpenaiApiKey(e.target.value)
                                }
                                placeholder="sk-..."
                                className="w-full text-xs p-2.5 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                              <button
                                type="button"
                                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                                className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                              >
                                {showOpenaiKey ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              接口节点请求地址
                            </label>
                            <input
                              type="text"
                              value={openaiApiUrl}
                              onChange={(e) => setOpenaiApiUrl(e.target.value)}
                              placeholder="https://api.openai.com/v1"
                              className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              模型代号
                            </label>
                            <input
                              type="text"
                              value={openaiModel}
                              onChange={(e) => setOpenaiModel(e.target.value)}
                              placeholder="gpt-4o"
                              className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 pt-1 animate-fadeIn">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                              Gemini 接口密钥
                            </label>
                            <div className="relative">
                              <input
                                type={showGeminiKey ? "text" : "password"}
                                value={geminiApiKey}
                                onChange={(e) => setGeminiApiKey(e.target.value)}
                                placeholder="AIza..."
                                className="w-full text-xs p-2.5 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                              <button
                                type="button"
                                onClick={() => setShowGeminiKey(!showGeminiKey)}
                                className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                              >
                                {showGeminiKey ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-1">
                              可前往官方平台申请免费接口密钥。
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="pt-2 space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleCheckConnection}
                            disabled={connCheckStatus === "checking"}
                            className="flex-1 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg font-bold text-center transition-colors text-xs flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {connCheckStatus === "checking" ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            测试连接
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveApiConfig}
                            className="flex-[2] py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 rounded-lg font-bold text-center transition-colors text-xs"
                          >
                            保存系统设置到本地
                          </button>
                        </div>

                        {connCheckMsg && (
                          <div
                            className={`mt-2 text-[11px] font-bold text-center animate-fadeIn ${connCheckStatus === "success" ? "text-green-600" : "text-red-500"}`}
                          >
                            {connCheckMsg}
                          </div>
                        )}
                        {apiSaveSuccess && (
                          <div className="mt-2 text-[11px] text-green-600 font-bold text-center animate-fadeIn">
                            ✓ 系统设置与主持人人设已成功保存！
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {currentScreen === "creator" && (
          <CharacterCreator
            onComplete={handleCreatorComplete}
            systemPersonality={gmPersonality}
            initialGenre={creatorGenrePrefill ?? undefined}
          />
        )}

        {currentScreen === "game" && activeCharacter && activeInitialEvent && (
          <GameScreen
            genre={activeGenre}
            initialCharacter={activeCharacter}
            initialEvent={activeInitialEvent}
            gmPersonality={activePersonality}
            initialHistory={activeHistory}
            initialLongTermHistory={activeLongTermHistory}
            initialTurnCount={activeTurnCount}
            initialLastActionText={activeLastActionText}
            initialLastDiceRoll={activeLastDiceRoll}
            initialTurnSnapshots={activeTurnSnapshots}
            initialFullStoryArchive={activeFullStoryArchive}
            initialPinnedMemo={activePinnedMemo}
            onExit={() => setCurrentScreen("home")}
            onChangePersonality={(pers) => {
              setActivePersonality(pers);
              setGmPersonality(pers);
            }}
            onChangeWorldview={handleChangeWorldview}
          />
        )}
      </main>

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fadeIn"
            onClick={() =>
              setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
            }
          />
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-xl relative z-10 animate-scaleUp space-y-4">
            <h3 className="font-serif text-lg font-bold text-zinc-900 dark:text-zinc-100 border-b pb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {confirmDialog.message}
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() =>
                  setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
                }
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
              >
                {confirmDialog.cancelText || "取消"}
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition-colors"
              >
                {confirmDialog.confirmText || "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
      {promptDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fadeIn"
            onClick={() =>
              setPromptDialog((prev) => ({ ...prev, isOpen: false }))
            }
          />
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-xl relative z-10 animate-scaleUp space-y-4">
            <h3 className="font-serif text-lg font-bold text-zinc-900 dark:text-zinc-100 border-b pb-2">
              {promptDialog.title}
            </h3>
            {promptDialog.message && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {promptDialog.message}
              </p>
            )}
            <input
              type="text"
              ref={promptInputRef}
              autoFocus
              value={promptInputValue}
              maxLength={30}
              onChange={(e) => setPromptInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = promptInputRef.current?.value ?? promptInputValue;
                  promptDialog.onConfirm(v);
                }
              }}
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="输入名称（最多30字）"
            />
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() =>
                  setPromptDialog((prev) => ({ ...prev, isOpen: false }))
                }
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
              >
                取消
              </button>
              <button
                onClick={() =>
                  promptDialog.onConfirm(
                    promptInputRef.current?.value ?? promptInputValue,
                  )
                }
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 rounded-xl text-xs font-bold transition-colors"
              >
                {promptDialog.confirmText || "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
