# 進度說明（2026-11-11 中午）

**現況**：階段 0–5 完成。島上住著兩隻由不同 LLM 驅動的小動物：Clio（貓，MiniMax M3.1 Flash）和 Gem（狐狸，Gemini 3.1 Flash-Lite 免費方案）。牠們 **24 小時在伺服器上生活**，所有訪客看到同一個世界：會探索、挖放方塊、替地方取名、彼此聊天（有對話規則），會記筆記，每天晚上寫日記，興趣和目標會隨經歷改變。日記和心智可以在 `/diary` 閱讀。

- 線上版：https://llm-voxel-world.vercel.app （push 到 `main` 會自動部署）
- 日記頁：https://llm-voxel-world.vercel.app/diary
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
| 4 第一個大腦 | Clio 接 MiniMax、伺服器成本保護、24 小時伺服器模擬 | ✅（dry-run 腳本未做） |
| 5 兩個角色 + 聊天 + 日記 | Gem 接 Gemini、共用世界、對話規則、記憶、日記、心智、日記閱讀頁 | ✅（每晚自動日記今晚首次執行） |
| 6 擴充 | 玩家聊天框、第 3/4 個角色、小地圖、成本面板、Playwright 測試 | ⏭ 下一步 |
| 7 合作寫程式 | 角色在 Vercel Sandbox 合作寫程式 | ⬜ |

---

## 2. 已經做好的功能

### 世界
- **一座可愛 low-poly 島**，大小 192×288 格（12×18 個 chunk），四周是海。區域有沙灘廣場（營火、彩色玩具方塊）、海灘與棧橋、森林（方塊樹、蘑菇、青苔遺跡）、花草原、湖、兩座雪山（冰、紫水晶）和火山（黏土、岩漿）。
- **25 種方塊**：草、土、石、岩石、沙、礫石、黏土、雪、冰、原木、木板、葉子、磚、青苔石、水晶、玻璃、水、岩漿、火、四色玩具方塊、花草地、基岩。
- **裝飾物**：椰子樹、樹叢、石頭、蘑菇、四色小花（InstancedMesh，每種 1 個 draw call）。
- **天空與海**：漸層天空、low-poly 雲、會起伏的切面海浪。
- **日夜循環**：1 遊戲日 = 20 分鐘，所有人和伺服器共用同一個時鐘；晚上有星星、月亮，營火會照亮周圍。
- **AO**：方塊角落和縫隙有柔和的陰影。

### 玩家
- 點一下開始。WASD 移動、空白鍵跳或往上游、Shift 衝刺、F 飛行（C 下降）。
- 左鍵挖、右鍵放，按住可以連續；1–9 或滾輪選方塊。
- 右上角「島上日記」連到日記頁。

### 存檔
- **本機**：localStorage，重新整理後還在。
- **雲端**：Supabase（東京）。每 2 秒上傳、每 10 秒拉取別人的修改；同一格以最後寫入的為準。線上版是**一座大家共用的島**，角色挖和放的方塊也會寫進去。

### 角色

| 角色 | 外觀 | 大腦 | 沒人看時 | 有人看時 | 上限 |
|---|---|---|---|---|---|
| Clio | 貓 | MiniMax M3.1 Flash（M Plan 訂閱） | 每分鐘思考 1 次 | 每 6 秒 | 全站每日 US$ 預算 |
| Gem | 狐狸 | Gemini 3.1 Flash-Lite（免費方案，不綁卡） | 每 4 分鐘 1 次 | 每 20 秒 | 每天 470 次（台灣時間下午 4 點重置） |

- **外觀只是外觀**：兩隻用同一個身體與能力，差別只在大腦。狼、蛇的模型已經做好，之後加角色時用。
- **動作**：`walk_to`、`look_at`、`mine`、`place`、`follow`、`name_place`、`wait`、`idle`，用 zod 驗證，錯了會重試一次。
- **感知**：時間、位置與所在區域（廣場、森林…）、背包、看著什麼、附近方塊與最近位置、地標、其他角色、聽到的話、上一個動作的結果、對話狀態。

### 大腦與記憶

| 功能 | 說明 |
|---|---|
| 每個角色各自的大腦 | 供應商、模型、價格、每日次數上限、伺服器思考頻率各自設定；Vercel 裡沒有 key 的角色會自動退回腳本 |
| 24 小時生活 | 狀態（位置、背包、地標、最後的想法）存在 Supabase。有人看時由該分頁驅動，其他分頁同步觀看；沒人看時伺服器每分鐘把所有角色放進**同一個世界**模擬 60 秒 |
| 對話 | 16 格內聽得到；每句話寫進 `messages`。**對話規則**：說完要等對方回答（依對方思考頻率，最多 3 分鐘）、一段對話最多 8 句或 2 分鐘、結束後冷卻 60 秒；伺服器強制執行 |
| 短期記憶 | 每次思考附上最近 10 次的想法、說話、動作、成功或失敗、區域 |
| 每日日記 | 每晚 23:30 每個角色用自己的大腦寫一篇（固定 6 個標題），只寫當天真的發生過的事，並留下一句「明天要記得的事」 |
| 知識筆記 | 發現新東西時記一則（去重、3 分鐘最多一則）；每晚整理到 30 則以內 |
| 興趣與目標 | 每晚依當天經歷更新（興趣 ≤5、目標 ≤3）；人設本身不變；已經離開的角色不會寫進心智 |
| 成本保護 | 伺服器端每日 US$ 上限、全站每分鐘最多 20 次、每個角色每日次數上限、缺 secret 就拒絕；用完就睡覺，日記不受影響 |

