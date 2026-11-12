# LLM Voxel World — 藍圖

一個用瀏覽器就能玩的方塊世界（類 Minecraft）。世界裡住著幾個由不同 LLM 驅動的角色：他們都對世界充滿好奇、會探索、會聊天、會一起蓋東西，而且每天都會寫日記。最後一階段讓他們合作寫程式。

---

## 1. 目標與非目標

**目標**

- 單人、瀏覽器內、60 FPS 的方塊世界：可以走、跳、挖、放方塊。
- 2 個 AI 角色：Clio（MiniMax M3.1 Flash）、Gem（Gemini 3.1 Flash-Lite 免費方案）。每接上一個新的便宜大腦，才加一個角色（最多 4 個）。
- 角色間可以對話；玩家也可以跟角色聊天。
- 每個角色每天寫一篇日記，可在網頁上閱讀。日記同時是角色的長期記憶。
- 部署在 Vercel，資料放在 Supabase。

**美術方向**：可愛 low-poly 島嶼，全島 **192×288 格**，外圍是海。區域：沙灘廣場、海灘、森林、花草原、湖、雪山、火山。
素材：草、土、沙、石頭、岩石、雪、冰、黏土、礫石、岩漿、磚、青苔石、水晶、木頭、木板、葉子、水、火、彩色玩具方塊。詳見 `voxel-engine` skill §5、§10。

**角色**：可愛 low-poly 動物（目前貓 Clio、狐狸 Gem；狼、蛇模型已備好）。**物種只是外觀**，能力完全相同，差別只在背後操控的 LLM。

**非目標**

- 合成系統、無限高度。（多人連線、手機操作已在階段 6 加入；血量、夜晚怪物、PvP 與帳號存檔在階段 6.5 加入，見 §11。）

---

## 2. 系統架構

```
┌──────────────── Browser (Vite + TS + Three.js) ────────────────┐   ┌──── /diary（日記閱讀頁）────┐
│ engine/ world/ player/ scene/   遊戲與渲染                      │   │ 讀公開資料表，30 秒更新     │
│ agents/  身體、動作、A*、感知、AgentSync（驅動 or 觀看）        │   └──────────────┬──────────────┘
└───────┬──────────────────────────────────────┬─────────────────┘                  │ read
        │ /api/agent/think · /api/agent/state  │ world-edits（edge fn）             │
        ▼                                      ▼                                    ▼
┌──────────── Vercel Functions ────────────┐   ┌──────────────── Supabase ─────────────────────┐
│ think   有人在看時，驅動分頁請 LLM 思考   │──▶│ agent_state（位置/背包…＋租約） agent_mind     │
│ state   心跳：驅動者存狀態、其他人同步   │   │ events · messages · diaries · usage · world_edits│
│ tick    每分鐘：伺服器無頭模擬所有角色   │◀──│ pg_cron：agent-tick（每分鐘）、agent-diary（23:30）│
│ diary   每晚：日記＋整理心智             │   └────────────────────────────────────────────────┘
└──────┬───────────────────┬───────────────┘
       ▼                   ▼
  MiniMax M3.1 Flash   Gemini 3.1 Flash-Lite
  （Clio，M Plan）      （Gem，免費方案）
```

**關鍵決定**

| 決定       | 選擇                                                             | 理由                                                               |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| 渲染       | 原生 Three.js（不用 R3F）                                        | 遊戲迴圈和 chunk 管理用命令式寫法比較直接、好調效能                |
| 語言       | TypeScript strict                                                | 動作 JSON、方塊 ID 等契約靠型別守住                                |
| 模擬在哪跑 | 有人看：驅動中的分頁；沒人看：伺服器每分鐘無頭模擬（同一套引擎） | 角色 24 小時生活、所有人看到同一個世界；租約保證同時只有一個模擬器 |
| LLM 呼叫   | 只在 Vercel Function                                             | API key 不進前端；統一記錄用量                                     |
| 多家模型   | 直接呼叫各家的 OpenAI 相容 API（每個角色一組設定）               | 可以用訂閱方案或免費方案的 key，費用可控                           |
| 排程       | Supabase pg_cron（每分鐘 tick、每晚日記）                        | Vercel 免費方案的 cron 一天只能跑一次                              |

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

**誰在跑思考迴圈（2026-11 起，伺服器端角色）**：LLM 角色存在伺服器上，所有訪客看到同一隻，沒人看時也繼續生活。
同一時間只有一個模擬器「驅動」角色（Supabase `agent_state` + `agent_state_sync` 租約）：

| 情況                                   | 驅動者                                                           | 思考頻率    |
| -------------------------------------- | ---------------------------------------------------------------- | ----------- |
| 有人開著網頁（分頁可見、遊戲迴圈在跑） | 該分頁（其他分頁同步觀看）                                       | 約 6 秒一次 |
| 沒人在看                               | 伺服器：pg_cron 每分鐘 → `/api/agent/tick`，無頭模擬整座島 60 秒 | 每分鐘 1 次 |

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

