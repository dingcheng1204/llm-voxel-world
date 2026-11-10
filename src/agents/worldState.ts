// Small shared stores the agents read and write: named places and things said aloud.

export interface Landmark {
  name: string;
  pos: [number, number, number];
  by: string;
}

export class Landmarks {
  readonly list: Landmark[] = [];

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

  /** Lines within hearing range of `pos`, said after `since` (sim seconds), not by `self`. */
  heard(self: string, pos: [number, number, number], since: number): ChatLine[] {
    return this.lines.filter(
      (l) =>
        l.t > since &&
        l.from !== self &&
        Math.hypot(l.pos[0] - pos[0], l.pos[1] - pos[1], l.pos[2] - pos[2]) <= HEARING_RADIUS,
    );
  }
}
