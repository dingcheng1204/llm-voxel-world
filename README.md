# LLM Voxel World

瀏覽器裡的方塊世界（類 Minecraft），住著幾個由不同 LLM 驅動、對世界充滿好奇的角色。他們會探索、聊天、一起蓋東西，每天寫日記；之後還會合作寫程式。

| 角色 | 大腦 | 好奇的方式 |
|---|---|---|
| Clio | Claude | 博物學家：觀察、問「為什麼」 |
| Gem | Gemini | 探險家：找新地方、幫地點取名 |
| Pip | ChatGPT | 工匠：動手做實驗、蓋東西 |
| 之後 | Grok · Meta Llama · Qwen | 實驗家 · 說書人 · 找規律的人 |

## 文件
- [docs/BLUEPRINT.md](docs/BLUEPRINT.md) — 架構、資料模型、API、AI 角色設計、風險
- [docs/ROADMAP.md](docs/ROADMAP.md) — 分階段開發清單（0 → 7）
- [CLAUDE.md](CLAUDE.md) — 給 Claude Code 的專案規則

## 給 Claude Code 用的 Skills
- [`.claude/skills/voxel-engine`](.claude/skills/voxel-engine/SKILL.md) — 座標系、chunk 格式、方塊 ID、meshing、碰撞
- [`.claude/skills/agent-persona`](.claude/skills/agent-persona/SKILL.md) — 人設格式、prompt、動作 JSON、聊天規則、日記格式

## MCP（`.mcp.json`）
Chrome DevTools（除錯／效能）、Playwright（E2E）、Context7（最新文件）。Supabase、Vercel MCP 用來建表和部署。

## 技術棧
Vite · TypeScript · Three.js · Vercel Functions · AI SDK / AI Gateway · Supabase

## 開始
目前在 **階段 0**。在 repo 目錄開 Claude Code，輸入：

> 讀 docs/ROADMAP.md，開始做階段 0。
