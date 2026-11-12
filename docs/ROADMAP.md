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

## 階段 5 — 兩個角色 + 聊天 + 日記 ✅

（原本規劃 3 個角色；改為每個實際接上的大腦一個角色：Clio = MiniMax、Gem = Gemini。Pip、Rook 已移除。）

- [x] Gem 接 Gemini 3.1 Flash-Lite（免費方案、不綁卡；每天 470 次上限，太平洋時間午夜重置）；每個角色可設自己的供應商、模型、思考頻率
- [x] 伺服器 tick 一次模擬所有 LLM 角色、共用同一個世界（看得到彼此、聽得到對方說的話）
- [x] 聽覺範圍 16 格、`heard` 進 Perception（伺服器從 `messages` 載入最近 10 分鐘）
- [x] `messages` 表：每句話寫入，`heard_by` = 16 格內的其他角色
- [x] 對話規則：說完要等對方回答（依對方思考頻率，最多 3 分鐘）、一段對話最多 8 句或 2 分鐘、結束後冷卻 60 秒；狀態放進感知，伺服器強制執行（該等時說的話會被消音）
- [x] 每日日記 `api/agent/diary`：pg_cron 台北 23:30；當天事件壓縮成摘要 → 固定標題的 Markdown + 一句「明天要記得的事」；日記有保留預算；每個角色用自己的大腦寫
- [x] 短期記憶：最近 10 次思考（想法、說話、動作、結果、區域）放進每次提示詞
- [x] 最近 3 篇日記（各一句記憶）進 system prompt
- [x] 長期知識筆記：思考時可選填 `learn` 記下新發現（去重、3 分鐘最多一則、上限 40）；每晚隨日記整理到 30 則以內
- [x] 會演變的興趣（≤5）與目標（≤3，new / in_progress / done）：每晚隨日記更新；人設核心不變；已離開的角色不會寫進心智
- [x] 日記閱讀頁 `/diary`：日記、現在的想法、最近在意的事、想做的事、筆記、最近的對話（手機優先）
- [x] 每日預算 + 睡覺機制：伺服器端 `AGENT_DAILY_BUDGET_USD`（全站 USD 上限）+ 每個角色的每日次數上限（Gem 470 次）；超過就睡到重置（原訂 `agents/budget.yaml`，改用環境變數與程式設定）
- [x] ✅ 驗收：兩人都有日記，內容只寫真的發生的事（2026-11-11 手動執行並對照事件紀錄驗證；完整一天的自動執行從今晚 23:30 開始）

## 階段 6 — 擴充

- [x] 聊天視窗（T 鍵）：`A → B`（私訊）或 `A → 所有人`；線上名單、選對象、可收合、可捲動、只保留最新 150 則；玩家的話寫進 `messages`（`/api/chat/say` 驗證＋限流），角色聽得到、會回應（私訊從任何地方都聽得到、會讓角色馬上想一下）
- [x] 玩家角色：上線時取名字、選蛇／老虎／猴子；Supabase Realtime 同步線上名單與位置，其他人看得到你的動物、名牌和對話泡泡；角色的感知裡看得到玩家
- [x] 模型暫時錯誤（503 過載、5xx、很快的逾時）自動重試一次；Gem 改用 Gemini 2.5 Flash-Lite 重試
- [x] 小地圖（右上角）：島嶼縮圖、你（箭頭＝面向）、Clio、Gem、其他玩家、角色取過名字的地方；M 鍵或點擊放大並顯示名字（名字互相避讓）
- [x] 日記頁：小島地圖（角色現在位置＋地名）、地名列表；日記／筆記／對話裡的地名可點，地圖上會標出位置
- [x] 日記頁「今天的用量」：Clio 花費 vs 每日預算、Gem 第幾次／每天 500 次（停在 470）、重置倒數（`GET /api/agent/usage`、`agent_usage` RPC）
- [x] 一起蓋東西 ①：設計圖庫（小木屋、瞭望台、碼頭、花圃，只用撿得到的材料）、`plan_build` 選設計圖並劃出工地（自動找平地／海邊）、工地存在角色快照裡、感知看得到進度與缺的材料、遊戲裡顯示半透明工地＋看板、小地圖標出工地
- [ ] 一起蓋東西 ②：照設計圖放方塊（`next` 位置）、分工、完成後變地標並寫進日記
- [x] 手機觸控：左下拇指搖桿（推到底衝刺）、右邊滑動轉視角、跳／挖／放／飛按鈕、暫停與聊天鈕、點方塊列選方塊；手機版面（聊天在左上、地圖在右上、較小方塊列）、可全螢幕（Android）
- [ ] 第 3、4 個角色（再接其他便宜大腦時才加）
- [ ] 地標系統（name_place）+ 小地圖
- [ ] 成本面板（今日每個角色花費）
- [ ] Playwright 回歸測試：載入、走路、挖放、角色生成

