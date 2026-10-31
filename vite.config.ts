import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

// ==================== 共享存档服务（局域网云槽，2026-10-28）====================
// 启动脚本（启动_局域网.cmd / 启动.cmd）跑的是原生 vite dev，不是 server.ts——
// 所以端点挂在 vite dev server 的 connect 中间件上（configureServer 钩子）。
// 存档目录 = 项目根 shared_saves/；文件名 = 清洗后的存档名；文件内容 = 槽位 JSON 字符串原样。
// 端点（同源直连、无鉴权——家庭局域网信任模型，页面已明示）：
//   GET  /api/shared-saves/list                 → { saves: [{name, turn, charName, saveDate, mtime, size}] }
//   POST /api/shared-saves/store {name, json}   → { ok: true }（同名覆盖）
//   GET  /api/shared-saves/load?name=xxx        → { name, json }
//   POST /api/shared-saves/delete {name}        → { ok: true }
// 说明：这些请求全部打向本游戏自己的 5174 开发服务器，与 AI API 无任何关系。

const SHARED_SAVES_DIR = path.resolve(__dirname, "shared_saves");

function sharedSafeName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 60);
}

function sharedReadBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sharedSendJson(res: any, code: number, payload: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const sharedSavesPlugin: Plugin = {
  name: "shared-saves",
  configureServer(server) {
    // 注意：use(mountPath, fn) 会剥掉前缀——handler 内 req.url 形如 "/list?..."
    server.middlewares.use("/api/shared-saves", (req, res, next) => {
      const run = async () => {
        await fs.promises.mkdir(SHARED_SAVES_DIR, { recursive: true });
        const route = (req.url || "").split("?")[0];
        const method = (req.method || "").toUpperCase();

        if (method === "GET" && route === "/list") {
          const files = (await fs.promises.readdir(SHARED_SAVES_DIR)).filter((f) =>
            f.endsWith(".json"),
          );
          const saves: unknown[] = [];
          for (const file of files) {
            try {
              const full = path.join(SHARED_SAVES_DIR, file);
              const stat = await fs.promises.stat(full);
              const raw = await fs.promises.readFile(full, "utf8");
              let turn: number | null = null;
              let charName = "";
              let saveDate = "";
              try {
                const obj = JSON.parse(raw);
                turn = typeof obj?.turnCount === "number" ? obj.turnCount : null;
                charName = String(obj?.character?.name || "");
                saveDate = String(obj?.saveDate || "");
              } catch {}
              saves.push({
                name: file.slice(0, -5),
                turn,
                charName,
                saveDate,
                mtime: stat.mtimeMs,
                size: stat.size,
              });
            } catch {}
          }
          sharedSendJson(res, 200, { saves });
          return;
        }

        if (method === "POST" && route === "/store") {
          const body = await sharedReadBody(req);
          const name = sharedSafeName(body?.name);
          if (!name) {
            sharedSendJson(res, 400, { error: "无效的存档名" });
            return;
          }
          if (typeof body?.json !== "string" || !body.json) {
            sharedSendJson(res, 400, { error: "缺少存档内容" });
            return;
          }
          try {
            JSON.parse(body.json);
          } catch {
            sharedSendJson(res, 400, { error: "存档内容不是合法 JSON" });
            return;
          }
          await fs.promises.writeFile(
            path.join(SHARED_SAVES_DIR, `${name}.json`),
            body.json,
            "utf8",
          );
          sharedSendJson(res, 200, { ok: true });
          return;
        }

        if (method === "GET" && route === "/load") {
          const query = new URLSearchParams((req.url || "").split("?")[1] || "");
          const name = sharedSafeName(query.get("name"));
          try {
            const json = await fs.promises.readFile(
              path.join(SHARED_SAVES_DIR, `${name}.json`),
              "utf8",
            );
            sharedSendJson(res, 200, { name, json });
          } catch {
            sharedSendJson(res, 404, { error: "共享存档不存在（可能已被删除或改名）" });
          }
          return;
        }

        if (method === "POST" && route === "/delete") {
          const body = await sharedReadBody(req);
          const name = sharedSafeName(body?.name);
          try {
            await fs.promises.unlink(path.join(SHARED_SAVES_DIR, `${name}.json`));
            sharedSendJson(res, 200, { ok: true });
          } catch {
            sharedSendJson(res, 404, { error: "共享存档不存在（可能已被删除）" });
          }
          return;
        }

        next();
      };
      run().catch((err) =>
        sharedSendJson(res, 500, { error: String(err?.message || err) }),
      );
    });
  },
};

export default defineConfig(() => {
  return {
    base: "./",
    plugins: [react(), tailwindcss(), sharedSavesPlugin],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
  };
});
