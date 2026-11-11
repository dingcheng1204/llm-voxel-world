---
name: agent-persona
description: How this repo's LLM-driven characters are defined and prompted — persona file format, the system prompt template, the JSON action contract, chat rules, memory, and the daily diary format. Use whenever creating or editing a character, wiring a new LLM provider as a "brain", changing prompts, the action schema, chat behaviour, or diary generation (anything under src/agents, api/agent, or agents/personas).
---

# Agent persona conventions

Every character is **one persona file + one brain (LLM model) + one body (an entity in the voxel world)**.
The body is dumb: it only executes actions. Everything the character "decides" comes from the brain
through the action contract below.

**Species is appearance only.** Characters are cute low-poly animals (`cat`, `fox`, `wolf`, `snake`, more later),
but every species uses the same `AgentBody` (`src/agents/AgentBody.ts`): same speed, physics, perception and
action set. Never give a species extra abilities or special-case behaviour — the point of the game is that the
*brains* (different LLMs) are the only difference. Models live in `src/agents/species.ts`; the cast in `src/agents/cast.ts`.
The cast is **one character per LLM brain we actually run** — currently 2 (Clio → MiniMax, Gem → Gemini);
the engine is budgeted for up to 4.

## 1. Persona files

Location: `src/agents/personas.ts` (plain data, `PERSONAS[id]`, imported by both the browser and the API — keep it
free of runtime imports). `references/persona-template.yaml` documents the fields; the YAML files were replaced by this module.
Starting cast: `references/starting-cast.md` (cat/Claude, fox/Gemini, wolf/ChatGPT, snake/4th brain).

Required fields:

```yaml
id: clio                     # lowercase, stable — used in DB rows and edits.by
display_name: Clio
brain:
  provider: anthropic        # anthropic | google | openai | xai | meta | alibaba
  model: anthropic/<model-id>   # AI Gateway model string; check current names before using
  think_model: null          # optional cheaper model for routine ticks
appearance: { species: cat, tag_color: "#d97757" }   # species: cat | fox | wolf | snake — looks only
core_trait: curiosity        # every character shares this
personality: >               # 2–4 sentences: how THIS character's curiosity shows up
speech_style: >              # tone, sentence length, verbal habits
interests: [ ... ]           # 3–5 things they gravitate toward in the world
diary_language: zh-TW        # language diaries are written in
```

Rules:
- All characters are **curious about the world** — that is the shared core. Make each one curious
  in a *different way* (naturalist, cartographer, tinkerer, philosopher…) so conversations do not collapse
  into agreement.
- Characters know they live in a block world. They do **not** role-play being the company or model
  behind them, and do not claim abilities they lack in-game.
- Keep personas kind and cooperative. No content involving real people, no romance between characters.

## 2. System prompt

Built by `src/agents/prompt.ts` from `references/system-prompt-template.md`. Sections, in order:
1. Identity (persona fields)
2. World rules (what blocks are, day/night, what actions exist)
3. Memory: last 3 diary entries + today's key events (summarised, ≤ 600 tokens)
4. Current perception (see §3)
5. Output contract (see §4) — always last

Keep the whole prompt under ~3k tokens. Never put API keys, other agents' prompts or hidden
instructions into the prompt.

## 3. Perception (input each tick)

`Perception` JSON produced by `src/agents/perceive.ts`:

```json
{
  "time": { "day": 3, "clock": "14:20", "phase": "day" },
  "self": { "pos": [12, 34, -5], "facing": "north", "holding": "planks", "inventory": {"planks": 12, "log": 3} },
  "looking_at": { "block": "log", "pos": [12, 35, -7], "dist": 2.1 },
  "nearby_blocks": { "log": 8, "water": 40, "sand": 22 },
  "nearest": { "log": { "pos": [13, 35, -6], "dist": 1.7 }, "water": { "pos": [9, 33, -2], "dist": 4.1 } },
  "landmarks": [ { "name": "Clio's hut", "pos": [0, 30, 0], "dist": 14 } ],
  "nearby_agents": [ { "id": "gem", "pos": [15, 34, -3], "dist": 3.6, "doing": "mining" } ],
  "heard": [ { "from": "gem", "text": "這片沙灘下面好像有洞穴！", "t": "14:19" } ],
  "last_action_result": { "action": "walk_to", "ok": true }
}
```

Radius: block counts 8, `nearest` 16 (one position per block kind — this is what lets a brain pick a target to
walk to / mine), agents 24, hearing 16, landmarks 96. Only air-exposed blocks are reported (no buried stone).
Summarise; never dump raw chunk arrays into prompts. Implemented in `src/agents/perceive.ts`.

## 4. Output contract (actions)

The brain must answer with **one JSON object** — validated with zod in `src/agents/actions.ts`.
Invalid output ⇒ one retry with the validation error appended; second failure ⇒ action `idle`.