| Endpoint                             | 方法           | 說明                                                                                                                      |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent/think`                   | POST           | `{agentId, clientId, perception}` → `{raw, cost, …}`；需持有租約；檢查預算、記錄 usage 和 events                          |
| `/api/agent/state`                   | POST           | 分頁心跳 `{agentId, clientId, state?, release?}` → `{driver, state}`；驅動者上傳狀態，其他人同步                          |
| `/api/agent/tick`                    | POST (pg_cron) | 每分鐘一次，header `x-agent-secret`；沒有分頁驅動時，伺服器讓到期的角色思考（Clio 每分鐘、Gem 每 4 分鐘）+ 共同模擬 60 秒 |
| `/api/agent/diary`                   | POST (pg_cron) | 每天台北 23:30：每個角色用自己的大腦寫日記，並整理筆記、更新興趣與目標                                                    |
| `/diary`                             | 頁面           | 日記閱讀頁（公開讀取 Supabase：diaries、agent_mind、agent_state、messages）                                               |
| `/api/agent/event`                   | POST           | 批次寫入事件（動作結果、發現、命名地點）                                                                                  |
| `/api/chat`                          | POST           | 寫入一則 `say` 或玩家訊息                                                                                                 |
| Supabase Edge Function `world-edits` | GET/POST       | 讀寫方塊編輯（已上線；service role 只在伺服器端）                                                                         |

環境變數：見 `.env.example`。

---

## 7. 開發工具

| 工具                     | 用途                                                  |
| ------------------------ | ----------------------------------------------------- |
| Skill `voxel-engine`     | 引擎座標、chunk、方塊 ID 規範                         |
| Skill `agent-persona`    | 人設格式、prompt、動作契約、日記格式                  |
| Skill `frontend-design`  | 聊天框、日記閱讀頁等 UI                               |
| Chrome DevTools MCP      | 截圖、看 console、錄 performance trace（3D 除錯主力） |
| Playwright MCP           | 之後做自動化回歸測試                                  |
| Context7 MCP             | 查 Three.js / AI SDK / Supabase 最新文件              |
| Supabase MCP、Vercel MCP | 建表、migration、部署、看 log                         |

---

## 8. 開發順序

詳細的勾選清單見 [`ROADMAP.md`](./ROADMAP.md)。

| 階段 | 名稱               | 完成的樣子                                                                 |
| ---- | ------------------ | -------------------------------------------------------------------------- |
| 0    | 專案骨架           | Vite + TS + Three.js 跑起來，看到一個方塊；CI 跑 typecheck/lint            |
| 1    | 方塊世界 MVP       | 種子地形、第一人稱、碰撞、挖/放、快捷列，60 FPS                            |
| 2    | 世界打磨           | 存檔（localStorage → Supabase）、greedy meshing + worker、日夜循環、水     |
| 3    | 角色身體（無 LLM） | NPC 實體、動作執行器、A* 尋路、寫死腳本也能跑                              |
| 4    | 第一個大腦         | Clio 接 MiniMax、伺服器成本保護、24 小時伺服器模擬                         |
| 5    | 兩人 + 聊天 + 日記 | Gem 接 Gemini；角色互聊（對話規則）；每日日記、記憶、心智 + 日記閱讀頁     |
| 6    | 擴充               | 玩家聊天框、第 3/4 個角色（新的便宜大腦）、地標系統、成本面板              |
| 7    | 合作寫程式         | 角色在 Vercel Sandbox 合作寫小程式（例如自動蓋房子的腳本），結果回到世界裡 |

每個階段都要：可以部署到 Vercel 預覽網址、用 Chrome DevTools MCP 截圖驗證、更新 ROADMAP 勾選。

---

## 9. 第 7 階段構想：合作寫程式

- 角色多一個動作 `propose_code`／`review_code`，在一個共用的「工作台」方塊旁觸發。
- 程式碼在 **Vercel Sandbox**（隔離環境）執行，不在玩家瀏覽器跑。
- 第一個任務範例：寫一個函式 `build(blueprint) → edits[]`，產生蓋房子的方塊清單，由世界套用。
- 一個角色寫、一個角色 review、一個角色測試，對話和程式碼都存進 `messages` / `events`，也寫進日記。

---

## 10. 風險

| 風險                   | 對策                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| LLM 費用失控           | 思考頻率限制、對話輪數上限、每日預算、便宜的 think_model          |
| LLM 輸出格式錯         | zod 驗證 + 重試 1 次 + fallback `idle`                            |
| 角色卡住（尋路失敗）   | A* 節點上限、失敗結果回報給大腦、超過 3 次就隨機漫步              |
| FPS 下降               | worker meshing、geometry dispose、draw call 預算、先錄 trace 再改 |
| 角色互相附和、聊天無聊 | 每個人的好奇方式不同；對話冷卻；日記裡的「疑問」回饋到隔天行動    |
| API key 外洩           | 只放 Vercel 環境變數；前端永遠不碰 key                            |

---

## 11. 帳號、存檔與戰鬥（階段 6.5）

**帳號**：Supabase Auth，Email + 密碼，開著 email 確認。註冊時 `emailRedirectTo` = 目前網站（正式、預覽或本機都能用），確認連結帶著 session 回來（implicit flow，換裝置開信也行），頁面自動登入並讀回存檔；連結過期或用過會提示重寄。Supabase 後台：Site URL = `https://llm-voxel-world.vercel.app`，Redirect URLs 包含正式網址、`https://*-ding-4ed7.vercel.app/**`、`http://localhost:5173/**`。訪客也能玩，進度存在瀏覽器。