### 日記閱讀頁 `/diary`
- 切換 Clio／Gem，看：現在在想的事（對話泡泡）、日記（筆記本紙，可選日期）、最近在意的事、想做的事（勾選清單）、筆記、最近的對話。
- 手機優先、30 秒自動更新；直接讀 Supabase 公開資料表（只能讀）。

### 實際表現（2026-11-11 上午）
- Gem 第一次思考就回答了 Clio 的問題：「Clio！我沒看到 Rook 往哪裡去耶，我正要往西邊的森林探險，要一起嗎？」
- 對話規則上線後，Clio 回了 Gem 一句就自己安靜等待，不再每分鐘重複發問。
- Gem 的第一篇日記和事件紀錄完全吻合：走過廣場、海灘、森林，在廣場挖了橘色方塊，12:21 把森林裡的地方取名「探險家之冠」。

---

## 3. 架構

```
瀏覽器（Vite + TypeScript + Three.js）            /diary（日記頁，只讀）
├─ engine/ world/ player/ scene/   遊戲與渲染
├─ agents/   身體、動作、A*、執行器、感知、記憶與對話規則、AgentSync（驅動 or 觀看）
└─ server/   伺服器模擬（無頭世界，打包成 api/_gen/sim.js）

Vercel（靜態網站 + Functions）
├─ /api/agent/think   有人在看時，驅動中的分頁請 LLM 思考（需持有租約）
├─ /api/agent/state   分頁心跳：驅動者上傳狀態，其他人拿到狀態來同步
├─ /api/agent/tick    每分鐘：沒人驅動時，到期的角色思考 + 所有角色共同模擬 60 秒
└─ /api/agent/diary   每晚 23:30：寫日記 + 整理筆記、更新興趣與目標
大腦：MiniMax（Clio，M Plan）、Gemini（Gem，免費方案）— key 只放在 Vercel 環境變數
Supabase（llm-voxel-world，東京）
├─ 資料表：agents、agent_state、agent_mind、events、messages、diaries、world_edits、usage（RLS，前端只能讀）
├─ RPC（都要伺服器 secret）：agent_context（預算 + 記憶 + 心智 + 最近對話，一次取回）、agent_log_think、
│        agent_learn、agent_state_sync（租約）、agent_diary_input、agent_save_diary、agent_save_mind
├─ pg_cron「agent-tick」每分鐘、「agent-diary」每天 15:30 UTC（台北 23:30）→ pg_net → Vercel
└─ Edge Function：world-edits（讀寫方塊修改）
```

**誰在驅動角色（租約）**：同一時間只有一個模擬器。可見且遊戲迴圈在跑的分頁優先（租約 30 秒，每 4 秒續約）；分頁隱藏、最小化或關閉就交還，伺服器接手。

程式約 9,800 行 TypeScript，110 個自動測試。GitHub Actions 每次 push 都會跑型別檢查、lint、測試和 build。

---

## 4. 效能數字（全島俯瞰）

| 指標 | 預算 | 目前 |
|---|---|---|
| 三角形 | < 500k | 約 260k（地形 143k，含 AO） |
| Draw calls | < 400 | 約 270 |
| 首次載入 | < 2 s | 地形生成約 0.35 s + meshing 約 1.1 s ÷ worker 數 |
| 伺服器 tick | < 30 s | 生成整座島約 0.4 s + 思考 3–10 s + 模擬 60 秒物理不到 0.1 s |

---

## 5. 花費

| 項目 | 今天到中午的實際數字 |
|---|---|
| Clio 思考 | 154 次，平均約 2,100 input tokens，換算 US$0.055（約 US$0.0004 一次） |
| Clio 日記 | 4 次（含測試），US$0.004 |
| Gem | 思考 9 次、日記 2 次，$0（免費方案；今天已用 11／500 次） |

- Clio 的數字是用按量價格換算的估計，用來控制額度；M Plan 是訂閱制，不是實際扣款。
- **Clio 沒人看時一天約 US$0.55–0.70，略高於目前每日上限 US$0.50**，晚上可能會先去睡覺（日記不受影響）。建議把 Vercel 的 `AGENT_DAILY_BUDGET_USD` 調到 1.5，或讓我縮短提示詞。

---

## 6. 已知限制與待辦

