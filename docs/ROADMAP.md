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
- [x] 第一人稱：pointer lock、WASD、跳、衝刺；另加游泳（海與湖）與飛行（F）
- [x] AABB 碰撞（固定 60Hz 物理步進，快速下落不穿透）— `player/physics.ts`，之後角色共用
- [x] voxel DDA raycast；左鍵挖、右鍵放（按住連續）；選取框；不能把方塊放在自己或角色身上
- [x] 快捷列 1–9 + 滾輪（草、土、石頭、原木、木板、磚、玩具方塊、水、火）
- [x] 編輯過的 chunk 優先重建，挖放立即生效
- [ ] ✅ 驗收：走 2 分鐘、挖放 50 次，FPS ≥ 60，不會卡進方塊（功能已自動測試；FPS 待實機確認）

## 階段 2 — 世界打磨
- [x] 編輯存 localStorage，重新整理後還在
- [x] Supabase：建立專案表（BLUEPRINT §5 的 SQL 做成 migration，RLS 全開、只開放公開讀取）
- [x] 編輯同步到 `world_edits`（經由 Edge Function `world-edits`；每 2 秒上傳、每 10 秒拉別人的修改；離線會排隊）
- [x] Web Worker greedy meshing（三角形 −84%）
- [x] 環境光遮蔽（per-vertex AO，與 greedy meshing 相容；三角形 104k → 143k）
- [x] 日夜循環（1 遊戲日 = 20 分鐘，所有人共用同一個時鐘）：天空、霧、光線、星星、日月、營火夜間照亮四周
- [x] 水網格（湖、井）；海用動畫平面
- [x] 島嶼擴大到 192×288，加入雪山、火山、森林、花草原、湖與更多素材
- [ ] ✅ 驗收：整座島 ≥ 60 FPS；draw calls < 400；三角形 < 500k

## 階段 3 — 角色身體（還沒接 LLM）
- [x] `agents/AgentBody.ts`：共用身體；4 種可愛動物模型（貓/狐狸/狼/蛇）+ 名牌
- [x] 暫代大腦 `WanderBrain`（在廣場閒晃），之後換成 LLM
- [x] 改用和玩家相同的 AABB 物理（`AgentBody` + `stepBody`；所有物種同一個身體 0.7×0.95）
- [x] `agents/actions.ts`：zod schema（walk_to, look_at, mine, place, follow, name_place, wait, idle），錯誤訊息可回饋給大腦重試
- [x] `agents/pathfinding.ts`：3D A*（可走 = 腳下實心、身體 2 格空、可跳上 1 格、可跳下 3 格、斜走不切角、避開水/岩漿/海）
- [x] `agents/executor.ts`：動作佇列、可達/可見檢查、背包、卡住自動重新規劃、成功/失敗回報
- [x] `agents/perceive.ts`：產生 Perception JSON（含每種方塊最近的位置 `nearest`）
- [x] 寫死的腳本角色：走到樹邊 → 挖 3 塊原木 → 回家放下（`brains/demo.ts`，與 LLM 用同一個 JSON 介面）
- [x] debug（F3）：顯示路徑線、目前動作、背包、想法；`__game.agents[i].lastPerception`
- [x] ✅ 驗收：4 個腳本角色在真實島嶼上無頭模擬 10 分鐘（`soak.test.ts`）：不卡住、不掉海、不卡進方塊，採集者各完成 30+ 輪

## 階段 4 — 第一個大腦（Clio，MiniMax M3.1 Flash）
- [x] `api/agent/think.ts`：MiniMax OpenAI 相容 API（M Plan 訂閱 key，`MINIMAX_API_KEY_1`）；回覆用 zod 驗證、錯誤重試一次（原訂 AI Gateway，改直連以控制成本）
- [x] 伺服器端成本保護：每日 US$ 上限（台北日）、全站每分鐘次數上限、只允許名單內角色、缺 secret 就拒絕（fail closed）
- [x] `src/agents/prompt.ts`：照 agent-persona 的 system prompt 範本
- [x] 角色設定改為 `src/agents/personas.ts`（純資料，前後端共用；取代 `agents/personas/*.yaml`）
- [x] 思考節奏（有人看時 6 秒；無人時每分鐘 1 次）
- [x] 想法泡泡 + `say` 對話泡泡
- [x] `events`、`usage` 寫入 Supabase
- [x] **伺服器端角色**：`agent_state` 存位置/背包/地標/最後想法；租約（lease）保證同一時間只有一個模擬器在驅動
- [x] 有人在看：該分頁驅動（每 4 秒上傳狀態），其他分頁同步觀看；分頁隱藏或遊戲迴圈停住就交還
- [x] 無人在看：Supabase pg_cron 每分鐘呼叫 `/api/agent/tick`，伺服器無頭模擬整座島 60 秒（與瀏覽器同一套引擎，打包成 `api/_gen/sim.js`）
- [x] 驅動中的 Clio 挖/放方塊會存進共用世界
- [ ] `npm run agent:dry-run -- clio`
- [ ] ✅ 驗收：Clio 自己探索 15 分鐘，說話合理，花費在預算內（伺服器 tick 已實測；待連續觀察）

## 階段 5 — 三個角色 + 聊天 + 日記
- [ ] 加入 `gem.yaml`（Gemini）、`pip.yaml`（ChatGPT）
- [ ] 聽覺範圍 16 格、`heard` 進 Perception
- [ ] 對話輪數上限（8 輪 / 2 分鐘）+ 冷卻
- [ ] `messages` 表
- [x] 每日日記 `api/agent/diary`：pg_cron 台北 23:30；當天事件壓縮成摘要 → 固定標題的 Markdown + 一句「明天要記得的事」；日記有保留預算
- [x] 短期記憶：最近 10 次思考（想法、說話、動作、結果、區域）放進每次提示詞
- [x] 最近 3 篇日記（各一句記憶）進 system prompt
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
