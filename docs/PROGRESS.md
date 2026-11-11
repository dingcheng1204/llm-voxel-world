# 進度說明（2026-11-11 中午）

**現況**：階段 0–4 完成，階段 5 完成一半（記憶、日記、心智）。島嶼可以玩：第一人稱走、跳、游泳、飛，挖和放方塊，有日夜循環，存檔同步到雲端。Clio（貓）由 LLM（MiniMax M3.1 Flash，M Plan 訂閱）驅動，**在伺服器上 24 小時持續生活**：有人在看時每 6 秒思考一次，沒人在看時每分鐘一次，所有訪客看到同一隻 Clio。她有短期記憶、每天寫日記、會記筆記，興趣和目標會隨經歷演變。另外 3 隻仍是各瀏覽器自己的腳本角色。

- 線上版：https://llm-voxel-world.vercel.app （push 到 `main` 會自動部署）
- 原始碼：https://github.com/dingcheng1204/llm-voxel-world
- 藍圖：[BLUEPRINT.md](./BLUEPRINT.md)；勾選清單：[ROADMAP.md](./ROADMAP.md)；效能：[PERFORMANCE.md](./PERFORMANCE.md)

---

## 1. 階段總覽

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 專案骨架 | Vite + TS + Three.js、遊戲迴圈、F3 效能面板、CI、Vercel 自動部署 | ✅ |
| 1 方塊世界 | 地形、chunk、第一人稱、碰撞、挖/放、快捷列 | ✅（實機 FPS 待確認） |
| 2 世界打磨 | greedy meshing、AO、日夜循環、存檔（localStorage + Supabase）、192×288 大島 | ✅（實機 FPS 待確認） |
| 3 角色身體 | 共用物理、動作 schema、A* 尋路、動作執行器、感知、腳本大腦、10 分鐘持續測試 | ✅ |
| 4 第一個大腦 | Clio 接 MiniMax、伺服器成本保護、伺服器端持續模擬（無人時每分鐘 1 次） | ✅（15 分鐘驗收待觀察） |
| 5 三個角色 + 聊天 + 日記 | ✅ 短期記憶、每日日記、知識筆記、興趣與目標　⬜ Gem/Pip 上伺服器、互相聊天、日記閱讀頁 | 🔶 進行中 |
| 6 擴充 | 玩家聊天框、Grok/Llama/Qwen、小地圖、成本面板 | ⬜ |
| 7 合作寫程式 | 角色在 Vercel Sandbox 合作寫程式 | ⬜ |

---

## 2. 已經做好的功能

### 世界
- **一座可愛 low-poly 島**，大小 192×288 格（12×18 個 chunk），四周是海。區域有沙灘廣場（營火、彩色玩具方塊）、海灘與棧橋、森林（方塊樹、蘑菇、青苔遺跡）、花草原、湖、兩座雪山（冰、紫水晶）和火山（黏土、岩漿）。
- **25 種方塊**：草、土、石、岩石、沙、礫石、黏土、雪、冰、原木、木板、葉子、磚、青苔石、水晶、玻璃、水、岩漿、火、四色玩具方塊、花草地、基岩。
- **裝飾物**：椰子樹、樹叢、石頭、蘑菇、四色小花。每一種只佔 1 個 draw call（InstancedMesh）。
- **天空與海**：漸層天空、low-poly 雲、會起伏的切面海浪。
- **日夜循環**：1 遊戲日 = 20 分鐘，所有人共用同一個時鐘。清晨、白天、傍晚、夜晚都有不同的天色，晚上有星星和月亮，營火會照亮周圍。
- **AO**：方塊角落和縫隙有柔和的陰影。

### 玩家
- 點一下開始。WASD 移動、空白鍵跳或往上游、Shift 衝刺、F 飛行（C 下降）。
- 左鍵挖、右鍵放，按住可以連續；1–9 或滾輪選方塊（草、土、石、原木、木板、磚、玩具方塊、水、火）。
- AABB 碰撞，高速下落也不會穿過地板；不能把方塊放在自己或角色身上。