**存檔**（`src/save/`）：一人一格 `player_saves (user_id, seed) → data jsonb`，RLS 只能讀寫自己的列。內容：玩家 id、名字、動物、腳的位置、面向、血量、背包。手動（K／💾）、每分鐘自動、分頁隱藏或關閉時存；雲端自動存檔最多 20 秒一次。讀檔時雲端與本機副本取較新的。所有讀回的資料都驗證（位置範圍、方塊 id、數量）。

**背包**（`src/player/inventory.ts`）：9 格＝快捷列，每格最多 64。挖：草／花草地掉土、火不掉、其他掉自己。初始物資：木板 32、土 16、石頭 16、原木 8、磚 8、黃色玩具方塊 8、玻璃 4、火 3。

**視角**：預設第三人稱（肩後 0.75 格、距離 4.2 格、碰到方塊就拉近），V 切換第一人稱。第三人稱時用鏡頭射線瞄準方塊，但只在身體 5 格內有效。

**戰鬥**（`src/player/combat.ts`，純邏輯有測試）

沒有等級。角色基本值：攻擊 1、防禦 0、速度 4；其餘都由裝備（`src/player/equipment.ts`）加上去。愛心（1 顆 = 2 血）和體力上限只有特別道具或事件會增加，存在存檔裡、死掉也保留。

| 項目           | 數值                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| 起始           | 3 顆愛心（6 血）、體力 60；樹枝、木盾、草鞋                                        |
| 受傷           | 攻擊傷害 − 防禦（至少 1）；環境傷害不看防禦；6 秒沒受傷後每 2.5 秒回 1             |
| 攻擊（左鍵）   | 近戰：基本＋武器攻擊、武器距離、前方 ±43°；魔法：發射魔法彈（18 m/s），每發耗體力  |
| 防禦（按住 E） | 前方來的傷害（扣完防禦後）只受 25%，每擋一下扣 15 體力；體力用完防禦破掉；移動變慢 |
| 閃避（右鍵）   | 0.18 秒衝刺、0.32 秒無敵、25 體力、冷卻 0.6 秒                                     |
| 環境           | 摔落超過 3.5 格每格 1；岩漿 6/秒、火 2/秒                                          |
| 重生           | 廣場、背包與裝備回初始、3 秒無敵                                                   |

| 裝備     | 欄位 | 數值                              |
| -------- | ---- | --------------------------------- |
| 樹枝     | 武器 | 近戰 2.6 格、攻擊 +3              |
| 木劍     | 武器 | 近戰 2.8 格、攻擊 +5              |
| 石劍     | 武器 | 近戰 3 格、攻擊 +7                |
| 魔法樹枝 | 武器 | 魔法 14 格、攻擊 +1、每發 12 體力 |
| 水晶法杖 | 武器 | 魔法 18 格、攻擊 +2、每發 12 體力 |
| 木盾     | 防具 | 防禦 +1                           |
| 石盾     | 防具 | 防禦 +2、速度 −0.2                |
| 草鞋     | 鞋子 | 速度 +0.2                         |
| 皮靴     | 鞋子 | 速度 +0.7                         |

取得方式（暫定）：晚上打倒史萊姆有機率掉落（魔法樹枝 8%、木劍 5%、皮靴 3%、石盾 2%、水晶法杖 1%、石劍 1%），放進裝備袋（6 格），I 鍵打開裝備面板換上。

一般模式＝挖／放／飛（原本的操作）；戰鬥模式不能飛。

**怪物**（`src/monsters/slimes.ts`）：夜晚（night > 0.6）在玩家 13–25 格外生成，最多 5 隻；8 血、咬 2、會追 24 格內的玩家；廣場 18 格內是安全區；天亮、離太遠或掉進海就融化。目前只在本機模擬（不同步）。

**PvP**（`src/multiplayer/pvp.ts`）：沿用 Realtime 頻道。位置廣播多帶血量、模式、防禦、揮擊次數、是否倒下；`hit` 事件（帶武器種類）由攻擊者送出，**被打的人**自己判定（雙方都在戰鬥模式、依武器種類的距離、頻率、該種類最強武器的傷害上限），再套用自己的防禦；魔法彈另外廣播 `shot` 讓大家看得到，倒下時廣播 `ko`。信任客戶端，適合朋友間的小島；之後要防作弊得改成伺服器判定。
