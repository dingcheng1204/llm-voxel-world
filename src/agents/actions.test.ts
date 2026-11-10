import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from './actions';

describe('parseAgentResponse', () => {
  it('accepts a valid response (also inside ```json fences)', () => {
    const r = parseAgentResponse(
      '```json\n{"thought":"那棵樹好高","say":null,"actions":[{"type":"walk_to","target":[3,22,-4]},{"type":"mine","target":[3,23,-5]}]}\n```',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects unknown actions, too many actions and bad params', () => {
    expect(parseAgentResponse({ thought: '', actions: [{ type: 'fly' }] }).ok).toBe(false);
    expect(parseAgentResponse({ thought: '', actions: Array(4).fill({ type: 'idle' }) }).ok).toBe(false);
    expect(
      parseAgentResponse({ thought: '', actions: [{ type: 'place', target: [0, 0, 0], block: 'diamond' }] })
        .ok,
    ).toBe(false);
    expect(parseAgentResponse({ thought: '', actions: [{ type: 'wait', seconds: 99 }] }).ok).toBe(false);
  });

  it('walk_to needs exactly one destination', () => {
    expect(parseAgentResponse({ thought: '', actions: [{ type: 'walk_to' }] }).ok).toBe(false);
    expect(
      parseAgentResponse({ thought: '', actions: [{ type: 'walk_to', agent: 'gem', landmark: 'x' }] }).ok,
    ).toBe(false);
    expect(parseAgentResponse({ thought: '', actions: [{ type: 'walk_to', agent: 'gem' }] }).ok).toBe(true);
  });

  it('explains what is wrong so the brain can retry', () => {
    const r = parseAgentResponse('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });
});