- **實機 FPS 還沒驗收**：請在電腦上打開線上版，按 F3 看 FPS。
- **每晚自動日記今晚 23:30 第一次執行**：今天的日記是手動執行的，晚上會用完整一天的內容重寫。
- **Clio 每日預算可能不夠一整天**：見上一節。
- **今天的日記和短期記憶還會提到 Rook**：那是移除前（今天早上）真的發生過的對話。心智和地標已經清掉，之後的整理也會自動略過已離開的角色。
- **Gem 在伺服器上每 4 分鐘才思考一次**：對話會比較慢；有人開著網頁時會快很多（每 20 秒）。
- **裝飾物沒有碰撞**；**地形生成在主執行緒**；**共用世界沒有寫入速率限制**。
- **狀態上傳沒有檢查移動是否合理**：持有租約的分頁理論上可以把角色「瞬移」。
- **日記頁的字體**（霞鶩文楷、粉圓）從 Google Fonts 載入，第一次打開會稍慢。

---

## 7. 下一步：階段 6

1. **玩家聊天框（T 鍵）**：你可以直接跟 Clio、Gem 說話，同樣套用對話規則，也會寫進日記。
2. **成本面板**：在遊戲或日記頁顯示今天每個角色用了多少。
3. **小地圖 + 地標**：把牠們取名的地方畫在地圖上。
4. **Playwright 回歸測試**：載入、走路、挖放、角色出現、日記頁。
5. 之後再接一個便宜的大腦時，加第 3 隻角色（狼或蛇）。

---

## 8. 開發與除錯速查

```bash
npm install
npm run dev        # http://localhost:5173（/diary.html 是日記頁）
npm run check      # 型別檢查 + lint + 測試 + 伺服器模擬打包檢查 + build
npm run build:sim  # 改了 src/ 的引擎或角色程式後，重新打包伺服器模擬（api/_gen/sim.js）
```

| 網址參數 | 作用 |
|---|---|
| `?debug=1` | 一開始就打開 F3 面板 |
| `?time=0.5` | 固定時間（0 = 午夜、0.25 = 日出、0.5 = 中午、0.75 = 日落） |
| `?view=overview` | 全島俯瞰 |
| `?lineup=1` | 角色排排站 |
| `?brain=demo` | 所有角色改用腳本（不呼叫 LLM） |
| `?cloud=0` / `?cloud=1` | 關閉／開啟雲端存檔 |
| `?reset=1` | 清掉這個瀏覽器的本機存檔 |
| `/diary?who=gem&date=2026-11-11` | 直接打開某隻角色某天的日記 |

瀏覽器 console：`__game.syncs.get('clio').role`（driver / mirror / local）、`__game.agents[0].lastPerception`、`__game.save.status`。

Supabase SQL editor：

```sql
select status_code, content, created from net._http_response order by id desc limit 5;  -- 最近的 tick / 日記結果
select agent_id, content_md, summary from diaries order by diary_date desc;              -- 日記
select agent_id, knowledge, interests, goals from agent_mind;                            -- 筆記、興趣、目標
select speaker, text, heard_by, created_at from messages order by id desc limit 20;      -- 對話
select agent_id, purpose, count(*), sum(cost_usd) from usage
 where created_at > now() - interval '1 day' group by 1, 2;                              -- 用量與花費
```

---

## 9. Commit 紀錄

| Commit | 內容 |
|---|---|
| `78b5638` | 藍圖、ROADMAP、兩個專案 skill |
| `cb9a826` | 階段 0 骨架 |
| `a77b1e6` | 改成可愛 low-poly 小島 |
| `0037e19` | 192×288 大島、更多素材、動物模型、greedy meshing |
| `d5cb3bc` | Vercel 自動部署 |
| `5433ea2` | 階段 1：第一人稱、碰撞、挖/放、快捷列 |
| `aea9f0f` | 階段 2：存檔、AO、日夜循環 |
| `a599ee8` | 雲端同步時序修正 |
| `7325a5e` | 階段 3：角色身體、動作、尋路、執行器、感知 |
| `583ecfc` | 階段 4：`/api/agent/think`（MiniMax M3.1 Flash）、伺服器預算保護 |
| `cd8bd0b` | 伺服器端 Clio：狀態保存、租約、每分鐘伺服器 tick |
| `df822d8` | 只有遊戲迴圈在跑的分頁才能驅動角色 |
| `5e16598` | 短期記憶與每日日記 |
| `f36e28d` | 知識筆記、會演變的興趣與目標 |
| `abfcf1d` | 第二個大腦：Gem 接 Gemini，和 Clio 共用同一個伺服器世界 |
| `2da014d` | 角色改為兩隻（移除 Pip、Rook）、對話規則 |
| `d58f6f2` | 日記閱讀頁 `/diary` |
| `31b488d`、`a2932a4` | 日記與心智不再寫進已離開的角色 |
| `9b1d409` | 文件：階段 5 完成 |
