# LLM Voxel World — 藍圖

一個用瀏覽器就能玩的方塊世界（類 Minecraft）。世界裡住著幾個由不同 LLM 驅動的角色：他們都對世界充滿好奇、會探索、會聊天、會一起蓋東西，而且每天都會寫日記。最後一階段讓他們合作寫程式。

---

## 1. 目標與非目標

**目標**
- 單人、瀏覽器內、60 FPS 的方塊世界：可以走、跳、挖、放方塊。
- 3 個 AI 角色（Claude、Gemini、ChatGPT），之後擴充 Grok、Meta Llama、Qwen。
- 角色間可以對話；玩家也可以跟角色聊天。
- 每個角色每天寫一篇日記，可在網頁上閱讀。日記同時是角色的長期記憶。
- 部署在 Vercel，資料放在 Supabase。

**美術方向**：可愛 low-poly 島嶼，全島 **192×288 格**，外圍是海。區域：沙灘廣場、海灘、森林、花草原、湖、雪山、火山。
素材：草、土、沙、石頭、岩石、雪、冰、黏土、礫石、岩漿、磚、青苔石、水晶、木頭、木板、葉子、水、火、彩色玩具方塊。詳見 `voxel-engine` skill §5、§10。

**角色**：4 個可愛 low-poly 動物（貓、狐狸、狼、蛇）同時活動。**物種只是外觀**，能力完全相同，差別只在背後操控的 LLM。

**非目標（至少前 5 階段不做）**
- 多人連線、生存模式（血量、怪物）、合成系統、無限高度、行動裝置操作。

---

## 2. 系統架構

```
┌──────────────────────── Browser (Vite + TS + Three.js) ────────────────────────┐
│  engine/   render loop · input · debug overlay (F3)                            │
│  world/    chunks · terrain(seed) · mesher(worker) · raycast · edits           │
│  player/   controller · physics(AABB)                                          │
│  agents/   Agent bodies · ActionExecutor · A* pathfinding · perceive()         │
│  ui/       hotbar · chat box · thought bubbles · diary reader                  │
└──────────────┬──────────────────────────────────────────────┬──────────────────┘
               │ POST /api/agent/think (perception → actions) │ supabase-js (read)
               ▼                                              ▼
┌──────── Vercel Functions ────────┐            ┌──────────── Supabase ───────────┐
│ /api/agent/think   AI SDK        │──write────▶│ agents · events · messages      │
│ /api/agent/say     log chat      │            │ diaries · world_edits · usage   │
│ /api/cron/diary    daily diaries │◀──read─────│                                 │
└──────────┬───────────────────────┘            └─────────────────────────────────┘
           ▼
   Vercel AI Gateway（或 OpenRouter）
   ├─ Anthropic (Claude)   ├─ Google (Gemini)   ├─ OpenAI (ChatGPT)
   └─ 之後：xAI (Grok) · Meta (Llama) · Alibaba (Qwen)
```

**關鍵決定**

| 決定 | 選擇 | 理由 |
|---|---|---|
| 渲染 | 原生 Three.js（不用 R3F） | 遊戲迴圈和 chunk 管理用命令式寫法比較直接、好調效能 |
| 語言 | TypeScript strict | 動作 JSON、方塊 ID 等契約靠型別守住 |
| 模擬在哪跑 | 瀏覽器（玩家開著頁面時） | 最簡單；伺服器只負責「思考」和存資料 |
| LLM 呼叫 | 只在 Vercel Function | API key 不進前端；統一記錄用量 |
| 多家模型 | AI SDK + AI Gateway | 一個介面切換多家，換模型只改設定 |
| 日記 | Vercel Cron 每天跑 | 玩家沒開頁面也照樣寫（讀 events 表） |

> ⚠️ ChatGPT Plus / Claude Pro / Gemini 訂閱**不能**當 API 用，要另外申請 API key 並按用量計費。

---

## 3. 方塊引擎

完整規範見 `.claude/skills/voxel-engine/SKILL.md`。重點：
- Y 軸朝上；chunk 為 16×16×64，存成 `Uint8Array`，index = `x + z*16 + y*256`。
- 世界是一座島（12×18 個 chunk = 192×288 格），海是動畫平面，不是水方塊。
- Greedy meshing：相鄰同材質的面合併，方塊亮度差異在 shader 計算。
- 方塊 ID 只能往後加、不能重編（存檔格式依賴它）。
- 只存「編輯過的方塊」，地形由 seed 決定、隨時可重算。
- 先做 face culling，之後在 Web Worker 做 greedy meshing。
- 撿方塊用 voxel DDA raycast，玩家和角色共用同一套物理與碰撞。

