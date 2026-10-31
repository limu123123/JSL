import { GoogleGenAI, Type } from "@google/genai";
import {
  getApiConfig,
  clampInt,
  Character,
  HistoryTurn,
  AttributeDefinition,
  DEFAULT_ATTRIBUTE_DEFINITIONS,
} from "../types";

// ==================== Token 用量账单（2026-10-29，用户要求"显示用了多少 token 并折算成人民币"）====================
// 只读：从 AI API 的响应中捕获 usage 报告——服务端 tokenizer 的真实计数，不是本地估算。
// 完全不修改请求内容：发给 AI 的数据与没有此功能时逐字节一致。
// 各端点形态：OpenAI 兼容流式最后一帧通常带 usage；非流式在响应体顶层 usage；
// Gemini SDK 在 response.usageMetadata（promptTokenCount / candidatesTokenCount / thoughtsTokenCount）。

export interface TrpgTokenUsageRecord {
  ts: number;
  api: "deepseek" | "gemini";
  model: string;
  prompt: number;
  completion: number;
  total: number;
  thinking?: number; // 思考（思维链）消耗的 token，按输出计费
  cacheHit?: number; // 上下文缓存命中部分（计费打折）
  cacheMiss?: number;
}

const TOKEN_USAGE_LOG_KEY = "trpg_token_usage_log";

function loadTokenUsageLog(): TrpgTokenUsageRecord[] {
  try {
    const raw = localStorage.getItem(TOKEN_USAGE_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let tokenUsageLog: TrpgTokenUsageRecord[] = loadTokenUsageLog();
let tokenUsageListeners: Array<() => void> = [];

function notifyTokenUsage(): void {
  tokenUsageListeners.forEach((f) => {
    try {
      f();
    } catch {}
  });
}

function persistTokenUsageLog(): void {
  try {
    if (tokenUsageLog.length > 2000) tokenUsageLog = tokenUsageLog.slice(-2000);
    localStorage.setItem(TOKEN_USAGE_LOG_KEY, JSON.stringify(tokenUsageLog));
  } catch {}
}

function recordTokenUsage(api: "deepseek" | "gemini", model: string, usage: any): void {
  if (!usage || typeof usage !== "object") return;
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? usage.promptTokenCount ?? 0) || 0);
  const completion = Math.max(0, Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? 0) || 0);
  const fallbackTotal = prompt + completion;
  const total = Math.max(0, Number(usage.total_tokens ?? usage.totalTokenCount ?? fallbackTotal) || fallbackTotal);
  const thinking = Math.max(0, Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.thoughtsTokenCount ?? 0) || 0);
  const cacheHit = Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0) || 0);
  const cacheMiss = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? 0) || 0);
  if (prompt === 0 && completion === 0 && total === 0) return; // 全零帧不入账
  tokenUsageLog = [
    ...tokenUsageLog,
    {
      ts: Date.now(),
      api,
      model,
      prompt,
      completion,
      total,
      ...(thinking ? { thinking } : {}),
      ...(cacheHit || cacheMiss ? { cacheHit, cacheMiss } : {}),
    },
  ];
  persistTokenUsageLog();
  notifyTokenUsage();
}

export function getTokenUsageLog(): TrpgTokenUsageRecord[] {
  return tokenUsageLog;
}

export function clearTokenUsageLog(): void {
  tokenUsageLog = [];
  persistTokenUsageLog();
  notifyTokenUsage();
}

export function onTokenUsageRecorded(cb: () => void): () => void {
  tokenUsageListeners.push(cb);
  return () => {
    tokenUsageListeners = tokenUsageListeners.filter((f) => f !== cb);
  };
}

export async function redesignAttributesAPI(payload: {
  genre: string;
  direction?: string;
}): Promise<AttributeDefinition[]> {
  const config = getApiConfig();
  const { genre, direction } = payload;

  if (config.modelEngine === "gemini" && !config.geminiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 Gemini API Key。");
  }
  if (config.modelEngine === "deepseek" && !config.deepseekApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 DeepSeek API Key。");
  }
  if (config.modelEngine === "openai" && !config.openaiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 OpenAI API Key。");
  }

  const systemInstruction = `你是一位精通TRPG跑团规则架构的大师级设计师。你的任务是根据当前的世界观背景【${genre}】${direction ? `以及用户期望的设计方向【${direction}】` : ""}，深度定制一套极具代入感的专属【六维属性体系】（严格生成6项属性）。
核心要求：
1. 严禁使用千篇一律的通用“力量/敏捷/智力/魅力/意志/运气”，必须赋予契合题材的专有术语（例如玄幻修仙是“根骨、身法、神识、悟性、定力、气运”；科幻机甲是“同步率、机械抗性、算力、心智协议、威慑力、超限奇迹”等）。
2. 属性槽位严格对应6个标准键：依序为 "strength", "agility", "intelligence", "charisma", "willpower", "luck"。
3. 每个属性包含：
   - key: 标准槽位键
   - name: 沉浸式中文属性名（2-4字）
   - abbr: 单字或双字简称（如“骨”、“身”、“识”）
   - desc: 简明生动的效果释义（15-30字）
4. 全部采用简体中文输出，格式严格符合要求的 JSON Schema。`;

  const prompt = `世界观背景：【${genre}】\n设计倾向/方向：【${direction?.trim() || "深度定制契合世界观的独特六维"}】\n\n请设计专属于该题材的6项属性维度定义。`;

  const responseSchema = {
    type: "object",
    properties: {
      attributes: {
        type: "array",
        description: "专属于该世界观的6项属性定义",
        items: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "属性槽位，严格依序为 strength, agility, intelligence, charisma, willpower, luck 之一",
            },
            name: { type: "string", description: "沉浸式属性名称" },
            abbr: { type: "string", description: "单字或双字简称" },
            desc: { type: "string", description: "属性职能与效果说明" },
          },
          required: ["key", "name", "abbr", "desc"],
        },
      },
    },
    required: ["attributes"],
  };

  if (config.modelEngine === "deepseek") {
    const res = await generateContentWithDeepSeek({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.deepseekApiKey,
      apiUrl: config.deepseekApiUrl,
      model: config.deepseekModel,
    });
    return res?.attributes?.length === 6 ? res.attributes : DEFAULT_ATTRIBUTE_DEFINITIONS;
  } else if (config.modelEngine === "openai") {
    const res = await generateContentWithDeepSeek({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.openaiApiKey,
      apiUrl: config.openaiApiUrl,
      model: config.openaiModel,
    });
    return res?.attributes?.length === 6 ? res.attributes : DEFAULT_ATTRIBUTE_DEFINITIONS;
  } else {
    const response = await generateContentWithFallback({
      contents: prompt,
      systemInstruction,
      apiKey: config.geminiApiKey,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          attributes: {
            type: Type.ARRAY,
            description: "专属于该世界观的6项属性定义",
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                name: { type: Type.STRING },
                abbr: { type: Type.STRING },
                desc: { type: Type.STRING },
              },
              required: ["key", "name", "abbr", "desc"],
            },
          },
        },
        required: ["attributes"],
      },
    });

    const res = JSON.parse(response.text!);
    return res?.attributes?.length === 6 ? res.attributes : DEFAULT_ATTRIBUTE_DEFINITIONS;
  }
}

