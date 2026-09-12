#!/usr/bin/env node
/**
 * Visual + geometry check for `apps/examples`.
 *
 * One headless Chrome instance, driven over the DevTools protocol, so the DOM read and the
 * screenshot always come from the *same* page and viewport (two separate `--dump-dom` /
 * `--screenshot` runs disagree about the viewport height and silently shift every sample).
 *
 * For each scene it:
 *   1. sets an explicit viewport (deterministic across machines and CI),
 *   2. navigates to the scene hash in `?capture=1` mode (the app enables
 *      `preserveDrawingBuffer` so the WebGL frame survives the capture),
 *   3. reads the `#status` block, which the scenes fill with the rects the layout engine assigned,
 *   4. captures a PNG and samples the centre pixel of selected widgets
 *      (`scripts/png-sample.py`, Pillow-based).
 *
 * Usage:
 *   node scripts/visual-check.mjs
 *   node scripts/visual-check.mjs --no-build
 *   node scripts/visual-check.mjs --config vite.check.config.ts
 *   node scripts/visual-check.mjs --size 1024x768 --port 4174
 *
 * Exit code is non-zero when a scene reports an error, a sample mismatches, or Chrome fails.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(name);

const requestedPort = Number(flag('--port', '4173'));
const port = await freePort(requestedPort);
const debugPort = await freePort(Number(flag('--debug-port', '9222')));
const outDir = resolve(root, flag('--out', '.tmp/visual-check'));
const [viewWidth, viewHeight] = flag('--size', '1280x720').split('x').map(Number);
const scenes = ['m0', 'probe', 'stack', 'hud', 'modal', 'uiscene'];

/**
 * Optional per-scene preparation, evaluated in the page *before* the screenshot.
 *
 * `hud` is the camera-pinned HUD: scrolling the camera first is what makes its pixel check meaningful -
 * the HUD must stay where the layout put it while the world behind it moves. Add an entry here only
 * for a hook the scene itself exposes (they are documented in each scene's header).
 */
const SCENE_SETUP = {
  hud: 'window.hud.scroll(260, 140)',
  // The modal scene's dialog only exists once it is opened; the scene reports the dialog's own rects
  // into #status on the first open of each kind, so this runs before the status read.
  modal: 'window.modal.open("confirm")',
};

/**
 * Where the generic "did the renderer clear the canvas?" sample is taken, per scene.
 *
 * It defaults to 4px inside the canvas corner, which assumes the top-left is empty. The HUD page puts
 * its bar there, so that sample would measure the bar's translucent overlay *over* the clear colour.
 * For that scene the sample moves to a 2px seam between two world tiles (canvas-relative), where the
 * camera background is visible on purpose.
 */
const CANVAS_CLEAR_AT = {
  hud: [340, 60],
};

/**
 * Scenes whose canvas corner is *deliberately* not the clear colour.
 *
 * The modal scene's setup opens a dialog, and a dialog's scrim covers the whole canvas by design: the
 * corner is a translucent blend of the theme background, which is a GPU-rounding question and not a
 * stable expectation. The scene's own samples carry the check instead - an opaque `danger` fill, and
 * the dialog surface showing through a transparent `ghost` button, both of which can only look like
 * that if the overlay was painted above the page.
 */
const CANVAS_CLEAR_SKIP = new Set(['modal']);

/**
 * A stale server on the requested port would silently serve an old bundle, so probe for a port that
 * answers nothing. Both `localhost` (IPv6 `::1` included) and `127.0.0.1` are probed, because a
 * listener bound to one of them is invisible to a plain socket bind on the other.
 */
async function freePort(start) {
  for (let candidate = start; candidate < start + 30; candidate++) {
    if (!(await isServing(candidate))) {
      return candidate;
    }
  }
  throw new Error(`no free port in ${start}..${start + 30}`);
}

async function isServing(port) {
  for (const host of ['localhost', '127.0.0.1']) {
    try {
      await fetch(`http://${host}:${port}/index.html`, { signal: AbortSignal.timeout(750) });
      return true;
    } catch {
      // not answering on this host
    }
  }
  return false;
}