### 存檔
- **本機**：挖和放的結果存在 localStorage，重新整理後還在。
- **雲端**：Supabase 專案 `llm-voxel-world`（東京）。網頁每 2 秒上傳、每 10 秒拉取別人的修改；離線時先排隊，同一格以最後寫入的為準。
- 線上版是**一座大家共用的島**。本機開發預設不連雲端，網址加 `?cloud=1` 才會連。

### 角色（4 隻）

| 角色 | 外觀 | 大腦 | 在哪裡跑 |
|---|---|---|---|
| Clio | 貓 | **LLM：MiniMax M3.1 Flash** | **伺服器（大家共用、24 小時）** |
| Gem | 狐狸 | 腳本（探索；預定 Gemini） | 每個瀏覽器各自一隻 |
| Pip | 狼 | 腳本（採集；預定 ChatGPT） | 每個瀏覽器各自一隻 |
| Rook | 蛇 | 腳本（探索；預定 Grok 或其他） | 每個瀏覽器各自一隻 |

- **外觀只是外觀**：4 隻用同一個身體（物理、速度、感知、動作都一樣），差別只在操控的大腦。
- **動作**：`walk_to`、`look_at`、`mine`、`place`、`follow`、`name_place`、`wait`、`idle`。用 zod 驗證，格式錯誤時把原因回傳給大腦重試一次。
- **尋路**：3D A*，能跳上 1 格、跳下 3 格，斜走不切角，避開水、岩漿和海。
- **感知**：每次思考時給大腦一份 JSON：時間、位置與所在區域（廣場、森林…）、背包、看著什麼、附近的方塊與最近的位置、地標、其他角色、聽到的話、上一個動作的結果。
- **除錯**：按 F3 會顯示每個角色的路徑線、正在做的事、背包和想法；`clio brain` 一行顯示 driver/mirror、呼叫次數和今日花費。

### Clio 的大腦（階段 4–5）

| 功能 | 說明 |
|---|---|
| 思考 | 每次把人設 + 記憶 + 感知送給 MiniMax，回傳 `{thought, say, learn, actions}`；想法和說話會變成頭上的泡泡 |
| 成本保護（伺服器端） | 每日預算（`AGENT_DAILY_BUDGET_USD`，預設 US$0.50，台北時間歸零）、全站每分鐘最多 20 次、只允許名單內角色、缺 secret 就拒絕 |
| 24 小時生活 | 狀態（位置、背包、地標、最後的想法）存在 Supabase；有人看時由該分頁驅動，沒人看時伺服器每分鐘思考一次並模擬 60 秒（和瀏覽器同一套物理） |
| 短期記憶 | 每次思考附上最近 10 次的想法、說話、動作、成功或失敗、所在區域，避免重複做同一件事 |
| 每日日記 | 每晚 23:30 根據當天真正發生的事寫一篇（固定 6 個標題），並留下一句「明天要記得的事」；最近 3 句放進之後每次思考 |
| 知識筆記 | 發現新東西時可記一則（去重、3 分鐘最多一則）；每晚整理成 30 則以內，最新 12 則放進提示詞 |
| 興趣與目標 | 每晚依當天經歷更新「最近在意的事」（≤5）和「目標」（≤3，新的／進行中／完成）；人設本身不變 |

**實際表現（2026-11-11 上午）**：她替廣場周圍取了「藍色方塊小徑」等地名、挖起藍色玩具方塊放進背包；第一篇日記寫完後，下一分鐘就照著「明天想再去找 rook」去找 Rook；建立心智後立刻開始追「找 rook 問他藏在樹後的目的」這個目標。

---

## 3. 架構

