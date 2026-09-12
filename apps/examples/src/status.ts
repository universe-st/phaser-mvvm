/**
 * Tiny status overlay used by the examples so that automated checks (headless Chrome
 * screenshots, `--dump-dom`, CI) can assert on the real geometry without reading pixels.
 */

/** Minimal container-chain shape used to accumulate stage coordinates. */
export interface StageTransform {
  /** Local position, as written by the layout engine's `applyRect`. */
  x: number;
  y: number;
  parentContainer: StageTransform | null;
}

export interface Reportable extends StageTransform {
  /** Rect assigned by the layout engine, in the *parent's* local coordinates. */
  appliedRect: { x: number; y: number; width: number; height: number };
}

const lines: string[] = [];

function element(): HTMLElement | null {
  return document.getElementById('status');
}

function render(): void {
  const el = element();
  if (el) {
    el.textContent = lines.join('\n');
  }
}

/** Replaces the whole status block. */
export function setStatus(text: string): void {
  lines.length = 0;
  if (text) {
    lines.push(text);
  }
  render();
}

/** Appends a line to the status block. */
export function appendStatus(text: string): void {
  lines.push(text);
  render();
}

/**
 * Appends `label=@x,y wxh` for a widget.
 *
 * The size comes from the layout engine's rect; the origin is accumulated through the container
 * chain, because the engine works in parent-local coordinates while the checks compare against
 * stage pixels.
 */
export function reportWidget(label: string, widget: Reportable): void {
  const rect = widget.appliedRect;
  const origin = stagePosition(widget);
  appendStatus(
    `${label}=@${round(origin.x)},${round(origin.y)} ${round(rect.width)}x${round(rect.height)}`,
  );
}

/** The canvas rect plus the game's design size — everything needed to turn design px into CSS px. */
export interface DisplayMapping {
  canvas: HTMLCanvasElement | null;
  scale: { gameSize: { width: number; height: number } };
}

/**
 * Canvas CSS size ÷ the game's design size.
 *
 * `Scale.RESIZE` (the examples' default) keeps them equal, so this is 1 and every page coordinate is
 * just "canvas origin + stage position". `Scale.FIT` renders a 980×614 design into, say, a 390×244 CSS
 * box: the canvas is *scaled*, and a probe that ignored it would aim at the wrong place (round 73 hit
 * exactly that — `pt.*` points were 2.5× too far from the origin, which is outside the canvas entirely
 * on a phone). Same formula as the DOM input bridge's `displayScale`.
 */
export function displayScale(game: DisplayMapping): { x: number; y: number } {
  const canvas = game.canvas;
  const logical = game.scale?.gameSize;
  if (!canvas || !logical?.width || !logical?.height) {
    return { x: 1, y: 1 };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width > 0 && logical.width > 0 ? rect.width / logical.width : 1,
    y: rect.height > 0 && logical.height > 0 ? rect.height / logical.height : 1,
  };
}

/**
 * Page (CSS pixel) coordinates of a widget's centre — what a pointer event needs.
 *
 * The stage position is in *design* pixels, so it is scaled by {@link displayScale} before the canvas
 * origin is added; the widget's own size is scaled the same way, which is why the centre cannot simply
 * be "origin + size/2" in CSS pixels.
 */
export function pagePoint(game: DisplayMapping, widget: Reportable): { x: number; y: number } {
  const canvas = game.canvas;
  const origin = stagePosition(widget);
  const rect = widget.appliedRect;
  const scale = displayScale(game);
  const left = canvas ? canvas.getBoundingClientRect().left : 0;
  const top = canvas ? canvas.getBoundingClientRect().top : 0;
  return {
    x: left + (origin.x + rect.width / 2) * scale.x,
    y: top + (origin.y + rect.height / 2) * scale.y,
  };
}

/**
 * Page (CSS pixel) coordinates of a widget's **top-left** — what a rect needs.
 *
 * {@link pagePoint} is the centre for pointer events; this one is for reporting a box, so the size has
 * to be scaled by the caller (`appliedRect` is in design pixels).
 */
export function pageOrigin(game: DisplayMapping, widget: Reportable): { x: number; y: number } {
  const canvas = game.canvas;
  const origin = stagePosition(widget);
  const scale = displayScale(game);
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  return {
    x: (rect?.left ?? 0) + origin.x * scale.x,
    y: (rect?.top ?? 0) + origin.y * scale.y,
  };
}

/** Sums the local positions of a widget and its container ancestors (UI has no rotation/scale). */
export function stagePosition(widget: Reportable): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: StageTransform | null = widget;
  while (current) {
    x += current.x;
    y += current.y;
    current = current.parentContainer;
  }
  return { x, y };
}

/**
 * Appends the canvas position/size (CSS pixels). Phaser centres the canvas inside the window, so
 * stage coordinates have to be offset by this rect before sampling screenshot pixels.
 */
export function reportCanvas(game: { canvas: HTMLCanvasElement | null }): void {
  const canvas = game.canvas;
  if (!canvas) {
    appendStatus('canvas=none');
    return;
  }
  const rect = canvas.getBoundingClientRect();
  appendStatus(
    `canvas=@${round(rect.left)},${round(rect.top)} ${round(rect.width)}x${round(rect.height)}`,
  );
}

/** Installs global error handlers that surface into the status block. */
export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    appendStatus(`ERROR: ${event.message}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    appendStatus(`REJECTION: ${String(event.reason)}`);
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
