// Keyboard + mouse + pointer lock, or touch controls on phones/tablets (see touch.ts). Keeps raw state;
// the controller reads it on fixed ticks. In touch mode there is no pointer lock: `locked` means "playing".

export class Input {
  readonly keys = new Set<string>();
  /** Mouse look accumulated since the last read (radians-ready pixels). */
  private dx = 0;
  private dy = 0;
  locked = false;
  readonly buttons = new Set<number>();
  /** One-shot presses (e.g. jump in fly toggle, hotbar keys) consumed by the reader. */
  private readonly pressed: string[] = [];
  private wheel = 0;
  onLockChange: (locked: boolean) => void = () => {};
  /** Touch mode: playing without pointer lock, movement from the on-screen joystick. */
  touchMode = false;
  /** Analog movement from the joystick: forward (−1..1) and right (−1..1). */
  readonly move = { fwd: 0, side: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked && e.code !== 'F3') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.pressed.push(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  requestLock(): void {
    if (this.touchMode) {
      if (!this.locked) {
        this.locked = true;
        this.onLockChange(true);
      }
      return;
    }
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  /** Stop playing (pause / chat): exits pointer lock, or ends the touch session. */
  release(): void {
    if (!this.touchMode) {
      if (this.locked) document.exitPointerLock();
      return;
    }
    if (!this.locked) return;
    this.locked = false;
    this.keys.clear();
    this.buttons.clear();
    this.move.fwd = 0;
    this.move.side = 0;
    this.onLockChange(false);
  }

  /** Touch: look around by `dx`, `dy` mouse-equivalent pixels. */
  addLook(dx: number, dy: number): void {
    if (!this.locked) return;
    this.dx += dx;
    this.dy += dy;
  }

  /** Touch: hold or release a key (e.g. the jump button holds Space). */
  hold(code: string, down: boolean): void {
    if (!this.locked) return;
    if (down) {
      if (!this.keys.has(code)) this.pressed.push(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** Touch: hold or release a mouse button (0 = break, 2 = place); a press also counts as a click. */
  holdButton(button: number, down: boolean): void {
    if (!this.locked) return;
    if (down) {
      this.buttons.add(button);
      this.pressed.push(`Mouse${button}`);
    } else {
      this.buttons.delete(button);
    }
  }

  takeLook(): [number, number] {
    const out: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  takePresses(): string[] {
    return this.pressed.splice(0);
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** For tests/automation (e.g. Playwright, MCP): act as if locked and inject input. */
  simulate = {
    lock: () => {
      this.locked = true;
      this.onLockChange(true);
    },
    down: (code: string) => {
      this.keys.add(code);
      this.pressed.push(code);
    },
    up: (code: string) => this.keys.delete(code),
    look: (dx: number, dy: number) => {
      this.dx += dx;
      this.dy += dy;
    },
    click: (button: number) => this.pressed.push(`Mouse${button}`),
  };
}
