# 開發順序（勾選清單）

每個階段完成條件：`npm run build` 通過、部署到 Vercel 預覽、用 Chrome DevTools MCP 截圖確認、勾選本檔。

## 階段 0 — 專案骨架
- [x] Vite + TypeScript strict + `three`
- [x] ESLint + Prettier + `tsc --noEmit` + Vitest；GitHub Actions 跑 typecheck/lint/test/build
- [x] `src/engine/renderer.ts`：場景、相機、fog、resize、context lost 處理
- [x] `src/engine/loop.ts`：60 Hz 固定步長 + 渲染內插
- [x] 畫面上出現方塊（先用 worker 產生的種子地形 + 自動飛行鏡頭展示）
- [x] F3 debug overlay：FPS、1% low、draw calls、三角形數、chunk 狀態
- [x] 效能原則文件 `docs/PERFORMANCE.md`
- [x] 連上 Vercel，push 到 main 自動部署正式版、PR 自動產生預覽網址

## 階段 1 — 方塊世界 MVP
- [x] `world/coords.ts`、`world/blocks.ts`（照 voxel-engine skill）
- [x] `world/chunk.ts`：Uint8Array 存取、單元測試涵蓋負座標
- [x] `world/terrain.ts`：seed + simplex noise，草/土/石/基岩/沙/水/樹
- [x] face-culling mesher（在 worker）；跨 chunk 邊界正確
- [x] chunk manager：由近到遠載入、卸載、dispose
- [ ] 第一人稱：PointerLockControls、WASD、跳、衝刺
- [ ] AABB 碰撞（固定 60Hz 物理步進）
- [ ] voxel DDA raycast；左鍵挖、右鍵放；選取框
- [ ] 快捷列 1–9
- [ ] ✅ 驗收：走 2 分鐘、挖放 50 次，FPS ≥ 60，不會卡進方塊

## 階段 2 — 世界打磨
- [ ] 編輯存 localStorage，重新整理後還在
- [ ] Supabase：建立專案表（BLUEPRINT §5 的 SQL 做成 migration）
- [ ] 編輯同步到 `world_edits`
- [x] Web Worker greedy meshing（三角形 −84%）
- [ ] 環境光遮蔽（per-vertex AO）
- [ ] 日夜循環（1 遊戲日 = 20 分鐘），天空顏色、太陽光
- [x] 水網格（湖、井）；海用動畫平面
- [x] 島嶼擴大到 192×288，加入雪山、火山、森林、花草原、湖與更多素材
- [ ] ✅ 驗收：整座島 ≥ 60 FPS；draw calls < 400；三角形 < 500k

## 階段 3 — 角色身體（還沒接 LLM）
- [x] `agents/AgentBody.ts`：共用身體；4 種可愛動物模型（貓/狐狸/狼/蛇）+ 名牌
- [x] 暫代大腦 `WanderBrain`（在廣場閒晃），之後換成 LLM
- [ ] 改用和玩家相同的 AABB 物理
- [ ] `agents/actions.ts`：zod schema（walk_to, look_at, mine, place, follow, name_place, wait, idle）
- [ ] `agents/pathfinding.ts`：3D A*（可走 = 腳下實心、身體 2 格空、可跳 1 格）
- [ ] `agents/executor.ts`：動作佇列、成功/失敗回報
- [ ] `agents/perceive.ts`：產生 Perception JSON
- [ ] 寫死的腳本角色：走到樹邊 → 挖 3 塊原木 → 回家
- [ ] debug：顯示路徑、目前動作、Perception
- [ ] ✅ 驗收：腳本角色連跑 10 分鐘不卡住

## 階段 4 — 第一個大腦（Claude）
- [ ] `.env`：AI Gateway key；`api/agent/think.ts`（AI SDK `generateObject` + zod）
- [ ] `src/agents/prompt.ts`：照 agent-persona 的 system prompt 範本
- [ ] `agents/personas/clio.yaml`
- [ ] 思考節奏（6–20 秒、事件觸發）
- [ ] 想法泡泡 + `say` 對話泡泡
- [ ] `events`、`usage` 寫入 Supabase
- [ ] `npm run agent:dry-run -- clio`
- [ ] ✅ 驗收：Clio 自己探索 15 分鐘，說話合理，花費在預算內

## 階段 5 — 三個角色 + 聊天 + 日記
- [ ] 加入 `gem.yaml`（Gemini）、`pip.yaml`（ChatGPT）
- [ ] 聽覺範圍 16 格、`heard` 進 Perception
- [ ] 對話輪數上限（8 輪 / 2 分鐘）+ 冷卻
- [ ] `messages` 表
- [ ] `api/cron/diary.ts` + `vercel.json` cron（台北 23:30）
- [ ] 最近 3 篇日記進 system prompt
- [ ] 日記閱讀頁 `/diary`（frontend-design skill）
- [ ] `agents/budget.yaml` 每日預算 + 睡覺機制
- [ ] ✅ 驗收：連跑一天，三人都有日記，內容只寫真的發生的事

## 階段 6 — 擴充
- [ ] 玩家聊天框（T 鍵）
- [ ] Grok、Meta Llama、Qwen 角色
- [ ] 地標系統（name_place）+ 小地圖
- [ ] 成本面板（今日每個角色花費）
- [ ] Playwright 回歸測試：載入、走路、挖放、角色生成

## 階段 7 — 合作寫程式
- [ ] 工作台方塊 + `propose_code` / `review_code` 動作
- [ ] Vercel Sandbox 執行角色寫的程式（逾時、無網路）
- [ ] 第一個任務：`build(blueprint) → edits[]` 蓋房子
- [ ] 角色分工（寫 / review / 測試），過程寫進日記
