import type { Species } from './species';

/**
 * The cast: one character per LLM brain we run (Clio → MiniMax, Gem → Gemini). Species is appearance only;
 * every character has the same abilities. More species models exist in species.ts for future characters.
 */
export interface CastMember {
  id: string;
  name: string;
  species: Species;
  /** Which LLM drives it (display label; real wiring lives server-side in phase 4). */
  brain: string;
  tagColor: string;
}

export const CAST: readonly CastMember[] = [
  { id: 'clio', name: 'Clio', species: 'cat', brain: 'MiniMax', tagColor: '#d97757' },
  { id: 'gem', name: 'Gem', species: 'fox', brain: 'Gemini', tagColor: '#4285f4' },
];
