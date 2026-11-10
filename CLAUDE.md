# CLAUDE.md

Browser voxel game (Minecraft-like) with LLM-driven characters that explore, chat and write daily diaries.
Read `docs/BLUEPRINT.md` for architecture and `docs/ROADMAP.md` for the current phase before starting work.

## Stack
Vite + TypeScript (strict) + Three.js · Vercel Functions + AI SDK / AI Gateway · Supabase (Postgres).

## Skills — load before touching these areas
- `voxel-engine` — anything in `src/engine`, `src/world`, `src/player`, block types, terrain, rendering, collision.
- `agent-persona` — anything in `src/agents`, `api/agent`, `api/cron`, `agents/personas`, prompts, diaries.
- `frontend-design` — UI work (hotbar, chat box, diary reader).

## Rules
- Work one ROADMAP phase at a time; tick the checklist in `docs/ROADMAP.md` when an item is done.
- LLM API keys live only in Vercel env / `.env.local`. Never import a provider SDK or key in `src/`.
- Block IDs are append-only (save format). Coordinates follow the voxel-engine skill exactly.
- Every agent LLM response is validated with zod; never trust raw model output.
- Dispose Three.js geometries/materials you replace.
- Small commits with clear messages.

## Verify before saying "done"
1. `npm run typecheck && npm run lint && npm test && npm run build`
2. `npm run dev`, open it with the Chrome DevTools MCP, screenshot, and check the console for errors.
3. For performance work, record a trace with Chrome DevTools MCP and compare before/after.

## MCP servers (see `.mcp.json`)
chrome-devtools (debug/perf), playwright (E2E later), context7 (Three.js / AI SDK / Supabase docs).
Supabase and Vercel MCPs are used for migrations and deploys.
