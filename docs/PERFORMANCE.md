# 效能設計（讓 3D 跑得順）

骨架從第一天就照下面這些原則寫。新功能如果會違反其中一條，先在 PR 裡說明理由。

## 這種遊戲吃效能嗎？

不算重。192×288 的島在瀏覽器 3D 裡算小場景，負擔主要在**畫面**，不在 AI：

| 部分 | 成本 | 說明 |
|---|---|---|
| 方塊地形 | 主要成本 | 216 個 chunk，greedy meshing 後約 10 萬個三角形；整座島載入時在 worker 做 meshing（每塊約 4 ms） |
| 裝飾物 | 小 | 約 760 個椰子樹、花、石頭，每種只要 1 個 draw call |
| 4 個 AI 角色的身體 | 很小 | 每個角色約 8 個 mesh；移動與動畫每幀不到 0.1 ms |
| 4 個 AI 的「大腦」 | 幾乎為 0 | LLM 在伺服器/雲端跑，瀏覽器只是送出請求、等回應（非同步），完全不卡畫面 |

真正要擔心的是 **API 費用與延遲**，不是 FPS：4 個角色每 6–20 秒各思考一次，延遲 1–3 秒很正常，所以動作要排隊執行、不能等回應才動（見 agent-persona skill 的思考節奏與預算）。

## 預算

| 指標 | 目標（整座島，一般筆電內顯） | 目前（全島俯瞰） |
|---|---|---|
| FPS | ≥ 60，1% low ≥ 45 | 需在實機量 |
| 每幀 JS 時間 | < 6 ms | — |
| Draw calls | < 400 | ~270 |
| 三角形 | < 500k | ~220k（地形 104k + 海 34k + 裝飾 + 角色） |
| 首次載入 | < 2 s | 地形生成 ~0.35 s + meshing ~0.8 s ÷ worker 數 |
| 單一 chunk 重建 | 在 worker 裡完成，主執行緒 0 ms | ✓ |

一般第三人稱視角只看得到一部分島，frustum culling 會讓實際 draw call 和三角形比俯瞰少很多。

F3 overlay 會即時顯示上面這些數字。要看的是 **1% low**：平均 FPS 高不代表不卡。

## 骨架裡已經做好的事

| 做法 | 位置 | 為什麼 |
|---|---|---|
| 固定步長迴圈（60 Hz）+ 渲染內插 | `engine/loop.ts` | 物理穩定，高刷新率螢幕也順；切分頁回來不會爆衝（每幀最多補 5 tick） |
| Pixel ratio 上限 1.5 | `engine/config.ts` (`?pr=`) | HiDPI 螢幕上這是最大的 GPU 成本 |
| 預設關 MSAA、不開陰影 | `engine/renderer.ts` | 方塊風格不需要；陰影改用烘焙的面亮度 |
| Fog + 緊的 far plane | `engine/renderer.ts` | 遮住邊緣 chunk 載入，也少畫遠處 |
| Meshing 在 Web Worker | `world/meshWorkerPool.ts` | 主執行緒不卡；buffer 用 transfer 不複製 |
| Greedy meshing（相鄰同材質面合併） | `world/mesher.ts` | 三角形從 67 萬降到 10 萬（−84%） |
| 方塊亮度差異在 shader 算 | `world/world.ts` | 保留手繪感又不妨礙合併面 |
| Uint8 頂點位置與顏色 | `world/mesher.ts` | 頂點資料是 Float32 的 1/4，上傳 GPU 快 |
| 共用 2 個材質（不透明 / 水） | `world/world.ts` | 減少 GPU 狀態切換 |
| 手動設定 bounding sphere | `world/world.ts` | 不跑逐頂點計算；frustum culling 直接可用 |
| `matrixAutoUpdate = false` | `world/world.ts` | chunk 不會動，不用每幀算矩陣 |
| 舊 geometry 一定 `dispose()` | `world/world.ts` | 洩漏 GPU 記憶體是最常見的掉幀原因 |
| 地形生成分時（每幀 4 ms） | `world/world.ts` (`?gen=`) | 走到新區域不會一次卡住 |
| 由近到遠載入 | `world/world.ts` `spiral()` | 身邊先出現 |
| 裝飾物用 InstancedMesh | `scene/props.ts`、`scene/fire.ts` | 每種椰子樹/石頭/火焰只要 1 個 draw call |
| 海浪在 vertex shader 算 | `scene/environment.ts` | 動畫不佔 CPU |
| Overlay 每秒只更新 4 次 DOM | `engine/debugOverlay.ts` | DOM 寫入不便宜 |

## 之後各階段要加的

- **階段 1**：貼圖 atlas 用 `NearestFilter`；raycast 用 voxel DDA（不要用 `THREE.Raycaster` 打網格）。
- **階段 2**：per-vertex AO、地形生成也搬進 worker（首次載入更快）。
- **階段 3+**：AI 思考是網路呼叫，絕不阻塞遊戲迴圈；動作排隊執行。
- 如果 draw call 成為瓶頸：把所有 chunk 放進一個 `BatchedMesh`（multi-draw，一次畫完）。
- 角色超過 ~10 個時，再考慮角色模型用 instancing。

## 怎麼檢查

1. `npm run dev`，按 F3 看數字。
2. 用 Chrome DevTools MCP：`performance_start_trace` → 跑 10 秒 → 看最慢的函式，**先量再改**。
3. URL 參數快速實驗：`?pr=1`（解析度）、`?aa=1`（反鋸齒）、`?seed=42`。
4. 在 console 用 `__game.world.stats` 看 chunk 狀態。

> 注意：沒有 GPU 的雲端環境（SwiftShader 軟體渲染、只有 1 個 worker）FPS 只有個位數，數字沒有參考價值，一定要在真的電腦上量。
