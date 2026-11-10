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
Up to **4 characters run at once**.

## 1. Persona files

Location: `agents/personas/<id>.yaml`. One file per character. Template: `references/persona-template.yaml`.
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
  "landmarks": [ { "name": "Clio's hut", "pos": [0, 30, 0], "dist": 14 } ],
  "nearby_agents": [ { "id": "gem", "pos": [15, 34, -3], "dist": 3.6, "doing": "mining" } ],
  "heard": [ { "from": "gem", "text": "這片沙灘下面好像有洞穴！", "t": "14:19" } ],
  "last_action_result": { "action": "walk_to", "ok": true }
}
```

Radius: blocks 8, agents 24, hearing 16. Summarise; never dump raw chunk arrays into prompts.

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
| `walk_to`   | `target: [x,y,z]` or `agent: id` or `landmark: name` | A* pathfinding, gives up after 64 nodes |
| `look_at`   | `target: [x,y,z]`                   | |
| `mine`      | `target: [x,y,z]`                   | must be within reach 5 and visible |
| `place`     | `target: [x,y,z]`, `block: name`    | must be in inventory |
| `follow`    | `agent: id`, `seconds: n` (≤ 60)    | |
| `name_place`| `name: string`                      | creates a landmark at current position |
| `wait`      | `seconds: n` (≤ 30)                 | |
| `idle`      | —                                   | |

The executor reports success/failure back via `last_action_result`. Bodies obey the same physics as
the player (see the `voxel-engine` skill).

## 5. Thinking cadence & cost

- A character thinks when: its action queue is empty, it heard something addressed to it, or 20 s passed.
- Minimum gap between thinks: 6 s. Idle characters with nobody nearby think at most once per 60 s.
- Per-character daily budget (tokens and USD) in `agents/budget.yaml`; when exceeded the character
  "goes to sleep" until the next day. Diary writing has its own reserved budget so it always runs.

## 6. Chat rules

- `say` is heard by everyone within 16 blocks (including the player).
- A conversation between two characters ends after 8 exchanges or 2 minutes, then both must do something
  else for at least 60 s (prevents infinite chatter loops).
- The player can talk to any character from the chat box; player messages always trigger a think.
- All lines are stored in the `messages` table.

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

1. Add the provider to the AI Gateway / env (`.env.example`), never to client code.
2. Create `agents/personas/<id>.yaml` from the template.
3. Run `npm run agent:dry-run -- <id>` (sends a fixed perception, checks the JSON contract) before
   spawning it in the world.
4. A new species = a new model function in `species.ts` returning `CharacterModel` (`root` + `animate(time, speed)`),
   built from low-poly primitives with `scene/lowpoly.ts` helpers, front facing +Z, about 1 block tall. No new abilities.
