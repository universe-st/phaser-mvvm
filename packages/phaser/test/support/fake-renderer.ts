/**
 * A Node-side fake renderer: enough DOM and enough Scene for real Phaser objects to be built in CI.
 *
 * `packages/phaser`'s original test suite could only cover the *pure* modules (`nav`, `focus`'s
 * bookkeeping, `route-plan`, `transition`, …) because importing Phaser in Node throws
 * (`window is not defined`) and a `Widget` needs a renderer-side scene. Every behaviour that lived
 * on the `Widget` side of that line — the per-widget event vocabulary, teardown, focus plumbing —
 * therefore had no unit test at all and was only ever checked in a browser (DEFECT-BACKLOG §4
 * listed the missing fixture for years).
 *
 * The fixture closes exactly that hole and nothing more:
 *
 * - `installDomStub()` defines the handful of globals Phaser touches while its modules initialise
 *   (a canvas whose 2D context is a permissive `Proxy` — Phaser's module-level feature detection
 *   calls `getImageData()` and then writes `fillStyle` on the result),
 * - `createFakeScene()` returns an object that is a `Phaser.Scene` as far as *GameObjects* are
 *   concerned: a display list, an event emitter, a clock with `addEvent`/`delayedCall`, a camera.
 *
 * Two rules keep it honest:
 *
 * 1. **It is a stub, not a renderer.** Nothing is drawn and no texture is loaded; a test that needs
 *    pixels belongs in `scripts/visual-check.mjs` or in a Playwright MCP session.
 * 2. **Phaser must be imported *after* `installDomStub()`.** ESM hoists static imports, so a test
 *    file that needs the fixture installs the stub first and then `await import(...)`s the module
 *    under test (see `widget-events.test.ts`). The stub module itself must never import Phaser.
 */

import type Phaser from 'phaser';

/** Minimal 2D context: real methods where Phaser reads a value back, a no-op for everything else. */
function makeContext(canvas: unknown): CanvasRenderingContext2D {
  const base: Record<string, unknown> = {
    canvas,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)),
      width: w | 0,
      height: h | 0,
    }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)),
      width: w | 0,
      height: h | 0,
    }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    getContextAttributes: () => ({}),
  };
  return new Proxy(base, {
    get: (target, key) => (key in target ? Reflect.get(target, key) : () => undefined),
    set: (target, key, value) => {
      // Phaser writes plain string properties (`fillStyle`, `font`). A symbol key cannot index the
      // record, so it goes through `Reflect.set` untouched.
      Reflect.set(target, key, value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 1,
    height: 1,
    style: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setAttribute: () => undefined,
    appendChild: () => undefined,
    toDataURL: () => '',
  };
  canvas.getContext = () => makeContext(canvas);
  return canvas as unknown as HTMLCanvasElement;
}

let installed = false;

/**
 * Defines the browser globals Phaser's module init reads. Idempotent, so several test files (or a
 * file that installs it twice) cannot fight over it.
 */
export function installDomStub(): void {
  if (installed) {
    return;
  }
  installed = true;

  const global = globalThis as unknown as Record<string, unknown>;
  const documentStub = {
    createElement: (tag: string) =>
      tag === 'canvas'
        ? makeCanvas()
        : { style: {}, setAttribute: () => undefined, appendChild: () => undefined },
    createElementNS: () => makeCanvas(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    documentElement: { style: {} },
    body: { appendChild: () => undefined, removeChild: () => undefined, style: {} },
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    getElementsByTagName: () => [],
    querySelector: () => null,
  };

  global.window = globalThis;
  global.document = documentStub;
  global.HTMLCanvasElement = function HTMLCanvasElement() {};
  global.Image = function Image() {
    return makeCanvas();
  };
  global.XMLHttpRequest = function XMLHttpRequest(this: Record<string, unknown>) {
    this.open = () => undefined;
    this.send = () => undefined;
    this.addEventListener = () => undefined;
  };
  global.requestAnimationFrame = (callback: (time: number) => void) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
  global.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
}

/**
 * The parts of `Phaser.Scene` a `GameObject`/`Widget` reaches for.
 *
 * `captured` records what the object under test asked the scene to do (`add.existing`, timers), which
 * is how a test asserts "the widget registered exactly one timer" without a renderer.
 */
export interface FakeScene {
  readonly sys: {
    queueDepthSort(): void;
    events: {
      on(event: string, fn: (...args: unknown[]) => void, context?: unknown): void;
      once(event: string, fn: (...args: unknown[]) => void, context?: unknown): void;
      off(event: string, fn?: (...args: unknown[]) => void, context?: unknown): void;
      emit(event: string, ...args: unknown[]): void;
    };
    settings: Record<string, unknown>;
  };
  readonly add: { existing(child: unknown): void };
  readonly time: {
    now: number;
    delayedCall(delay: number, callback: () => void): { remove(): void };
    addEvent(config: { delay: number; callback: () => void; loop?: boolean }): { remove(): void };
  };
  readonly cameras: { main: Record<string, unknown> };
  readonly events: {
    on(event: string, fn: (...args: unknown[]) => void): void;
    once(event: string, fn: (...args: unknown[]) => void): void;
    off(event: string, fn?: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };
  /** Live timers, so a leak test can assert they were removed. */
  readonly timers: Set<{ remove(): void }>;
  /** Children passed to `add.existing()`, in order. */
  readonly added: unknown[];
  emit(event: string, ...args: unknown[]): void;
}

/** Builds one fake scene. Cast to `Phaser.Scene` at the call site (`asUnknownScene`). */
export function createFakeScene(): FakeScene {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      listener(...args);
    }
  };
  const on = (event: string, fn: (...args: unknown[]) => void): void => {
    const set = listeners.get(event) ?? new Set();
    set.add(fn);
    listeners.set(event, set);
  };
  const off = (event: string, fn?: (...args: unknown[]) => void): void => {
    if (!fn) {
      listeners.delete(event);
      return;
    }
    listeners.get(event)?.delete(fn);
  };

  const timers = new Set<{ remove(): void }>();
  const events = { on, once: on, off, emit };

  const scene: FakeScene = {
    sys: { queueDepthSort: () => undefined, events, settings: {} },
    add: { existing: (child: unknown) => void scene.added.push(child) },
    time: {
      now: 0,
      delayedCall: (delay: number, callback: () => void) => {
        void delay;
        const handle = {
          remove: () => {
            timers.delete(handle);
          },
          callback,
        };
        timers.add(handle);
        return handle;
      },
      addEvent: (config: { delay: number; callback: () => void }) => {
        const handle = {
          remove: () => {
            timers.delete(handle);
          },
          callback: config.callback,
        };
        timers.add(handle);
        return handle;
      },
    },
    cameras: { main: { setBackgroundColor: () => undefined, width: 800, height: 600 } },
    events,
    timers,
    added: [],
    emit,
  };

  return scene;
}

/** `createFakeScene()` typed as the real thing — the one cast in the fixture. */
export function asScene(scene: FakeScene): Phaser.Scene {
  return scene as unknown as Phaser.Scene;
}
