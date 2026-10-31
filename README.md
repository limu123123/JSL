# LLMRPG

一个纯前端的 AI 文字冒险 / TRPG 引擎：自定义世界观、角色卡与六维属性，由大模型担任主持人推进剧情，支持存档、编年史压缩、时光回溯与 Token 账单。

> 本项目基于 [Future-R/LLMRPG_DEMO](https://github.com/Future-R/LLMRPG_DEMO) 修改而来，详见文末[致谢](#致谢)。

## 在线游玩

部署在 GitHub Pages 上：`https://limu123123.github.io/JSL/`

## 本地运行

需要 Node.js 20+：

```bash
npm ci
npm run dev
```

浏览器打开终端提示的地址（默认 `http://localhost:5173`）。
Windows 下也可直接双击 `启动.cmd`（局域网联机用 `启动_局域网.cmd`）。

## 使用说明

1. 首次进入在设置里填入自己的 API Key（DeepSeek / 硅基流动 / OpenAI 兼容端点 / Gemini），Key 只保存在浏览器 localStorage，不会上传到任何服务器。
2. 选择或自定义世界观与题材，创建角色（六维、特质、背囊）。
3. 开始游戏，用行动或选项推进剧情；存档写入浏览器本地 + 可选 TXT 文件。

## 部署方式

仓库内置 `.github/workflows/deploy.yml`：推送到 `main` 分支后自动 `npm ci && npm run build`，把 `dist/` 发布到 GitHub Pages。
首次部署需在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 技术栈

Vite 6 + React 19 + TypeScript + Tailwind CSS 4，纯静态构建，无后端依赖。

## 已知限制

- 在线版为纯静态站点，局域网「共享存档」功能（依赖本地 dev server 中间件）不可用。
- TXT 存档的静默写入依赖 File System Access API，仅 Chromium 系浏览器支持。
- Token 用量与费用仅为客户端估算，以服务商后台账单为准。

## 致谢

本项目的起点是 **[Future-R/LLMRPG_DEMO](https://github.com/Future-R/LLMRPG_DEMO)**（作者：未来，`future.r@foxmail.com`）。

原项目提供的框架、玩法设计与界面基础构成了本项目的地基；当前版本在其之上做了大幅重构与功能扩展（流式输出、Token 省流、记忆与归档、时光回溯、Token 账单、共享存档、移动端适配等）。

**关于授权**：原项目未附带 LICENSE 文件、亦未在 README 中声明开源条款，因此本仓库不主张对衍生部分之外的权利。若原作者认为本仓库的存在方式不妥，请通过 Issue 或邮件联系，我会立即调整、补充署名或下架，不做任何推诿。

**使用性质**：本项目仅供个人学习与技术交流，不含任何付费服务、广告或捐赠渠道，不使用原作者名义进行宣传。

如果你也喜欢这个方向，欢迎先去给原项目点个 Star。
