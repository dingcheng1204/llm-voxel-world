import { describe, expect, it } from 'vitest';
import { WorldSave } from './persistence';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const sink = () => {
  const applied: number[][] = [];
  return { applied, applyEdit: (x: number, y: number, z: number, id: number) => applied.push([x, y, z, id]) };
};

describe('WorldSave (local)', () => {
  it('saves edits and re-applies them after a reload', () => {
    const storage = new MemStorage();
    const s1 = new WorldSave(1, sink(), null, storage);
    s1.start();
    s1.record({ x: 1, y: 30, z: 2, id: 0, by: 'player', t: 1000 });
    s1.record({ x: 1, y: 31, z: 2, id: 8, by: 'player', t: 1001 });
    s1.record({ x: 1, y: 30, z: 2, id: 21, by: 'player', t: 1002 }); // same block again: newest wins
    s1.flushLocal();
    s1.stop();

    const w = sink();
    const s2 = new WorldSave(1, w, null, storage);
    s2.start();
    expect(s2.status.saved).toBe(2);
    expect(w.applied).toContainEqual([1, 30, 2, 21]);
    expect(w.applied).toContainEqual([1, 31, 2, 8]);
    s2.stop();
  });

  it('keeps worlds with different seeds apart and can be cleared', () => {
    const storage = new MemStorage();
    const a = new WorldSave(1, sink(), null, storage);
    a.start();
    a.record({ x: 0, y: 30, z: 0, id: 3, by: 'player', t: 1 });
    a.flushLocal();
    const w = sink();
    new WorldSave(2, w, null, storage).start();
    expect(w.applied).toEqual([]);
    a.clearLocal();
    const w2 = sink();
    new WorldSave(1, w2, null, storage).start();
    expect(w2.applied).toEqual([]);
  });
});

describe('WorldSave (cloud)', () => {
  it('pushes queued edits and applies newer remote edits', async () => {
    const posted: unknown[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ edits: [[5, 25, 5, 22, Date.now() + 1000]], now: new Date().toISOString() }),
        {
          status: 200,
        },
      );
    }) as unknown as typeof fetch;
    const w = sink();
    const s = new WorldSave(
      7,
      w,
      { url: 'https://x.supabase.co', anonKey: 'k' },
      new MemStorage(),
      fakeFetch,
    );
    s.record({ x: 1, y: 30, z: 1, id: 8, by: 'player', t: Date.now() });
    expect(s.status.pending).toBe(1);
    await s.push();
    expect(s.status.pending).toBe(0);
    expect(posted).toHaveLength(1);
    await s.pull();
    expect(w.applied).toContainEqual([5, 25, 5, 22]);
    expect(s.status.cloud).toBe('ok');
  });

  it('keeps edits queued while offline', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const s = new WorldSave(
      7,
      sink(),
      { url: 'https://x.supabase.co', anonKey: 'k' },
      new MemStorage(),
      failing,
    );
    s.record({ x: 1, y: 30, z: 1, id: 8, by: 'player', t: 1 });
    await s.push();
    expect(s.status.pending).toBe(1);
    expect(s.status.cloud).toBe('offline');
  });
});