---

## 4. AI 角色

完整規範見 `.claude/skills/agent-persona/SKILL.md`。

### 4.1 一個角色 = 人設 + 大腦 + 身體（外觀 = 物種）
- **人設**：`agents/personas/<id>.yaml`（性格、說話方式、興趣、日記語言）
- **大腦**：一個 LLM 模型（透過 AI Gateway）
- **身體**：共用的 `AgentBody`，只會執行動作；物種（貓/狐狸/狼/蛇）只換模型，不換能力

### 4.2 思考迴圈
```
          ┌──────────── 每 6–20 秒，或聽到有人跟它說話 ────────────┐
          ▼                                                         │
 perceive() ──▶ POST /api/agent/think ──▶ LLM ──▶ JSON {thought,say,actions}
                       │                               │ zod 驗證（失敗重試 1 次）
                       │ 寫 usage、events              ▼
                       ▼                      ActionExecutor（A*、挖、放…）
                   Supabase                            │
                                                       └─▶ last_action_result
```

### 4.3 對話
- `say` 讓 16 格內的所有人（含玩家）聽到。
- 兩個角色之間一段對話最多 8 輪或 2 分鐘，結束後各自冷卻 60 秒，避免無限聊天燒錢。

### 4.4 記憶與日記
- **短期**：今天的事件摘要（≤ 600 tokens）。
- **長期**：最近 3 篇日記。
- **日記**：每天 23:30（台北時間）由 cron 為每個角色產生一篇，固定六個標題（今天做了什麼／發現／聊天／疑問／心情／明天想做），只能寫事件紀錄裡真的發生過的事。

### 4.5 成本控制
- 角色身邊沒人又沒事時，最多每 60 秒思考一次。
- 日常思考可以用便宜的 `think_model`，日記才用主力模型。
- `agents/budget.yaml` 設定每個角色每天的 token/美金上限，超過就「去睡覺」到隔天。日記的預算另外保留。
- 所有呼叫都記到 `usage` 表，debug 面板顯示今日花費。

---

## 5. 資料模型（Supabase / Postgres）

```sql
create table agents (
  id text primary key,                -- 'clio'
  display_name text not null,
  provider text not null,             -- 'anthropic' | 'google' | 'openai' | ...
  model text not null,
  persona jsonb not null,
  created_at timestamptz default now()
);

create table events (                 -- 給日記和記憶用的事件紀錄
  id bigint generated always as identity primary key,
  agent_id text references agents(id),
  game_day int not null,
  kind text not null,                 -- 'action' | 'discovery' | 'landmark' | 'think' | ...
  payload jsonb not null,
  created_at timestamptz default now()
);
create index on events (agent_id, created_at);

create table messages (
  id bigint generated always as identity primary key,
  speaker text not null,              -- agent id 或 'player'
  text text not null,
  pos int[3],
  heard_by text[] not null default '{}',
  created_at timestamptz default now()
);

create table diaries (
  id bigint generated always as identity primary key,
  agent_id text references agents(id),
  diary_date date not null,
  game_day int,
  content_md text not null,
  model text not null,
  created_at timestamptz default now(),
  unique (agent_id, diary_date)
);

create table world_edits (
  seed bigint not null,
  x int not null, y int not null, z int not null,
  block_id smallint not null,
  by text not null,
  updated_at timestamptz default now(),
  primary key (seed, x, y, z)
);

create table usage (
  id bigint generated always as identity primary key,
  agent_id text references agents(id),
  model text not null,
  purpose text not null,              -- 'think' | 'diary'
  input_tokens int, output_tokens int, cost_usd numeric(10,5),
  created_at timestamptz default now()
);
```

RLS：前端用公開金鑰只能 `select` agents / diaries / messages / world_edits；events、usage 完全不開放。寫入一律透過伺服器端（Edge Function 或 Vercel Function）使用 service role。

Supabase 專案：`llm-voxel-world`（ap-northeast-1 東京）。SQL 在 `supabase/migrations/`，Edge Function 在 `supabase/functions/`。

