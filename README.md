# LLM Voxel World

瀏覽器裡一座可愛 low-poly 風格的方塊島（192×288 格，類 Minecraft），住著 4 隻由不同 LLM 驅動、對世界充滿好奇的小動物。他們會探索、聊天、一起蓋東西，每天寫日記；之後還會合作寫程式。

| 角色 | 外觀 | 大腦 | 好奇的方式 |
|---|---|---|---|
| Clio | 貓 | Claude | 博物學家：觀察、問「為什麼」 |
| Gem | 狐狸 | Gemini | 探險家：找新地方、幫地點取名 |
| Pip | 狼 | ChatGPT | 工匠：動手做實驗、蓋東西 |
| Rook | 蛇 | Grok（可換 Meta Llama / Qwen） | 實驗家：用打破規則來測試規則 |

外觀只是外觀——4 個角色能力完全一樣，差別只在操控的 LLM。

線上版：https://llm-voxel-world.vercel.app （push 到 `main` 自動部署）

## 文件
- [docs/BLUEPRINT.md](docs/BLUEPRINT.md) — 架構、資料模型、API、AI 角色設計、風險
- [docs/ROADMAP.md](docs/ROADMAP.md) — 分階段開發清單（0 → 7）
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — 效能預算與做法
- [CLAUDE.md](CLAUDE.md) — 給 Claude Code 的專案規則

## 給 Claude Code 用的 Skills
- [`.claude/skills/voxel-engine`](.claude/skills/voxel-engine/SKILL.md) — 座標系、chunk 格式、方塊 ID、meshing、碰撞
- [`.claude/skills/agent-persona`](.claude/skills/agent-persona/SKILL.md) — 人設格式、prompt、動作 JSON、聊天規則、日記格式

## MCP（`.mcp.json`）
Chrome DevTools（除錯／效能）、Playwright（E2E）、Context7（最新文件）。Supabase、Vercel MCP 用來建表和部署。

## 技術棧
Vite · TypeScript · Three.js · Vercel Functions · AI SDK / AI Gateway · Supabase

## 操作

點一下畫面開始。<kbd>WASD</kbd> 移動、<kbd>空白</kbd> 跳／游泳、<kbd>Shift</kbd> 衝刺、<kbd>F</kbd> 飛行（<kbd>C</kbd> 下降）、
左鍵挖、右鍵放、<kbd>1</kbd>–<kbd>9</kbd> 或滾輪選方塊、<kbd>F3</kbd> 效能面板、<kbd>Esc</kbd> 暫停。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173 ，按 F3 開關效能面板
npm run check      # typecheck + lint + test + build
```

URL 參數：`?pr=1` 解析度上限、`?aa=1` 反鋸齒、`?seed=42` 世界種子；展示鏡頭用 `?view=overview` 看全島、`?lineup=1` 讓 4 個角色排排站、`?orbit=0` 停止旋轉、`?dist=` `?h=` `?angle=` 調整視角。效能設計見 [docs/PERFORMANCE.md](docs/PERFORMANCE.md)。

目前進度：階段 0、1 完成（除了實機 FPS 驗收）。下一步：階段 2 存檔，或階段 3 讓角色用同一套物理與動作。