// ==================== Token 省流参数（用户 2026-10-26 批准，备份 LLMRPG_github_master_backup_tokenslim）====================
// 上送窗口与编年史压缩参数均已做成游戏内"记忆设置"旋钮（types.ts ApiConfig.memory*）：
// 近程记忆窗口（默认10）/ 压缩触发线（默认30）/ 每次压缩条数（默认20）。

// A highly resilient helper to fetch content from DeepSeek or compatible OpenAI-like APIs
async function generateContentWithDeepSeek(config: {
  contents: string;
  systemInstruction: string;
  responseSchema: any;
  apiKey: string;
  apiUrl: string;
  model: string;
}) {
  const cleanUrl = config.apiUrl.trim().replace(/\/$/, "");
  const endpoint = `${cleanUrl}/chat/completions`;
  const systemPrompt = `${config.systemInstruction}\n\n您【必须】返回一个符合以下 JSON 架构的 JSON 对象。不要输出任何解释或 Markdown 格式包裹（如 \\\`\\\`\\\`json）：\n${JSON.stringify(config.responseSchema)}`;

  let finalContents = config.contents;
  if (config.model.toLowerCase().includes("deepseek")) {
    const NO_INNER_OS_MARKER = `\n\n【思维模式要求】在你的思考过程（<think>标签内）中，请遵守以下规则：\n1. 禁止使用圆括号包裹内心独白，例如"（心想：……）"或"(内心OS：……)"，所有分析内容直接陈述即可\n2. 禁止以角色第一人称描写内心活动，例如"我心想""我觉得""我暗自"等，请用分析性语言替代\n3. 思考内容应聚焦于剧情走向分析和回复内容规划，不要在思考中进行角色扮演式的内心戏表演`;
    finalContents += NO_INNER_OS_MARKER;
  }

  console.log(
    `[DeepSeek AI] Routing request to: ${endpoint} | Model: ${config.model}`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: finalContents },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `DeepSeek API 请求失败 (HTTP ${response.status}): ${errBody || "未返回详情"}`,
    );
  }

  const result: any = await response.json();
  if (result?.usage) recordTokenUsage("deepseek", result.model || config.model, result.usage);
  const content = result?.choices?.[0]?.message?.content || "";

  let cleaned = content.trim();

  // Strip <think>...</think> block if present
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[DeepSeek AI] JSON parsing failed. Content:", cleaned);
    throw new Error(
      "DeepSeek 接口没有返回有效的符合要求的 JSON 对象，请重试。",
    );
  }
}

// Remove reasoning blocks that some models emit before the JSON payload.
// Built with concatenation to avoid tricky escape sequences in regex literals.
function stripThinkTags(input: string): string {
  let out = input;
  for (;;) {
    const open = out.indexOf("<" + "think" + ">");
    if (open === -1) break;
    const close = out.indexOf("<" + "/" + "think" + ">", open);
    out =
      close === -1
        ? out.slice(0, open)
        : out.slice(0, open) + out.slice(close + 8);
  }
  return out.trim();
}

// Extract the current value of "storyText" from a partially received JSON stream,
// tolerant of truncated/unterminated content. Used for live streaming preview.
function extractPartialStoryText(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/```json/g, "```").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.storyText === "string") return parsed.storyText;
  } catch {
    // Not complete yet, fall through to incremental scan
  }
  const m = /"storyText"\s*:\s*"/.exec(cleaned);
  if (!m) return "";
  let i = m.index + m[0].length;
  let out = "";
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === "\\") {
      const next = cleaned[i + 1];
      if (next === undefined) break;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "/") out += "/";
      else if (next === "u") {
        const hex = cleaned.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // Value finished
    out += ch;
    i++;
  }
  return out;
}

