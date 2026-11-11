// Small shared stores the agents read and write: named places, building sites and things said aloud.

import type { Site } from '../world/blueprints';

export interface Landmark {
  name: string;
  pos: [number, number, number];
  by: string;
}

/** Building sites the characters planned. Merged across snapshots: newest `at` wins per id. */
export class Sites {
  readonly list: Site[] = [];
  /** Bumped on every change (renderers rebuild their preview). */
  version = 0;

  /** Add or update; an older copy (from a stale snapshot) never overwrites a newer one. */
  merge(s: Site): boolean {
    const i = this.list.findIndex((x) => x.id === s.id);
    if (i >= 0) {
      if (this.list[i]!.at >= s.at) return false;
      this.list[i] = { ...s };
    } else {
      this.list.push({ ...s });
    }
    this.version++;
    return true;
  }

  get(id: string): Site | undefined {
    return this.list.find((x) => x.id === id);
  }

  /** Sites still to build. */
  active(): Site[] {
    return this.list.filter((s) => s.status === 'planned');
  }

  /** Kept in snapshots: every active site plus the most recent finished/cancelled ones. */
  forSnapshot(max = 12): Site[] {
    const active = this.active();
    const rest = this.list
      .filter((s) => s.status !== 'planned')
      .sort((a, b) => b.at - a.at)
      .slice(0, Math.max(0, max - active.length));
    return [...active, ...rest].slice(0, max);
  }
}

export class Landmarks {
  readonly list: Landmark[] = [];
  /** Building sites live with the named places: both are shared, persisted in every character's snapshot. */
  readonly sites = new Sites();

  add(name: string, pos: [number, number, number], by: string): void {
    const i = this.list.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
    const l = { name, pos, by };
    if (i >= 0) this.list[i] = l;
    else this.list.push(l);
  }

  find(name: string): Landmark | undefined {
    const n = name.toLowerCase();
    return this.list.find((l) => l.name.toLowerCase() === n);
  }
}

export interface ChatLine {
  from: string;
  /** Display name (players); characters use their id. */
  name?: string;
  /** Who the line is for (character or player id); undefined/null = everyone in range. */
  to?: string | null;
  text: string;
  pos: [number, number, number];
  /** Simulation time in seconds. */
  t: number;
  clock: string;
}

export const HEARING_RADIUS = 16;

export class ChatLog {
  readonly lines: ChatLine[] = [];
  onLine: (l: ChatLine) => void = () => {};

  say(line: ChatLine): void {
    this.lines.push(line);
    if (this.lines.length > 200) this.lines.shift();
    this.onLine(line);
  }

  /**
   * Lines said after `since` (sim seconds), not by `self`, that `self` hears: everything within hearing
   * range, plus lines addressed to `self` from anywhere (players talk through the chat window).
   */
  heard(self: string, pos: [number, number, number], since: number): ChatLine[] {
    return this.lines.filter(
      (l) =>
        l.t > since &&
        l.from !== self &&
        (l.to === self ||
          Math.hypot(l.pos[0] - pos[0], l.pos[1] - pos[1], l.pos[2] - pos[2]) <= HEARING_RADIUS),
    );
  }
}