```
瀏覽器（Vite + TypeScript + Three.js）
├─ engine/   遊戲迴圈（60 Hz 固定步長）、渲染器、F3 面板
├─ world/    地形、chunk、greedy+AO mesher（Web Worker）、raycast、存檔同步
├─ player/   第一人稱控制、AABB 物理（角色也共用）、快捷列
├─ scene/    天空、海、雲、日夜、裝飾物、火焰
├─ agents/   身體、動作 schema、A*、執行器、感知、大腦（LLM / 腳本）、AgentSync（驅動/觀看切換）
└─ server/   伺服器模擬（無頭世界，打包成 api/_gen/sim.js）

Vercel（靜態網站 + Functions，push 自動部署）
├─ /api/agent/think   有人在看時，驅動中的分頁請 LLM 思考（需持有租約）
├─ /api/agent/state   分頁心跳：驅動者上傳狀態，其他人拿到狀態來同步
├─ /api/agent/tick    每分鐘一次：無人驅動時，伺服器思考 1 次 + 模擬 60 秒
└─ /api/agent/diary   每晚 23:30：寫日記 + 整理筆記、更新興趣與目標
MiniMax（OpenAI 相容 API，M Plan 訂閱 key 只放在 Vercel 環境變數）
Supabase（llm-voxel-world，東京）
├─ 資料表：agents、agent_state、agent_mind、events、messages、diaries、world_edits、usage（RLS 全開，前端只能讀）
├─ RPC（都要伺服器 secret）：agent_context（預算 + 記憶 + 心智，一次取回）、agent_log_think、agent_learn、
│        agent_state_sync（租約）、agent_diary_input、agent_save_diary、agent_save_mind
├─ pg_cron「agent-tick」每分鐘、「agent-diary」每天 15:30 UTC（台北 23:30）→ pg_net → Vercel
└─ Edge Function：world-edits（讀寫方塊修改，管理員金鑰只在伺服器端）
```

**誰在驅動 Clio（租約 lease）**：同一時間只有一個模擬器。可見且遊戲迴圈在跑的分頁優先（租約 30 秒，每 4 秒續約）；分頁隱藏、最小化或關閉就交還，伺服器 tick 接手。每次思考都扣同一份每日預算（預設 US$0.50，台北時間每天歸零）。

程式約 8,800 行 TypeScript，94 個自動測試。GitHub Actions 每次 push 都會跑型別檢查、lint、測試和 build。

---

## 4. 效能數字（全島俯瞰）

| 指標 | 預算 | 目前 |
|---|---|---|
| 三角形 | < 500k | 約 260k（地形 143k，含 AO） |
| Draw calls | < 400 | 約 270 |
| 首次載入 | < 2 s | 地形生成約 0.35 s + meshing 約 1.1 s ÷ worker 數 |
| 4 個角色 | — | 每幀不到 0.1 ms；LLM 在雲端跑，不佔瀏覽器效能 |

主要優化：greedy meshing（三角形 −84%）、Web Worker meshing、Uint8 頂點資料、共用材質、shader 計算光線和方塊深淺、裝飾物用 InstancedMesh。

---

## 5. 花費（換算估計）

| 項目 | 數字 |
|---|---|
| 每次思考 | 約 2,600 input + 150 output tokens ≈ **US$0.0005**（加入記憶前約 US$0.0002） |
| 沒人看（每分鐘 1 次） | 一天約 US$0.72 |
| 有人看（每 6 秒 1 次） | 一小時約 US$0.30 |
| 每日日記 | 每天約 US$0.001 |

M Plan 是訂閱制，以上是用按量價格換算的估計，用來控制額度，不是實際扣款。**目前的每日上限 US$0.50 不夠 24 小時運作**，用完 Clio 會睡到隔天（日記不受影響）。建議把 Vercel 的 `AGENT_DAILY_BUDGET_USD` 調到 1.5，或縮短提示詞。

---

## 6. 已知限制與待辦