// Streaming version of the DeepSeek / OpenAI-compatible API.
// Renders partial results via config.onProgress while producing the same final JSON as non-streaming mode.
async function generateContentWithDeepSeekStream(config: {
  contents: string;
  systemInstruction: string;
  responseSchema: any;
  apiKey: string;
  apiUrl: string;
  model: string;
  onProgress?: (partialJson: string) => void;
}) {
  const cleanUrl = config.apiUrl.trim().replace(/\/$/, "");
  const endpoint = `${cleanUrl}/chat/completions`;
  const systemPrompt = `${config.systemInstruction}\n\n您【必须】返回一个符合以下 JSON 架构的 JSON 对象。不要输出任何解释或 Markdown 格式包裹（如 \\\`\\\`\\\`json）：\n${JSON.stringify(config.responseSchema)}`;

  let finalContents = config.contents;
  if (config.model.toLowerCase().includes("deepseek")) {
    const NO_INNER_OS_MARKER = `\n\n【思维模式要求】在你的思考过程（/think 标签内）中，请遵守以下规则：\n1. 禁止使用圆括号包裹内心独白，例如"（心想：……）"或"(内心OS：……)"，所有分析内容直接陈述即可\n2. 禁止以角色第一人称描写内心活动，例如"我心想""我觉得""我暗自"等，请用分析性语言替代\n3. 思考内容应聚焦于剧情走向分析和回复内容规划，不要在思考中进行角色扮演式的内心戏表演`;
    finalContents += NO_INNER_OS_MARKER;
  }

  console.log(
    `[DeepSeek AI] Streaming request to: ${endpoint} | Model: ${config.model}`,
  );

  // 思考深度注入（用户 2026-10-29 批准；仅回合生成请求走此流式函数）。
  // 关闭（""/未设置）= 不加任何字段 = 请求体与现状逐字节一致。
  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: finalContents },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    stream: true,
  };
  const thinkingDepth = (getApiConfig().thinkingDepth || "").trim();
  if (thinkingDepth === "low" || thinkingDepth === "high" || thinkingDepth === "max") {
    if (config.apiUrl.toLowerCase().includes("siliconflow")) {
      // 硅基流动：enable_thinking 开思考 + thinking_budget 限思维链 token（官方 API 格式的 thinking.type 不被硅基流动接受）
      requestBody.enable_thinking = true;
      requestBody.thinking_budget =
        thinkingDepth === "low" ? 1024 : thinkingDepth === "high" ? 8192 : 24576;
    } else {
      // DeepSeek 官方：thinking.type 默认 enabled 无需显式；强度走 reasoning_effort（low/high/max，medium/xhigh 服务端映射）
      requestBody.reasoning_effort = thinkingDepth;
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `DeepSeek API 请求失败 (HTTP ${response.status}): ${errBody || "未返回详情"}`,
    );
  }

  if (!response.body) {
    // Some gateways do not support streaming; fall back to waiting for the full result
    const result: any = await response.json();
    if (result?.usage) recordTokenUsage("deepseek", result.model || config.model, result.usage);
    const content = result?.choices?.[0]?.message?.content || "";
    const cleaned = stripThinkTags(content)
      .replace(/```json/, "```")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    return JSON.parse(cleaned);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";
  // 修复（2026-10-29 晚，用户实测"计数器疯跑、极度偏大"）：部分网关（实测硅基流动）
  // 会在流式输出的每个数据帧都带 usage——旧逻辑"见帧即记账"导致一次请求被记上百笔。
  // 改为：记住最后一帧的 usage，流收尾时只记一笔（最后一帧 = 该请求的权威账单）。
  let lastUsage: any = null;
  let lastModel = "";

  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const delta = j?.choices?.[0]?.delta;
      if (delta?.content) full += delta.content;
      if (j?.usage) {
        lastUsage = j.usage;
        lastModel = String(j.model || config.model);
      }
    } catch {
      // Ignore keep-alive fragments or incomplete lines
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) handleLine(line);
    config.onProgress?.(full);
  }
  if (buffer) handleLine(buffer);
  config.onProgress?.(full);
  // 流收尾：整条请求只入账一次
  if (lastUsage) recordTokenUsage("deepseek", lastModel || config.model, lastUsage);

  const content = full.trim();
  // Strip reasoning packages if present, then markdown code fences
  const cleaned = stripThinkTags(content)
    .replace(/```json/, "```")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[DeepSeek AI] JSON parsing failed. Content:", cleaned);
    throw new Error(
      "DeepSeek 接口没有返回有效的符合要求的 JSON 对象，请重试。",
    );
  }
}

// A highly resilient helper to fetch content from Gemini with auto-retry and fallback models
async function generateContentWithFallback(config: {
  contents: any;
  systemInstruction: string;
  responseSchema: any;
  apiKey: string;
}) {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  // List of models to try in order of priority/robustness
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `[TRPG AI] Attempting with model: ${model} (attempt ${attempt}/2)`,
        );
        const response = await ai.models.generateContent({
          model: model,
          contents: config.contents,
          config: {
            systemInstruction: config.systemInstruction,
            responseMimeType: "application/json",
            responseSchema: config.responseSchema,
          },
        });

        if (response && response.text) {
          if (response.usageMetadata) recordTokenUsage("gemini", model, response.usageMetadata);
          return response;
        }
      } catch (err: any) {
        lastError = err;
        console.error(`[TRPG AI] Model ${model} failed:`, err.message || err);
        // Sleep briefly before retrying
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  throw (
    lastError ||
    new Error("All fallback models and retries failed to return content.")
  );
}

export async function checkConnectivity(apiConfig?: any): Promise<boolean> {
  const config = apiConfig || getApiConfig();

  try {
    if (config.modelEngine === "deepseek") {
      if (!config.deepseekApiKey) throw new Error("缺少 DeepSeek API Key");
      const cleanUrl = config.deepseekApiUrl.trim().replace(/\/$/, "");
      const endpoint = `${cleanUrl}/models`;
      const res = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.deepseekApiKey.trim()}` },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return true;
    } else if (config.modelEngine === "openai") {
      if (!config.openaiApiKey) throw new Error("缺少 OpenAI API Key");
      const cleanUrl = config.openaiApiUrl.trim().replace(/\/$/, "");
      const endpoint = `${cleanUrl}/models`;
      const res = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.openaiApiKey.trim()}` },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return true;
    } else {
      if (!config.geminiApiKey) throw new Error("缺少 Gemini API Key");
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Hello",
      });
      if (response && response.text) return true;
      return false;
    }
  } catch (error) {
    console.error("Connectivity check failed:", error);
    throw error;
  }
}

