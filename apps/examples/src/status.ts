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

/** Sums the local positions of a widget and its container ancestors (UI has no rotation/scale). */
function stagePosition(widget: Reportable): { x: number; y: number } {
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
