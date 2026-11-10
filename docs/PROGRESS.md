# 進度說明（2026-11-11）

**現況**：階段 0–3 完成。島嶼可以玩：第一人稱走、跳、游泳、飛，挖和放方塊，有日夜循環，存檔會同步到雲端。4 隻可愛小動物用 A* 尋路、會挖樹、能幫地點取名，目前由腳本大腦驅動，下一步換成 LLM。

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
| 4 第一個大腦 | `/api/agent/think` 接 Claude，Clio 自己探索、說話 | ⏭ 下一步 |
| 5 三個角色 + 聊天 + 日記 | Gemini、ChatGPT、互相聊天、每日日記、日記閱讀頁 | ⬜ |
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

| 角色 | 外觀 | 預定大腦 | 目前的腳本行為 |
|---|---|---|---|
| Clio | 貓 | Claude | 採集：找樹 → 挖 3 塊原木 → 回家放下 |
| Gem | 狐狸 | Gemini | 探索：到處走、幫地點取名、去找朋友 |
| Pip | 狼 | ChatGPT | 採集 |
| Rook | 蛇 | Grok（可換） | 探索 |

- **外觀只是外觀**：4 隻用同一個身體（物理、速度、感知、動作都一樣），差別只在操控的大腦。
- **動作**：`walk_to`、`look_at`、`mine`、`place`、`follow`、`name_place`、`wait`、`idle`。用 zod 驗證，格式錯誤時把原因回傳給大腦重試一次。
- **尋路**：3D A*，能跳上 1 格、跳下 3 格，斜走不切角，避開水、岩漿和海。
- **感知**：每次思考時給大腦一份 JSON，內容有時間、位置、背包、看著什麼、附近的方塊與最近的位置、地標、其他角色、聽到的話、上一個動作的結果。
- **除錯**：按 F3 會顯示每個角色的路徑線、正在做的事、背包和想法。

---

## 3. 架構

```
瀏覽器（Vite + TypeScript + Three.js）
├─ engine/   遊戲迴圈（60 Hz 固定步長）、渲染器、F3 面板
├─ world/    地形、chunk、greedy+AO mesher（Web Worker）、raycast、存檔同步
├─ player/   第一人稱控制、AABB 物理（角色也共用）、快捷列
├─ scene/    天空、海、雲、日夜、裝飾物、火焰
└─ agents/   身體、動作 schema、A*、執行器、感知、大腦（目前是腳本）

Vercel（靜態網站，push 自動部署）
Supabase（llm-voxel-world，東京）
├─ 資料表：agents、events、messages、diaries、world_edits、usage（RLS 全開，前端只能讀）
└─ Edge Function：world-edits（讀寫方塊修改，管理員金鑰只在伺服器端）
```

程式約 6,000 行 TypeScript，57 個自動測試。GitHub Actions 每次 push 都會跑型別檢查、lint、測試和 build。

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

## 5. 已知限制與待辦

- **實機 FPS 還沒驗收**：雲端環境沒有 GPU，請在電腦上打開線上版，按 F3 看 FPS。
- **裝飾物沒有碰撞**：玩家和角色會穿過椰子樹、樹叢和石頭。
- **角色挖和放的結果只存在本機**：每位訪客的瀏覽器跑各自的角色，要等階段 4 角色改在伺服器上跑，才會寫入共用世界。
- **地形生成在主執行緒**：載入速度會受 FPS 影響，必要時搬進 worker。
- **共用世界沒有速率限制**：任何人都能挖和放；Edge Function 有檢查座標和數量，但還沒限制頻率。
- **Supabase 安全提示**：`events`、`usage` 兩張表沒有開放權限（刻意的，只給伺服器用）。

---

## 6. 下一步：階段 4（接上 Claude）

1. 在 Vercel 後台建立 **AI Gateway API key**，放進環境變數 `AI_GATEWAY_API_KEY`（不要貼在對話或程式碼裡）。
2. 建立 `api/agent/think`：用 AI SDK `generateObject` 加上現有的 zod schema，把 Perception 轉成動作。
3. 建立 `src/agents/prompt.ts` 和 `agents/personas/clio.yaml`。
4. 決定角色在哪裡跑：
   - 先在瀏覽器跑，只給開發者用，最簡單。
   - 或是在伺服器上排程跑一個共用世界，大家看到同一批角色，挖和放也會寫進雲端。
5. 想法泡泡和說話泡泡；`events`、`usage` 寫入 Supabase；每日預算。

---

## 7. 開發與除錯速查

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

在瀏覽器 console 可以用 `__game` 檢查狀態，例如 `__game.agents[0].lastPerception`、`__game.save.status`、`__game.world.stats`。

---

## 8. Commit 紀錄

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
