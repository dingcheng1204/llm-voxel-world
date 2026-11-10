# 效能設計（讓 3D 跑得順）

骨架從第一天就照下面這些原則寫。新功能如果會違反其中一條，先在 PR 裡說明理由。

## 預算

| 指標 | 目標（整座島，一般筆電內顯） |
|---|---|
| FPS | ≥ 60，1% low ≥ 45 |
| 每幀 JS 時間 | < 6 ms |
| Draw calls | < 200（目前整座島約 43） |
| 三角形 | < 500k |
| 單一 chunk 重建 | 在 worker 裡完成，主執行緒 0 ms |

F3 overlay 會即時顯示上面這些數字。要看的是 **1% low**：平均 FPS 高不代表不卡。

## 骨架裡已經做好的事

| 做法 | 位置 | 為什麼 |
|---|---|---|
| 固定步長迴圈（60 Hz）+ 渲染內插 | `engine/loop.ts` | 物理穩定，高刷新率螢幕也順；切分頁回來不會爆衝（每幀最多補 5 tick） |
| Pixel ratio 上限 1.5 | `engine/config.ts` (`?pr=`) | HiDPI 螢幕上這是最大的 GPU 成本 |
| 預設關 MSAA、不開陰影 | `engine/renderer.ts` | 方塊風格不需要；陰影改用烘焙的面亮度 |
| Fog + 緊的 far plane | `engine/renderer.ts` | 遮住邊緣 chunk 載入，也少畫遠處 |
| Meshing 在 Web Worker | `world/meshWorkerPool.ts` | 主執行緒不卡；buffer 用 transfer 不複製 |
| Face culling，先算數量再一次配置 | `world/mesher.ts` | 少畫看不到的面；不產生垃圾給 GC |
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
- **階段 2**：greedy meshing（三角形少 5–10 倍）、per-vertex AO、地形生成也搬進 worker。
- **階段 3+**：角色模型用 `InstancedMesh`；AI 思考是網路呼叫，絕不阻塞遊戲迴圈。
- 如果 draw call 成為瓶頸：把多個 chunk 合併到 `BatchedMesh`。

## 怎麼檢查

1. `npm run dev`，按 F3 看數字。
2. 用 Chrome DevTools MCP：`performance_start_trace` → 跑 10 秒 → 看最慢的函式，**先量再改**。
3. URL 參數快速實驗：`?pr=1`（解析度）、`?aa=1`（反鋸齒）、`?seed=42`。
4. 在 console 用 `__game.world.stats` 看 chunk 狀態。

> 注意：沒有 GPU 的雲端環境（SwiftShader 軟體渲染）只會有約 20 FPS，數字沒有參考價值，一定要在真的電腦上量。
