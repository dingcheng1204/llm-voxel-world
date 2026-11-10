import type { Species } from './species';

/** Default cast. Species is appearance only; every character has the same abilities. */
export interface CastMember {
  id: string;
  name: string;
  species: Species;
  /** Which LLM drives it (display label; real wiring lives server-side in phase 4). */
  brain: string;
  tagColor: string;
}

export const CAST: readonly CastMember[] = [
  { id: 'clio', name: 'Clio', species: 'cat', brain: 'Claude', tagColor: '#d97757' },
  { id: 'gem', name: 'Gem', species: 'fox', brain: 'Gemini', tagColor: '#4285f4' },
  { id: 'pip', name: 'Pip', species: 'wolf', brain: 'ChatGPT', tagColor: '#10a37f' },
  { id: 'rook', name: 'Rook', species: 'snake', brain: 'Grok', tagColor: '#6b7280' },
];