部署的網站是**一座大家共用的島**：每位訪客和之後的 AI 角色都在同一個世界挖和放方塊（最後寫入的為準）。本機開發預設不連雲端。

---

## 6. API

| Endpoint | 方法 | 說明 |
|---|---|---|
| `/api/agent/think` | POST | `{agentId, perception}` → `{thought, say, actions}`；檢查預算、記錄 usage 和 events |
| `/api/agent/event` | POST | 批次寫入事件（動作結果、發現、命名地點） |
| `/api/chat` | POST | 寫入一則 `say` 或玩家訊息 |
| Supabase Edge Function `world-edits` | GET/POST | 讀寫方塊編輯（已上線；service role 只在伺服器端） |
| `/api/cron/diary` | GET (cron) | 為每個角色產生當日日記；`vercel.json` 設 `30 15 * * *`（UTC = 台北 23:30） |

環境變數：見 `.env.example`。

---

## 7. 開發工具

| 工具 | 用途 |
|---|---|
| Skill `voxel-engine` | 引擎座標、chunk、方塊 ID 規範 |
| Skill `agent-persona` | 人設格式、prompt、動作契約、日記格式 |
| Skill `frontend-design` | 聊天框、日記閱讀頁等 UI |
| Chrome DevTools MCP | 截圖、看 console、錄 performance trace（3D 除錯主力） |
| Playwright MCP | 之後做自動化回歸測試 |
| Context7 MCP | 查 Three.js / AI SDK / Supabase 最新文件 |
| Supabase MCP、Vercel MCP | 建表、migration、部署、看 log |

---

## 8. 開發順序

詳細的勾選清單見 [`ROADMAP.md`](./ROADMAP.md)。

| 階段 | 名稱 | 完成的樣子 |
|---|---|---|
| 0 | 專案骨架 | Vite + TS + Three.js 跑起來，看到一個方塊；CI 跑 typecheck/lint |
| 1 | 方塊世界 MVP | 種子地形、第一人稱、碰撞、挖/放、快捷列，60 FPS |
| 2 | 世界打磨 | 存檔（localStorage → Supabase）、greedy meshing + worker、日夜循環、水 |
| 3 | 角色身體（無 LLM） | NPC 實體、動作執行器、A* 尋路、寫死腳本也能跑 |
| 4 | 第一個大腦 | Claude 接上 `/api/agent/think`，會自己探索、說話、顯示想法泡泡 |
| 5 | 三人 + 聊天 + 日記 | 加入 Gemini、ChatGPT；角色互聊；每日日記 + 日記閱讀頁 |
| 6 | 擴充 | 玩家聊天框、Grok / Llama / Qwen、地標系統、成本面板 |
| 7 | 合作寫程式 | 角色在 Vercel Sandbox 合作寫小程式（例如自動蓋房子的腳本），結果回到世界裡 |

每個階段都要：可以部署到 Vercel 預覽網址、用 Chrome DevTools MCP 截圖驗證、更新 ROADMAP 勾選。

---

## 9. 第 7 階段構想：合作寫程式

- 角色多一個動作 `propose_code`／`review_code`，在一個共用的「工作台」方塊旁觸發。
- 程式碼在 **Vercel Sandbox**（隔離環境）執行，不在玩家瀏覽器跑。
- 第一個任務範例：寫一個函式 `build(blueprint) → edits[]`，產生蓋房子的方塊清單，由世界套用。
- 一個角色寫、一個角色 review、一個角色測試，對話和程式碼都存進 `messages` / `events`，也寫進日記。

---

## 10. 風險

| 風險 | 對策 |
|---|---|
| LLM 費用失控 | 思考頻率限制、對話輪數上限、每日預算、便宜的 think_model |
| LLM 輸出格式錯 | zod 驗證 + 重試 1 次 + fallback `idle` |
| 角色卡住（尋路失敗） | A* 節點上限、失敗結果回報給大腦、超過 3 次就隨機漫步 |
| FPS 下降 | worker meshing、geometry dispose、draw call 預算、先錄 trace 再改 |
| 角色互相附和、聊天無聊 | 每個人的好奇方式不同；對話冷卻；日記裡的「疑問」回饋到隔天行動 |
| API key 外洩 | 只放 Vercel 環境變數；前端永遠不碰 key |