/** Widget label -> expected fill colour; `{rgb, fx, fy}` samples off-centre (partly covered widgets). */
const PIXEL_EXPECTATIONS = {
  /**
   * The pinned HUD (ADR-0009) with the camera scrolled to (260, 140):
   * - `score` is a *primary* button, sampled left of its label so the fill shows (`fx: 0.12`);
   * - `tile` is a world tile sampled at page (700, 380): its colour is decided by the *tile grid*, so
   *   the value below only matches if the camera really scrolled (world tile (4, 2) of the repeating
   *   3-colour pattern = `colors[0]`) - scrolling changes it, pinning does not.
   */
  hud: {
    score: { rgb: 0x2f6feb, fx: 0.12, fy: 0.5 },
    tile: 0x161b22,
  },
  /**
   * `#/modal` with the confirm dialog open (`window.modal.open("confirm")`):
   * - `confirm.ok` is the `danger` button, sampled left of its label (`fx: 0.15`) so the fill shows;
   * - `confirm.cancel` is a `ghost` button, whose normal background is *transparent* - so the sample
   *   reads the dialog surface behind it (`colors.surface`), never the scrim-darkened page. If the
   *   layer were painted under the page, both samples would come back as the blend instead.
   */
  modal: {
    'confirm.ok': { rgb: 0xf85149, fx: 0.15, fy: 0.5 },
    'confirm.cancel': { rgb: 0x161b22, fx: 0.15, fy: 0.5 },
  },
  m0: {
    'rect.blue': 0x2f6feb,
    'rect.amber': 0xf2a33c,
  },
  probe: {
    backdrop: 0x161b22,
    'abs.topleft': 0x3fb950,
    'abs.bottomright': 0xf85149,
    'hud.left': 0x8b949e,
    'hud.center': 0xd29922,
    'hud.right': 0xa371f7,
    bar: 0x2f6feb,
  },
  /**
   * `#/uiscene` — a page built by `UIScene` (the base class that mounts `content()` for you), in its
   * default state. `show.a` is the button of the view that is *currently* shown, so it is painted
   * `primary`. Including this scene is the point: the pixel gate is the only automated check that would
   * notice a `UIScene` that builds the right tree and then never mounts it.
   */
  uiscene: {
    'show.a': { rgb: 0x2f6feb, fx: 0.12, fy: 0.5 },
  },
  stack: {
    // The card covers the centre of the backdrop, so the backdrop is sampled near its own corner.
    backdrop: { rgb: 0x161b22, fx: 0.05, fy: 0.05 },
    card: 0x1f6feb,
    badge: 0x3fb950,
    footer: 0xf2a33c,
  },
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function chromePath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no Chrome/Chromium binary found (checked: ${CHROME_CANDIDATES.join(', ')})`);
}

/** Kills a detached child's whole process group (and falls back to the child itself). */
function killGroup(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Minimal DevTools-protocol client built on Node's global fetch + WebSocket. */
class CdpSession {
  constructor(webSocket) {
    this.socket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePromise, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(`${message.error.message} (${message.error.code})`));
        } else {
          resolvePromise(message.result);
        }
        return;
      }
      const handlers = this.listeners.get(message.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.params);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  once(method) {
    return new Promise((resolvePromise) => {
      const handler = (params) => {
        const handlers = this.listeners.get(method) ?? [];
        this.listeners.set(
          method,
          handlers.filter((entry) => entry !== handler),
        );
        resolvePromise(params);
      };
      this.on(method, handler);
    });
  }
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  return new CdpSession(socket);
}

/** Extracts the text of the page's `#status` block. */
function parseStatus(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parses `label=@x,y wxh` lines reported by the scenes. */
function parseRects(status) {
  const rects = new Map();
  for (const line of status.split('\n')) {
    const match = /^([\w.]+)=@(-?[\d.]+),(-?[\d.]+) ([\d.]+)x([\d.]+)$/.exec(line.trim());
    if (match) {
      rects.set(match[1], {
        x: Number(match[2]),
        y: Number(match[3]),
        width: Number(match[4]),
        height: Number(match[5]),
      });
    }
  }
  return rects;
}

/** Builds the pixel-check spec for a scene from its status block. */
function pixelSpec(scene, png, status) {
  const expectations = PIXEL_EXPECTATIONS[scene];
  if (!expectations) {
    return null;
  }
  const rects = parseRects(status);
  // Stage coordinates are canvas-relative; the app reports the canvas rect (Phaser may centre it).
  const canvas = rects.get('canvas') ?? { x: 0, y: 0, width: viewWidth, height: viewHeight };
  const [clearX, clearY] = CANVAS_CLEAR_AT[scene] ?? [4, 4];
  const checks = [];
  if (!CANVAS_CLEAR_SKIP.has(scene)) {
    checks.push({
      label: 'canvas.clear',
      x: canvas.x + clearX,
      y: canvas.y + clearY,
      rgb: [0x0d, 0x11, 0x17],
    });
  }

  for (const [label, expected] of Object.entries(expectations)) {
    const rect = rects.get(label);
    if (!rect) {
      checks.push({ label, x: 0, y: 0, rgb: [0, 0, 0], missing: true });
      continue;
    }
    const fx = typeof expected === 'object' ? (expected.fx ?? 0.5) : 0.5;
    const fy = typeof expected === 'object' ? (expected.fy ?? 0.5) : 0.5;
    const rgb = typeof expected === 'object' ? expected.rgb : expected;
    checks.push({
      label,
      x: Math.round(canvas.x + rect.x + rect.width * fx),
      y: Math.round(canvas.y + rect.y + rect.height * fy),
      rgb: [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff],
    });
  }

  return { png, scale: 1, checks };
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  if (!has('--no-build')) {
    await run('pnpm', ['--filter', '@phaser-mvvm/examples', 'exec', 'vite', 'build']);
  }

  // `detached: true` makes the child a process-group leader, so the whole group can be killed below.
  // Without it, `pnpm exec vite preview` leaves the *real* vite process behind when pnpm is signalled:
  // the run "succeeds", the server keeps the port, and the next run's free-port probe hands out a port
  // a zombie already holds ("timed out waiting for vite preview" — five strays had piled up before this
  // was noticed).
  const preview = spawn(
    'pnpm',
    [
      '--filter',
      '@phaser-mvvm/examples',
      'exec',
      'vite',
      'preview',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: 'inherit', detached: true },
  );
  preview.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[visual-check] preview server exited with ${code}`);
    }
  });

  const cleanup = () => {
    chromeProcess?.kill('SIGTERM');
    killGroup(preview);
  };
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  const base = `http://localhost:${port}`;
  const debugBase = `http://127.0.0.1:${debugPort}`;
  let chromeProcess = null;
  let failures = 0;

  try {
    await waitFor(async () => (await fetch(`${base}/index.html`)).ok, 30000, 'vite preview');

    // Guard against a stale server answering on this port: the served HTML must be the built one.
    const builtIndex = `${readFileSync(join(root, 'apps/examples/dist/index.html'), 'utf8')}`;
    const servedIndex = await (await fetch(`${base}/index.html`)).text();
    if (builtIndex.trim() !== servedIndex.trim()) {
      throw new Error(
        `the server on port ${port} is serving a different bundle than apps/examples/dist (stale server?)`,
      );
    }

    chromeProcess = spawn(
      chromePath(),
      [
        '--headless=new',
        '--hide-scrollbars',
        '--enable-unsafe-swiftshader',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${debugPort}`,
        `--window-size=${viewWidth},${viewHeight}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );

    await waitFor(
      async () => (await fetch(`${debugBase}/json/version`)).ok,
      20000,
      'chrome devtools endpoint',
    );

    const target = await (
      await fetch(`${debugBase}/json/new?about:blank`, { method: 'PUT' })
    ).json();
    const session = await connect(target.webSocketDebuggerUrl);

    await session.send('Page.enable');
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: viewWidth,
      height: viewHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const scene of scenes) {
      // A distinct query string forces a real document load per scene: navigating between two hashes
      // of the same document fires no load event and would hang the wait below.
      const url = `${base}/?capture=1&scene=${scene}#/${scene}`;
      const png = join(outDir, `${scene}.png`);

      const loaded = session.once('Page.loadEventFired');
      await session.send('Page.navigate', { url });
      await loaded;

      // Scenes that need a specific state (a scrolled camera, an open panel) declare it here; this
      // runs before the status read so the geometry and the pixels describe the same moment.
      const setup = SCENE_SETUP[scene];
      if (setup) {
        await session.send('Runtime.evaluate', {
          expression: `(() => { ${setup}; return true; })()`,
        });
      }

      // Wait until the scene reported its layout (or an error) into #status.
      await waitFor(
        async () => {
          const { result } = await session.send('Runtime.evaluate', {
            expression: "document.getElementById('status')?.textContent ?? ''",
            returnByValue: true,
          });
          return typeof result.value === 'string' && /(---|ERROR:|REJECTION:)/.test(result.value);
        },
        15000,
        `${scene} layout`,
      );

      const { result } = await session.send('Runtime.evaluate', {
        expression: "document.getElementById('status')?.textContent ?? ''",
        returnByValue: true,
      });
      const status = parseStatus(result.value);
      writeFileSync(join(outDir, `${scene}.txt`), `${status ?? ''}\n`);
      console.log(`[visual-check] status for ${scene}:\n${status}\n`);

      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(png, Buffer.from(shot.data, 'base64'));
      console.log(`[visual-check] screenshot  ${png}`);

      if (!status) {
        console.error(`[visual-check] ${scene}: no #status content`);
        failures += 1;
        continue;
      }
      if (/ERROR:|REJECTION:/.test(status)) {
        console.error(`[visual-check] ${scene}: the page reported an error`);
        failures += 1;
        continue;
      }

      const spec = pixelSpec(scene, png, status);
      if (!spec) {
        continue;
      }
      const missing = spec.checks.filter((check) => check.missing);
      for (const check of missing) {
        console.error(`[visual-check] ${scene}: no rect reported for "${check.label}"`);
        failures += 1;
      }
      if (missing.length === spec.checks.length) {
        continue;
      }

      const specFile = join(outDir, `${scene}.pixels.json`);
      writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
      try {
        await run('python3', [join(root, 'scripts', 'png-sample.py'), specFile]);
      } catch {
        failures += 1;
      }
    }

    await fetch(`${debugBase}/json/close/${target.id}`);
  } finally {
    chromeProcess?.kill('SIGTERM');
    killGroup(preview);
  }

  if (failures > 0) {
    console.error(`[visual-check] ${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('[visual-check] ok');
  }
}

main().catch((error) => {
  console.error('[visual-check] failed:', error);
  process.exitCode = 1;
});
