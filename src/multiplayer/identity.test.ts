import { describe, expect, it } from 'vitest';
import { ChatLog } from '../agents/worldState';
import { checkName, loadIdentity, newPlayerId } from './identity';

describe('player identity', () => {
  it('makes ids the server accepts', () => {
    for (let i = 0; i < 20; i++) expect(newPlayerId()).toMatch(/^p-[a-z0-9]{8}$/);
  });

  it('checks names (length, characters’ names are taken)', () => {
    expect(checkName('  小丁  ')).toEqual({ ok: true, name: '小丁' });
    expect(checkName('').ok).toBe(false);
    expect(checkName('x'.repeat(17)).ok).toBe(false);
    expect(checkName('Clio').ok).toBe(false);
  });

  it('loads a saved identity and rejects junk', () => {
    const store = (v: unknown) => ({ getItem: () => JSON.stringify(v) });
    expect(loadIdentity(store({ id: 'p-abcd1234', name: 'Ding', species: 'monkey' }))).toEqual({
      id: 'p-abcd1234',
      name: 'Ding',
      species: 'monkey',
    });
    expect(loadIdentity(store({ id: 'clio', name: 'Ding', species: 'monkey' }))).toBeNull();
    expect(loadIdentity(store({ id: 'p-abcd1234', name: 'Ding', species: 'dragon' }))!.species).toBe('tiger');
    expect(loadIdentity({ getItem: () => '{bad json' })).toBeNull();
  });
});

describe('hearing direct lines', () => {
  it('a line to Clio reaches her from anywhere; others only hear it nearby', () => {
    const chat = new ChatLog();
    chat.say({
      from: 'p-abcd1234',
      name: 'Ding',
      to: 'clio',
      text: '嗨 Clio',
      pos: [80, 23, 100],
      t: 1,
      clock: '',
    });
    chat.say({
      from: 'p-abcd1234',
      name: 'Ding',
      to: null,
      text: '大家好',
      pos: [80, 23, 100],
      t: 2,
      clock: '',
    });
    expect(chat.heard('clio', [0, 23, 0], 0).map((l) => l.text)).toEqual(['嗨 Clio']);
    expect(chat.heard('gem', [0, 23, 0], 0)).toHaveLength(0);
    expect(chat.heard('gem', [78, 23, 100], 0)).toHaveLength(2);
  });
});