export async function negotiateCharacterAPI(
  genre: string,
  character: Character,
  chatMessage: string,
) {
  const config = getApiConfig();

  if (config.modelEngine === "gemini" && !config.geminiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 Gemini API Key。");
  }
  if (config.modelEngine === "deepseek" && !config.deepseekApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 DeepSeek API Key。");
  }
  if (config.modelEngine === "openai" && !config.openaiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 OpenAI API Key。");
  }

  const systemInstruction = `你是一位专业、风趣且富有创意的跑团游戏主持人（Game Master，简称GM）。
当前游戏背景题材是：【${genre}】。
玩家正在进行角色设定与背景协商。你需要根据玩家的想法、当前角色卡信息以及他们发送的信息，提供专业的建议、润色背景，并推荐适合这个设定的属性分配、2-3个初始天赋/特质（Traits），以及3-4件合理的初始携带物品（Inventory）。
请用非常友好且充满跑团仪式感的简短中文口吻进行回复。
你必须返回符合指定 JSON 格式的数据。`;

  const prompt = `玩家当前的属性分配是：
- 力量(STR): ${character.attributes.strength}
- 敏捷(AGI): ${character.attributes.agility}
- 智力(INT): ${character.attributes.intelligence}
- 魅力(CHA): ${character.attributes.charisma}
- 意志(WIL): ${character.attributes.willpower}
- 运气(LCK): ${character.attributes.luck}

角色名字: ${character.name || "未命名"}
角色性别: ${character.gender || "未设定"}
角色职业/身份: ${character.class || "未设定"}
初始天赋/特质: ${JSON.stringify(character.traits || [])}
初始携带物品: ${JSON.stringify(character.inventory || [])}

玩家给你的协商留言/要求: "${chatMessage || "请帮我润色当前的背景与设定，给出推荐的属性与物品"}"

请提供协商反馈、推荐的属性配置（总和保持与当前一致，或根据特色建议微调）、推荐的天赋（至少2个）、推荐的初始携带物品（至少3件）。`;

  const responseSchema = {
    type: "object",
    properties: {
      feedback: {
        type: "string",
        description:
          "GM对玩家背景和设定的中文点评、润色建议和跑团引入词，字数控制在150-250字内。",
      },
      suggestedAttributes: {
        type: "object",
        properties: {
          strength: { type: "integer" },
          agility: { type: "integer" },
          intelligence: { type: "integer" },
          charisma: { type: "integer" },
          willpower: { type: "integer" },
          luck: { type: "integer" },
        },
        description: "GM推荐的最契合该人设的属性分配数值。",
      },
      suggestedTraits: {
        type: "array",
        items: { type: "string" },
        description:
          "GM推荐的2-3个中文天赋/特质名称（附带简短效果描述，例如：'过目不忘：智力检定获得微幅加成'）。",
      },
      suggestedInventory: {
        type: "array",
        items: { type: "string" },
        description:
          "GM推荐的3-4件有趣的初始携带物品（例如：'破旧的牛皮日记本'、'附魔的黄铜指北针'）。",
      },
    },
    required: [
      "feedback",
      "suggestedAttributes",
      "suggestedTraits",
      "suggestedInventory",
    ],
  };

  if (config.modelEngine === "deepseek") {
    return generateContentWithDeepSeek({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.deepseekApiKey,
      apiUrl: config.deepseekApiUrl,
      model: config.deepseekModel,
    });
  } else if (config.modelEngine === "openai") {
    // We can reuse the DeepSeek client logic since OpenAI's API is identical
    return generateContentWithDeepSeek({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.openaiApiKey,
      apiUrl: config.openaiApiUrl,
      model: config.openaiModel,
    });
  } else {
    const response = await generateContentWithFallback({
      contents: prompt,
      systemInstruction,
      apiKey: config.geminiApiKey,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          feedback: {
            type: Type.STRING,
            description:
              "GM对玩家背景和设定的中文点评、润色建议和跑团引入词，字数控制在150-250字内。",
          },
          suggestedAttributes: {
            type: Type.OBJECT,
            properties: {
              strength: { type: Type.INTEGER },
              agility: { type: Type.INTEGER },
              intelligence: { type: Type.INTEGER },
              charisma: { type: Type.INTEGER },
              willpower: { type: Type.INTEGER },
              luck: { type: Type.INTEGER },
            },
            description: "GM推荐的最契合该人设的属性分配数值。",
          },
          suggestedTraits: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "GM推荐的2-3个中文天赋/特质名称（附带简短效果描述）。",
          },
          suggestedInventory: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "GM推荐 of 3-4件有趣的初始携带物品。",
          },
        },
        required: [
          "feedback",
          "suggestedAttributes",
          "suggestedTraits",
          "suggestedInventory",
        ],
      },
    });

    return JSON.parse(response.text!);
  }
}