## 階段 6.5 — 帳號、存檔、第三人稱、戰鬥

- [x] 有數量的背包（9 格＝快捷列，每格最多 64）：挖到放進背包、放下會減少；新玩家與死亡後拿到初始物資
- [x] 帳號：Supabase Auth（Email + 密碼 + 確認信；確認連結回到原網站並自動登入、可重寄）；`player_saves` 表一人一格（RLS 只能讀寫自己的）
- [x] 存檔：名字、動物、位置、面向、血量、背包；K 鍵／💾 手動存、每分鐘自動存、離開分頁時存；訪客存在瀏覽器
- [x] 登入後讀回上一次的地點和物資（換電腦也行）
- [x] 第三人稱（預設，V 切換）：肩後視角、鏡頭不穿牆、看得到自己的動物
- [x] 一開始 3 顆愛心、體力 60（沒有等級；之後只有特別道具或事件能加上限，死掉也保留）；摔傷、岩漿／火、慢慢回血；受傷畫面閃紅
- [x] 一般模式 ⇄ 戰鬥模式（R）：戰鬥時左鍵攻擊、右鍵閃避（無敵 0.3 秒）、按住 E 防禦（盾牌，擋前方 75%）；戰鬥時不能飛
- [x] 裝備欄：武器／防具／鞋子＋裝備袋 6 格（I 鍵）；角色有基本攻擊 1、防禦 0、速度 4，其餘都由裝備加；起始樹枝、木盾、草鞋
- [x] 武器分近戰（樹枝 +3、木劍 +5、石劍 +7）和遠程魔法（魔法樹枝 +1、水晶法杖 +2，發射魔法彈、耗體力）；近戰強很多
- [x] 史萊姆有機率掉裝備（暫定掉落表，之後再調）
- [x] 夜晚史萊姆：廣場外生成、會跳上 1 格台階、追咬玩家；天亮融化；打倒掉一個玩具方塊；廣場是安全區
- [x] PvP：雙方都在戰鬥模式才打得到；被打的人在自己瀏覽器驗證（距離、頻率、傷害上限）；頭上血條、揮擊／防禦動畫、打倒公告
- [x] 死亡：回廣場重生、物資與裝備回到初始（愛心／體力上限保留；死掉當下就存檔，重新整理也拿不回來）
- [x] 手機：⚔️ 模式鍵、👁 視角鍵；戰鬥時按鈕變攻擊／防禦／閃避
- [ ] 怪物同步給所有玩家（目前每人各自打自己的史萊姆）
- [ ] PvP 改成伺服器判定（目前信任被打的那一方）

## 階段 7 — 合作寫程式

- [ ] 工作台方塊 + `propose_code` / `review_code` 動作
- [ ] Vercel Sandbox 執行角色寫的程式（逾時、無網路）
- [ ] 第一個任務：`build(blueprint) → edits[]` 蓋房子
- [ ] 角色分工（寫 / review / 測試），過程寫進日記