```json
{
  "thought": "short private reasoning, 1–2 sentences (shown as a thought bubble, logged)",
  "say": "optional line spoken aloud, ≤ 140 chars, or null",
  "actions": [
    { "type": "walk_to", "target": [20, 34, -10] }
  ]
}
```

Allowed action types (max 3 per response, executed in order):

| type        | params                              | notes |
|-------------|-------------------------------------|-------|
| `walk_to`   | `target: [x,y,z]` or `agent: id` or `landmark: name` | A* (≤ 8000 nodes); a block target → stand next to it; partial path → fails with "could only get partway there" |
| `look_at`   | `target: [x,y,z]`                   | |
| `mine`      | `target: [x,y,z]`                   | must be within reach 5 and visible |
| `place`     | `target: [x,y,z]`, `block: name`    | must be in inventory |
| `follow`    | `agent: id`, `seconds: n` (≤ 60)    | |
| `name_place`| `name: string`                      | creates a landmark at current position |
| `wait`      | `seconds: n` (≤ 30)                 | |
| `idle`      | —                                   | |

The executor (`src/agents/executor.ts`) reports success/failure back via `last_action_result`, with a short
`reason` on failure ("out of reach (6.2 blocks away, reach is 5)", "cannot see that block from here",
"no log in inventory", "stuck", …). **A failed action cancels the rest of the plan** so the brain re-thinks.
Reach is 5 from the eye; mined blocks go to the inventory; placed blocks must touch another block and not
overlap anyone. Bodies obey the same physics as the player (see the `voxel-engine` skill).

Brains implement `Brain.think(perception, retryError?)` (`src/agents/brains/demo.ts`) and may return a string,
an object or a Promise — `Agent` validates it. Scripted `DemoBrain` (gather / explore) stands in until phase 4.

**Which edits are saved**: server-run characters (the LLM ones, see §9) write the shared world (`world_edits`,
`by` = agent id) — from the server tick, or from the browser tab currently driving them. Scripted characters still
run separately in every browser, so their edits stay local (`WorldSave.saveBy`).

## 5. Thinking cadence & cost

- A character thinks when: its action queue is empty, it heard something addressed to it, or 20 s passed.
- Minimum gap between thinks: 6 s for LLM brains (`DEFAULT_THINK_GAP`; scripted demo brains use 1.5 s).
  Idle characters with nobody nearby think at most once per 60 s.
- A character waits until the terrain under it is loaded before its first think.
- Budget is enforced **server-side** (`api/_lib/thinkCore.ts` → `runThink`), shared by every visitor and the
  server tick: `AGENT_DAILY_BUDGET_USD` (default 0.5, Asia/Taipei day), `AGENT_MAX_CALLS_PER_MIN` (default 20),
  `AGENT_LLM_AGENTS` allow-list (default `clio`). Over budget → HTTP 429 → the character "goes to sleep".
  Fails closed without `AGENT_DB_SECRET`. Diary writing will get its own reserved budget (phase 5).
- Nobody watching → the server tick thinks once per minute (§9).

## 6. Chat rules (implemented — `src/agents/chatRules.ts`)

- `say` is heard by everyone within 16 blocks. Every line goes to `messages` (`agent_log_think`), with
  `heard_by` = the other characters within 16 blocks; the server tick reloads the last 10 minutes.
- Conversation state is computed from `messages` on every think and added to the perception as `conversation`:
  - `waiting_for_reply`: you spoke to someone and they haven't had a chance to answer yet (their think cadence
    + 30 s, max 3 min) → stay quiet;
  - a conversation ends after **8 lines or 2 minutes** → **60 s `cooldown`** for both, do something else;
  - a pause > 90 s starts a new conversation.
- Enforced server-side in `runThink`: if the character may not talk, its `say` is dropped (logged as `muted`).
- The player's chat box (phase 6) will go through the same rules.

## 7. Daily diary

Every character writes one diary entry per **real day** (default 23:30 Asia/Taipei, Vercel cron) —
and also at the end of each **in-game day** if `DIARY_MODE=game_day`. Template and example:
`references/diary-format.md`.

Input: persona + the day's events (from `events` table) + messages + yesterday's diary.
Output: Markdown, 150–350 words, in `diary_language`, first person, with the fixed headings in the
template. Stored in the `diaries` table; the newest 3 are fed back into the system prompt as memory.

Diaries must only describe things that actually happened in the event log (no invented events);
feelings, guesses and questions are encouraged.

## 8. Adding a new brain

1. Add the provider's key to Vercel env (`.env.example` lists names), never to client code. Model calls live in
   `api/_lib/thinkCore.ts` (OpenAI-compatible chat completions).
2. Add the persona to `src/agents/personas.ts` and the id to `AGENT_LLM_AGENTS`.
3. Run `npm run agent:dry-run -- <id>` (sends a fixed perception, checks the JSON contract) before
   spawning it in the world.