export async function compressHistoryAPI(
  genre: string,
  character: Character,
  turnsToCompress: HistoryTurn[],
) {
  const config = getApiConfig();

  if (config.modelEngine === "gemini" && !config.geminiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 Gemini API Key。");
  }
  if (config.modelEngine === "deepseek" && !config.deepseekApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 DeepSeek API Key。");
  }
  if (config.modelEngine === "openai" && !config.openaiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 OpenAI API Key。");
  }

  const systemInstruction = `你是一位高水平的跑团故事编辑与历史记录官。你的任务是将玩家过去经历的 20 个跑团回合合并，提炼并总结成一段 150-300 字左右、流畅连贯、文笔极佳且契合题材（${genre}）的【编年史摘要（前情提要）】。
核心要求：
1. 用一段话/几句非常连贯生动的中文概括，绝对不要使用列表形式。
2. 保留玩家取得的核心成就、战斗结果、重大损伤、获得的重要物品或角色成长。
3. 保持史诗、跌宕起伏的叙事风格，使玩家和未来的大语言模型主持人能通过此摘要记起该阶段的关键经过。`;

  const turnsText = turnsToCompress
    .map((h: any) => {
      return `【回合 ${h.turn}】
场景: ${h.narrative}
行动: ${h.choiceOrAction}
${h.rollResult ? `判定: ${h.rollResult}` : ""}`;
    })
    .join("\n\n");

  const prompt = `以下是过去 20 个回合的跑团记录：
${turnsText}

请为这 20 个回合撰写一气呵成的故事编年史阶段总结。`;

  if (config.modelEngine === "deepseek") {
    const response = await fetch(
      `${config.deepseekApiUrl.trim().replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: config.deepseekModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          temperature: 0.6,
        }),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `DeepSeek API 请求失败 (HTTP ${response.status}): ${errBody}`,
      );
    }
    const result: any = await response.json();
    if (result?.usage) recordTokenUsage("deepseek", result.model || config.deepseekModel, result.usage);
    const content = result?.choices?.[0]?.message?.content || "";
    return { summary: content.trim() };
  } else if (config.modelEngine === "openai") {
    const response = await fetch(
      `${config.openaiApiUrl.trim().replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: config.openaiModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          temperature: 0.6,
        }),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `OpenAI API 请求失败 (HTTP ${response.status}): ${errBody}`,
      );
    }
    const result: any = await response.json();
    if (result?.usage) recordTokenUsage("deepseek", result.model || config.openaiModel, result.usage);
    const content = result?.choices?.[0]?.message?.content || "";
    return { summary: content.trim() };
  } else {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.6,
      },
    });

    return { summary: response.text?.trim() || "" };
  }
}