- **實機 FPS 還沒驗收**：雲端環境沒有 GPU，請在電腦上打開線上版，按 F3 看 FPS。
- **裝飾物沒有碰撞**：玩家和角色會穿過椰子樹、樹叢和石頭。
- **只有 Clio 在伺服器上跑**：Gem、Pip、Rook 仍是每個瀏覽器各自的腳本角色，牠們挖和放的結果只存在本機。
- **狀態上傳沒有檢查移動是否合理**：座標範圍、背包數量都有驗證，但持有租約的分頁理論上可以把 Clio「瞬移」。
- **無人時每分鐘只思考一次**：計畫做完就原地休息到下一分鐘。
- **每日預算會在晚上用完**：見上一節。
- **日記會提到 Gem、Pip、Rook**：那是有人開網頁時在瀏覽器裡遇到的腳本角色；伺服器上的 Clio 其實看不到牠們，要等牠們也搬上伺服器。
- **日記還沒有閱讀頁**：目前只能在 Supabase 的 `diaries` 表看；心智在 `agent_mind` 表。
- **地形生成在主執行緒**：載入速度會受 FPS 影響，必要時搬進 worker。
- **共用世界沒有速率限制**：任何人都能挖和放；Edge Function 有檢查座標和數量，但還沒限制頻率。
- **Supabase 安全提示**：`events`、`usage` 兩張表沒有開放權限（刻意的，只給伺服器用）。

---

## 7. 下一步

1. **預算決定**：調高 `AGENT_DAILY_BUDGET_USD`，或縮短記憶（短期 6 筆、筆記 8 則，約省 30%）。
2. **日記閱讀頁 `/diary`**：每天的日記、她的筆記、興趣和目標。
3. **Gem、Pip 也上伺服器**：一次 tick 跑多個角色、共用同一個世界，各接一個便宜的大腦。
4. **互相聊天**：聽覺範圍 16 格、對話輪數上限與冷卻，說話寫進 `messages`，也寫進日記。

---

## 8. 開發與除錯速查

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # 型別檢查 + lint + 測試 + build
```

| 網址參數 | 作用 |
|---|---|
| `?debug=1` | 一開始就打開 F3 面板 |
| `?time=0.5` | 固定時間（0 = 午夜、0.25 = 日出、0.5 = 中午、0.75 = 日落） |
| `?view=overview` | 全島俯瞰 |
| `?lineup=1` | 4 隻角色排排站 |
| `?cloud=0` / `?cloud=1` | 關閉／開啟雲端存檔 |
| `?reset=1` | 清掉這個瀏覽器的本機存檔 |
| `?pr=1` `?aa=1` | 解析度上限、反鋸齒 |

在瀏覽器 console 可以用 `__game` 檢查狀態，例如 `__game.agents[0].lastPerception`、`__game.save.status`、`__game.world.stats`、`__game.syncs.get('clio').role`（driver / mirror / local）。

在 Supabase SQL editor 可以查：

```sql
select status_code, content, created from net._http_response order by id desc limit 5;  -- 最近的 tick / 日記結果
select content_md, summary from diaries where agent_id = 'clio' order by diary_date desc;  -- 日記
select knowledge, interests, goals from agent_mind where agent_id = 'clio';                -- 筆記、興趣、目標
select purpose, sum(cost_usd) from usage where created_at > now() - interval '1 day' group by 1;  -- 花費
```

---

## 9. Commit 紀錄

| Commit | 內容 |
|---|---|
| `78b5638` | 藍圖、ROADMAP、兩個專案 skill |
| `cb9a826` | 階段 0 骨架 |
| `a77b1e6` | 改成可愛 low-poly 小島 |
| `0037e19` | 192×288 大島、更多素材、4 隻動物、greedy meshing |
| `d5cb3bc` | Vercel 自動部署 |
| `5433ea2` | 階段 1：第一人稱、碰撞、挖/放、快捷列 |
| `aea9f0f` | 階段 2：存檔、AO、日夜循環 |
| `a599ee8` | 雲端同步時序修正 |
| `7325a5e` | 階段 3：角色身體、動作、尋路、執行器、感知 |
| `583ecfc` | 階段 4：`/api/agent/think`（MiniMax M3.1 Flash）、伺服器預算保護、Clio 的 LLM 大腦 |
| `cd8bd0b` | 伺服器端 Clio：狀態保存、租約、每分鐘伺服器 tick |
| `df822d8` | 只有遊戲迴圈在跑的分頁才能驅動角色 |
| `5e16598` | 短期記憶與每日日記 |
| `a615c54` | vercel.json 修正（函式逾時 60 秒） |
| `f36e28d` | 知識筆記、會演變的興趣與目標 |