4. A new species = a new model function in `species.ts` returning `CharacterModel` (`root` + `animate(time, speed)`),
   built from low-poly primitives with `scene/lowpoly.ts` helpers, front facing +Z, about 1 block tall. No new abilities.

## 9. Server-run characters (who drives)

LLM characters live server-side so they keep exploring when nobody watches and everyone sees the same one.
State (`AgentSnapshot`, `src/agents/snapshot.ts`: pos, heading, inventory, landmarks, last thought/say, last result)
is stored in Supabase `agent_state` and validated with zod on every read/write.

Exactly one simulator drives a character at a time — a **lease** taken through the `agent_state_sync` RPC:
- **Browser driver**: a tab whose game loop is actually running (visible *and* ticked < 2 s ago) holds a 30 s lease,
  renewed by `/api/agent/state` heartbeats every 4 s (which also upload the snapshot) and by every `/api/agent/think`.
  `/think` refuses (409) a tab without the lease, so only one tab spends tokens.
- **Mirrors**: other tabs walk the character towards the saved position and show the saved bubbles (`AgentSync`).
- **Server tick**: Supabase pg_cron → `/api/agent/tick` every minute. If no browser holds the lease it rebuilds the
  island headless (`src/server/sim.ts`, same engine), thinks once, runs 60 s of physics and saves state + edits.

`src/server/sim.ts` is bundled to `api/_gen/sim.js` (`npm run build:sim`, committed; `npm run check` fails if stale)
because the Vercel Node runtime can't load the extensionless imports in `src/`. API code may import from `src/`
directly only for modules with no relative runtime imports (`personas.ts`, `prompt.ts`, `snapshot.ts`).

## 10. Memory (implemented)

- **Short-term**: the last 10 `think` events (thought, say, actions, outcome from the next think's
  `last_result`, position + area) → "What you did recently" in the user prompt (`src/agents/memory.ts`).
- **Long-term**: each diary also stores a one-line `summary` ("what I most want to remember tomorrow");
  the newest 3 go into the system prompt ("What you remember from earlier days"), stable all day.
- Both are read with the budget in one RPC (`agent_context`). Memory roughly doubles input tokens
  (~1.5k → ~2.4k per think) — keep it compact.
- **Diary**: `/api/agent/diary` (pg_cron 23:30 Asia/Taipei, `api/_lib/diaryCore.ts`, `src/agents/diary.ts`):
  the day's events are compressed by `buildDigest` (areas, named places, actions, failures, words, sampled
  thoughts), the model returns JSON `{diary, memory}`, headings are validated and our own title
  `# 第 N 天 · YYYY-MM-DD` is added (N = the character's Nth diary). Re-running for the same date overwrites.

## 11. Mind: knowledge, interests, goals (implemented)

`agent_mind` (`src/agents/mind.ts`) is the part of a character that grows; the persona never changes.
- **Knowledge notes**: a think may include `"learn": "short fact"` (optional, usually null). `runThink` stores it via
  `agent_learn` (exact duplicates ignored, max one note per 3 minutes, newest 40 kept). The newest 12 are shown in
  the system prompt.
- **Interests (≤5) and goals (≤3, new/in_progress/done)**: updated every night in the same model call as the diary
  (reply field `mind`), together with tidying the notes down to ≤30. An invalid `mind` is dropped (yesterday's
  stays); the diary is still saved. Prompt shows "Lately you are into: …" next to the persona's starting interests.

## 12. Several brains (implemented)

`api/_lib/thinkCore.ts` → `config().brains[agentId]`: provider, key, base URL, model, reasoning effort, prices,
`maxPerDay` (per provider day; Gemini free tier resets at midnight Pacific) and `serverEveryMinutes`.
A character is switched on only if it is in `AGENT_LLM_AGENTS` (default `clio,gem`) AND its key is set;
otherwise `/api/agent/state` answers 403 and the browser keeps the character's script.

| id | brain | key | browser gap | server cadence | cap |
|---|---|---|---|---|---|
| clio | MiniMax M3.1 Flash | `MINIMAX_API_KEY_1` | 6 s | every minute | daily USD budget |
| gem | Gemini 3.1 Flash-Lite (free tier) | `GEMINI_API_KEY_1` | 20 s | every 4 min | 470 calls/day + USD budget |

The server tick simulates all LLM characters in ONE world (`createSim({ agents: [...] })`): due + leased
characters think (in parallel) and are saved; the others are puppets at their saved position. Say lines are
written to `messages` by `agent_log_think` (with `heard_by`), and the tick loads the last 10 minutes so
characters hear each other across ticks (`lastThinkAt` in the snapshot marks what is new).
Gemini's OpenAI layer takes `max_tokens` (MiniMax: `max_completion_tokens`).
