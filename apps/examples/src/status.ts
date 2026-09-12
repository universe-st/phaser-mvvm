/**
 * Tiny status overlay used by the examples so that automated checks (headless Chrome
 * screenshots, `--dump-dom`, CI) can assert on the real geometry without reading pixels.
 */

export interface Reportable {
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

/** Appends `label=@x,y wxh` for a widget's last applied rect. */
export function reportWidget(label: string, widget: Reportable): void {
  const r = widget.appliedRect;
  appendStatus(`${label}=@${round(r.x)},${round(r.y)} ${round(r.width)}x${round(r.height)}`);
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