export async function generateEventAPI(
  payload: any,
  onStoryProgress?: (partialStory: string) => void,
) {
  const config = getApiConfig();
  const {
    genre,
    character,
    history,
    longTermHistory,
    choiceOrAction,
    diceRoll,
    gmPersonality,
    guidancePrompt,
    pinnedMemo,
  } = payload;

  if (config.modelEngine === "gemini" && !config.geminiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 Gemini API Key。");
  }
  if (config.modelEngine === "deepseek" && !config.deepseekApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 DeepSeek API Key。");
  }
  if (config.modelEngine === "openai" && !config.openaiApiKey) {
    throw new Error("请先在主页设置中填写并配置您的 OpenAI API Key。");
  }

  // Map personality to narrative guidance
  let personalityGuide = "";
  if (gmPersonality === "Cold Rules-Stickler") {
    personalityGuide =
      "你的风格是【冷酷无情的守规人】。描述笔触冰冷、残酷。剧情强调环境的危险性，任何失误都会面临严重的致命后果或严苛的惩罚，极度注重属性契合度和合理性。";
  } else if (gmPersonality === "Poetic Bard") {
    personalityGuide =
      "你的风格是【注重描写的诗人和歌者】。使用极具文学美感、优美、充满细节和诗意的句子。强调氛围感、角色的心理活动、光影、气味、宿命感，给玩家极强的沉浸式叙事体验。";
  } else if (gmPersonality === "ErogeGalgame") {
    personalityGuide =
      "你的风格是【日式色情游戏/绅士Galgame深夜档主持人】。叙事极具日式AVG/Galgame文字冒险感，文笔极其暧昧、诱惑和挑逗。极力描摹感官细节、心跳加速（如‘咚咚’、‘噗通’）、面红耳赤的羞耻瞬间、眼神拉扯与肢体碰触，带有戏剧化的二次元吐槽和令人浮想联翩的台词，语气中带着一丝挑弄和玩味，为玩家营造荷尔蒙飙升的绅士向恋爱与脸红心跳的日系Galgame跑团互动氛围。在描述各种检定和事件时，多加入面部红晕、衣衫不整、耳畔低语、体温升高等轻小说/绅士向感官元素。";
  } else {
    personalityGuide =
      "你的风格是【幽默风趣的戏剧家】。充满黑色幽默、戏剧性转折和意想不到的惊喜。偶尔会有GM与玩家的有趣吐槽（Meta元素），让跑团过程充满欢声笑语和精彩的巧合。";
  }

  // 特质动态演化开关（trpg_api_config.traitEvolution，默认关闭）。
  // 已获用户批准的上送内容变更（2026-10-23）：关闭时①规则3替换为"特质保持稳定"②结尾指令去掉特质演化③两份 schema 移除 traitChanges。
  // 开启时下方规则3与两份 responseSchema 与历史版本逐字节一致。
  const traitEvolutionEnabled = config.traitEvolution === true;
  const traitRule = traitEvolutionEnabled
    ? "3. 【特质与心智演化（高频动态变动）】：根据玩家在遭遇中的表现、受到的创伤、心智震撼、领悟或异化，积极动态演变角色的天赋特质（traitChanges）。这涵盖重要天赋觉醒或突破，也包括轻微伤痕、临时状态、心灵印记（如『心神不宁』、『灵力紊乱』、『极度专注』等）。如本回合无变动，added和removed保持为空数组，reason为空字符串。"
    : "3. 【特质保持稳定】：角色的天赋特质清单是玩家已确定的固定设定（已在上下文中提供），全程不得变动——不要让角色获得、觉醒、失去或演变任何特质，也不要在剧情文本中提及特质的增减变化。";

  // 物品演化开关（trpg_api_config.inventoryEvolution，默认开启）。
  // 已获用户批准的上送内容变更（2026-10-30）：关闭时①结尾指令去掉"物品变动"②两份 schema 移除 inventoryChanges 及其 required 条目 ③systemInstruction 追加"背囊物品保持稳定"规则6（同时压制规则1骰点失败措辞里"失去物品"字样，避免 AI 将其理解为可自行减物品）。
  // 注意方向与特质开关相反：物品变动自古是回合请求的一部分，故 true/未设置=请求逐字节同现状；仅用户显式关闭（===false）才精简。
  const inventoryEvolutionEnabled = config.inventoryEvolution !== false;
  const inventoryRule = inventoryEvolutionEnabled
    ? ""
    : "\n6. 【背囊物品保持稳定】：玩家的背囊物品清单是玩家已确定的固定设定（已在上下文中提供），全程不得变动——不要让角色获得、捡起、购买、消耗、丢失或移交任何物品，也不要在剧情文本中提及物品的增减；若剧情涉及获取或消耗物品的机会，请用叙事或选项提示玩家，由玩家自行在结局面板手动整理背囊。";

  const systemInstruction = `你是一位传奇级的跑团模拟主持人（Game Master）。当前的游戏题材背景为：【${genre}】。
你负责为玩家撰写精彩、动态、高响应性的剧情，并生成推荐选择。

核心规则：
1. 【高反馈度】：必须完全契合玩家选择或输入的行动（"${choiceOrAction}"）。如果玩家掷骰了（diceRoll），你必须将掷骰结果（例如：${diceRoll ? `总检定值为 ${diceRoll.total}（掷骰 ${diceRoll.rollValue} + 修正 ${diceRoll.modifier}），难度DC为 ${diceRoll.targetDc}，判定为 ${diceRoll.isSuccess ? "成功" : "失败"}` : "无骰点"}）写进故事的发展里！
   - 骰点成功：玩家帅气、精彩地达成了目的，或者获得了意料之外的好处。
   - 骰点失败：玩家遭遇挫折、陷入窘境、受伤、失去物品，或引发了更复杂的矛盾，但游戏绝不能在此戛然而止，必须有新的危机引导他们前进。
2. 【属性与资源】：根据剧情发展，玩家的生命值(HP)、理智/资源值(Sanity)应当有动态增减，但不要直接让角色死亡，除非玩家生命归零（归零则判定为游戏结束，并给出相应的悲壮结局）。
${traitRule}
4. 【推荐选择生成】：你必须生成 3-4 个后续的推荐行动选项：
   - 至少一个常规安全选项（正常观察或对话，不需要检定，或极低难度）。
   - 至少两个需要进行属性检定（Skill Check）的高风险/高回报行动。每个检定选项必须写明检定的属性对应键（如当前世界观六维之一）和建议的目标难度DC（8到18之间）。
5. 【汉化风格】：完全采用简体中文，遣词造句极具跑团代入感，使用Markdown排版（请绝对避免使用斜体格式，如 \`*文字*\`，以免影响中文阅读体验）。${inventoryRule}

当前GM人设指南：${personalityGuide}`;

  // Build context of previous story turns
  let historyContext = "";
  if (longTermHistory && longTermHistory.length > 0) {
    historyContext +=
      "长期冒险编年史阶段总结（前情往事提要）：\n" +
      longTermHistory
        .map((lh: string, idx: number) => {
          return `阶段 ${idx + 1}: ${lh}`;
        })
        .join("\n") +
      "\n\n";
  }

  if (history && history.length > 0) {
    // 只上送最近 N 条详文（N = 游戏内"记忆设置·近程记忆窗口"，默认 10；用户批准的省流项）
    const maxRecentTurns = clampInt(config.memoryRecentTurns, 5, 30, 10);
    const recentHistory = history.slice(-maxRecentTurns);
    historyContext +=
      "近期故事详细纪实（微观动作与发生）：\n" +
      recentHistory
        .map((h: any) => {
          return `【回合 ${h.turn}】
场景描述: ${h.narrative}
玩家行动: ${h.choiceOrAction}
${h.rollResult ? `判定结果: ${h.rollResult}` : ""}`;
        })
        .join("\n\n") +
      "\n\n";
  }

  const attrDefs = character.attributeDefinitions || DEFAULT_ATTRIBUTE_DEFINITIONS;
  const attrSummary = attrDefs
    .map(
      (def: any) =>
        `${def.name} [属性键:${def.key}]: ${character.attributes[def.key] ?? 10}`,
    )
    .join(", ");

  const characterContext = `当前角色卡信息：
- 名字: ${character.name}
- 性别: ${character.gender || "未设定"}
- 职业: ${character.class}
- 状态: ${character.resourceName || "生命值"}: ${character.hp}/${character.maxHp || 100}, ${character.secondaryResourceName || "理智值"}: ${character.sanity}/${character.maxSanity || 100}${character.customStatusBars && character.customStatusBars.length > 0 ? `, ${character.customStatusBars.map((b: any) => `${b.name}: ${b.current}/${b.max}`).join(", ")}` : ""}
- 携带物品: ${JSON.stringify(character.inventory || [])}
- 天赋特质: ${JSON.stringify(character.traits || [])}
- 当前六维属性体系: ${attrSummary}`;

  const memoBlock =
    typeof pinnedMemo === "string" && pinnedMemo.trim()
      ? `【玩家钉住的备忘（全档常驻——此内容不随历史压缩、近史窗口移动或时光回溯而消失，你必须在每一回合叙事前回顾并遵守如下要求）】\n"${pinnedMemo.trim()}"\n`
      : "";
  const actionContext = `${memoBlock}【当前玩家的最新行动】
行动: "${choiceOrAction}"
${
  diceRoll
    ? `【骰点结果反馈】
进行【${diceRoll.attributeName || diceRoll.attributeMatched}】检定：
基础掷骰：D20 = ${diceRoll.rollValue}，属性修正 = ${diceRoll.modifier >= 0 ? "+" : ""}${diceRoll.modifier}${diceRoll.traitBonus ? `，天赋特质加成 = ${diceRoll.traitBonus >= 0 ? "+" : ""}${diceRoll.traitBonus}${diceRoll.triggeredTraits?.length ? `（生效特质：${diceRoll.triggeredTraits.map((t: any) => t.name).join("、")}）` : ""}` : ""}，最终检定总和 = ${diceRoll.total}
目标难度：${diceRoll.targetDc}
判定结果：${diceRoll.isSuccess ? "【检定成功】" : "【检定失败】"}`
    : "（此行动为常规行动，无须骰点）"
}`;

  const prompt = `${historyContext}
${characterContext}

${actionContext}
${guidancePrompt ? `\n【玩家对本回合故事走向的期望/提示词（请高度参考并体现在新剧情中）】：\n"${guidancePrompt}"` : ""}

请基于以上所有上下文，撰写下一个回合的剧情事件，并输出状态变化、新选项${inventoryEvolutionEnabled ? "、物品变动" : ""}${traitEvolutionEnabled ? "及特质动态变动" : ""}。`;

  // 剧情字数由可调中位数驱动：区间 = 中位数±100字。默认 300 → 200-400，与历史固定文案逐字节一致。
  const storyWordMid = Math.min(600, Math.max(150, Math.round(config.storyWordMid ?? 300)));
  const storyWordLow = storyWordMid - 100;
  const storyWordHigh = storyWordMid + 100;

  const responseSchema = {
    type: "object",
    properties: {
      storyText: {
        type: "string",
        description: `本回合剧情正文（字数在${storyWordLow}-${storyWordHigh}字之间）。`,
      },
      gmCommentary: { type: "string", description: "GM旁白点评，50字内。" },
      characterStatus: {
        type: "object",
        description: "本回合变动后的角色状态。",
        properties: {
          hp: { type: "integer", description: "变化后的主要资源值。" },
          sanity: { type: "integer", description: "变化后的次要资源值。" },
          maxHp: { type: "integer" },
          maxSanity: { type: "integer" },
          resourceName: { type: "string", description: "主要资源名。" },
          secondaryResourceName: { type: "string", description: "次要资源名。" },
        },
        required: [
          "hp",
          "sanity",
          "maxHp",
          "maxSanity",
          "resourceName",
          "secondaryResourceName",
        ],
      },
      recommendedChoices: {
        type: "array",
        description:
          "3-4个推荐行动：至少1个常规项(normal, DC=0)与2个属性检定项(check, DC 8-18)。",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "选项文字。" },
            difficulty: { type: "string", description: "难度说明，如'身法 检定 (DC 13)'或'常规观察'。" },
            actionType: { type: "string", description: "check(检定)或normal(常规)。" },
            attribute: { type: "string", description: "检定属性键(当前六维之一)或none。" },
            targetDc: { type: "integer", description: "目标难度DC(normal为0)。" },
          },
          required: ["text", "difficulty", "actionType", "attribute", "targetDc"],
        },
      },
      ...(inventoryEvolutionEnabled
        ? {
            inventoryChanges: {
              type: "object",
              properties: {
                added: { type: "array", items: { type: "string" }, description: "本回合获得的物品(无则空数组)。" },
                removed: { type: "array", items: { type: "string" }, description: "本回合失去的物品(无则空数组)。" },
              },
              required: ["added", "removed"],
            },
          }
        : {}),
      ...(traitEvolutionEnabled
        ? {
            traitChanges: {
              type: "object",
              properties: {
                added: { type: "array", items: { type: "string" }, description: "新增/觉醒特质(无则空数组)。" },
                removed: { type: "array", items: { type: "string" }, description: "失去/消退特质(无则空数组)。" },
                reason: { type: "string", description: "变动剧情原因(无变动为空字符串)。" },
              },
              required: ["added", "removed", "reason"],
            },
          }
        : {}),
      isGameOver: { type: "boolean", description: "游戏是否在本回合彻底结束(死亡/疯狂/通关)。" },
      gameEndingType: { type: "string", description: "victory(生还/通关)、death(死亡/失败)、none(继续)。" },
    },
    required: [
      "storyText",
      "gmCommentary",
      "characterStatus",
      "recommendedChoices",
      ...(inventoryEvolutionEnabled ? ["inventoryChanges"] : []),
      ...(traitEvolutionEnabled ? ["traitChanges"] : []),
      "isGameOver",
      "gameEndingType",
    ],
  };

  if (config.modelEngine === "deepseek") {
    return generateContentWithDeepSeekStream({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.deepseekApiKey,
      apiUrl: config.deepseekApiUrl,
      model: config.deepseekModel,
      onProgress: (partialJson) => {
        const partial = extractPartialStoryText(partialJson);
        if (partial) onStoryProgress?.(partial);
      },
    });
  } else if (config.modelEngine === "openai") {
    return generateContentWithDeepSeekStream({
      contents: prompt,
      systemInstruction,
      responseSchema,
      apiKey: config.openaiApiKey,
      apiUrl: config.openaiApiUrl,
      model: config.openaiModel,
      onProgress: (partialJson) => {
        const partial = extractPartialStoryText(partialJson);
        if (partial) onStoryProgress?.(partial);
      },
    });
  } else {
    const response = await generateContentWithFallback({
      contents: prompt,
      systemInstruction,
      apiKey: config.geminiApiKey,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          storyText: {
            type: Type.STRING,
            description: `本回合剧情正文（字数在${storyWordLow}-${storyWordHigh}字之间）。`,
          },
          gmCommentary: { type: Type.STRING, description: "GM旁白点评，50字内。" },
          characterStatus: {
            type: Type.OBJECT,
            description: "本回合变动后的角色状态。",
            properties: {
              hp: { type: Type.INTEGER, description: "变化后的主要资源值。" },
              sanity: { type: Type.INTEGER, description: "变化后的次要资源值。" },
              maxHp: { type: Type.INTEGER },
              maxSanity: { type: Type.INTEGER },
              resourceName: { type: Type.STRING, description: "主要资源名。" },
              secondaryResourceName: { type: Type.STRING, description: "次要资源名。" },
            },
            required: [
              "hp",
              "sanity",
              "maxHp",
              "maxSanity",
              "resourceName",
              "secondaryResourceName",
            ],
          },
          recommendedChoices: {
            type: Type.ARRAY,
            description:
              "3-4个推荐行动：至少1个常规项(normal, DC=0)与2个属性检定项(check, DC 8-18)。",
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING, description: "选项文字。" },
                difficulty: { type: Type.STRING, description: "难度说明，如'身法 检定 (DC 13)'或'常规观察'。" },
                actionType: { type: Type.STRING, description: "check(检定)或normal(常规)。" },
                attribute: { type: Type.STRING, description: "检定属性键(当前六维之一)或none。" },
                targetDc: { type: Type.INTEGER, description: "目标难度DC(normal为0)。" },
              },
              required: ["text", "difficulty", "actionType", "attribute", "targetDc"],
            },
          },
          ...(inventoryEvolutionEnabled
            ? {
                inventoryChanges: {
                  type: Type.OBJECT,
                  properties: {
                    added: { type: Type.ARRAY, items: { type: Type.STRING }, description: "本回合获得的物品(无则空数组)。" },
                    removed: { type: Type.ARRAY, items: { type: Type.STRING }, description: "本回合失去的物品(无则空数组)。" },
                  },
                  required: ["added", "removed"],
                },
              }
            : {}),
          ...(traitEvolutionEnabled
            ? {
                traitChanges: {
                  type: Type.OBJECT,
                  properties: {
                    added: { type: Type.ARRAY, items: { type: Type.STRING }, description: "新增/觉醒特质(无则空数组)。" },
                    removed: { type: Type.ARRAY, items: { type: Type.STRING }, description: "失去/消退特质(无则空数组)。" },
                    reason: { type: Type.STRING, description: "变动剧情原因(无变动为空字符串)。" },
                  },
                  required: ["added", "removed", "reason"],
                },
              }
            : {}),
          isGameOver: { type: Type.BOOLEAN, description: "游戏是否在本回合彻底结束(死亡/疯狂/通关)。" },
          gameEndingType: { type: Type.STRING, description: "victory(生还/通关)、death(死亡/失败)、none(继续)。" },
        },
        required: [
          "storyText",
          "gmCommentary",
          "characterStatus",
          "recommendedChoices",
          ...(inventoryEvolutionEnabled ? ["inventoryChanges"] : []),
          ...(traitEvolutionEnabled ? ["traitChanges"] : []),
          "isGameOver",
          "gameEndingType",
        ],
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response text from Gemini.");
    }

    return JSON.parse(responseText.trim());
  }
}

// ---------------------------------------------------------------------------
// 模型列表发现：GET 当前引擎配置的 {API地址}/models（OpenAI 兼容端点）。
// SiliconFlow（硅基流动）、DeepSeek 官方、OpenAI 等均支持。
// 仅查询模型目录（只读、不含任何游戏内容），结果缓存 24 小时（同接口地址复用）。
// ---------------------------------------------------------------------------

const MODEL_CACHE_KEY = "trpg_model_cache";
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// 当前生成引擎使用的 OpenAI 兼容端点与密钥（Gemini 走 SDK 固定模型，不在此列）
function activeChatEndpointBase(): { apiUrl: string; apiKey: string } {
  const config = getApiConfig();
  if (config.modelEngine === "openai") {
    return { apiUrl: config.openaiApiUrl || "", apiKey: config.openaiApiKey || "" };
  }
  return { apiUrl: config.deepseekApiUrl || "", apiKey: config.deepseekApiKey || "" };
}

export async function fetchAvailableModels(force = false): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
  endpoint: string;
}> {
  const { apiUrl, apiKey } = activeChatEndpointBase();
  const cleanUrl = apiUrl.trim().replace(/\/$/, "");
  const endpoint = `${cleanUrl}/models`;

  if (!force) {
    try {
      const cached = JSON.parse(
        localStorage.getItem(MODEL_CACHE_KEY) || "null",
      );
      if (
        cached &&
        cached.apiUrl === cleanUrl &&
        cached.ts &&
        Date.now() - cached.ts < MODEL_CACHE_TTL &&
        Array.isArray(cached.models) &&
        cached.models.length > 0
      ) {
        return { ok: true, models: cached.models, endpoint };
      }
    } catch {
      // 缓存损坏则视为无缓存
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        models: [],
        error: `HTTP ${res.status}: ${body.slice(0, 140) || "未返回详情"}`,
        endpoint,
      };
    }
    const json = await res.json();
    const ids: string[] = Array.isArray(json?.data)
      ? json.data
          .map((m: any) => String(m?.id || m?.model || ""))
          .filter(Boolean)
      : [];
    if (ids.length === 0) {
      return { ok: false, models: [], error: "接口未返回任何模型", endpoint };
    }
    const unique = Array.from(new Set(ids)).sort();
    try {
      localStorage.setItem(
        MODEL_CACHE_KEY,
        JSON.stringify({ apiUrl: cleanUrl, ts: Date.now(), models: unique }),
      );
    } catch {
      // 存不下缓存不影响本次使用
    }
    return { ok: true, models: unique, endpoint };
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err?.message || "网络请求失败",
      endpoint,
    };
  }
}
