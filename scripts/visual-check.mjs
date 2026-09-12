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
const scenes = ['m0', 'probe', 'stack', 'hud', 'modal', 'uiscene', 'a11y'];

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
/**
 * The browser's own accessibility tree, per scene.
 *
 * `ACCEPTANCE-a11y.md` asserts the attributes the framework *wrote* (`[data-mvvm-a11y]` nodes). That is
 * a different question from "what does a screen reader see": Chrome computes its own tree, and the two
 * disagreed twice in round 76 — every text field was exposed **twice** (the mirror's `<div role="textbox">`
 * plus the field's real hidden `<input>`, with the div reporting its own label as its AX *value*), and
 * `aria-valuenow` was written on `textbox` nodes, where ARIA does not support it.
 *
 * So each entry below must appear **exactly once** in the computed tree, with these properties, and the
 * scene must expose exactly as many control nodes as there are entries — which is the strongest form of
 * "one node per control" the harness can state.
 */
const AX_EXPECTATIONS = {
  a11y: [
    { role: 'textbox', name: '名字' },
    { role: 'textbox', name: '备注' },
    { role: 'button', name: '普通按钮' },
    { role: 'checkbox', name: '接收通知', properties: { checked: true } },
    { role: 'button', name: '不可用按钮', properties: { disabled: true } },
    { role: 'slider', name: '音量', value: '40', properties: { valuemin: 0, valuemax: 100 } },
    { role: 'button', name: '可点击的卡片' },
    { role: 'region', name: '按钮区域' },
    { role: 'button', name: '区域内的按钮 1' },
    { role: 'button', name: '区域内的按钮 2' },
    { role: 'button', name: '区域内的按钮 3' },
    { role: 'button', name: '区域内的按钮 4' },
    { role: 'button', name: '区域内的按钮 5' },
    { role: 'button', name: '区域内的按钮 6' },
  ],
};

/** Roles the AX gate counts as "a control the user can act on" (the mirror's own vocabulary). */
const AX_CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'link',
  'region',
]);

/** Scenes where pressing `Tab` must land the computed tree on exactly one control node. */
const AX_TAB_SCENES = new Set(['a11y']);

/**
 * One computed AX property.
 *
 * Chrome's protocol mixes types here: `value.value` comes back as `true` for some properties and as the
 * string `'true'` for others (`checked` is tri-state), so every comparison normalises through `String()`.
 */
function axProperty(node, name) {
  const raw = (node.properties ?? []).find((entry) => entry.name === name)?.value?.value;
  return raw === undefined ? undefined : String(raw);
}

/**
 * Reads the computed accessibility tree and compares it with the expectations.
 *
 * @returns the list of problems; empty means the scene's tree is exactly as promised.
 */
async function checkAxTree(session, scene) {
  const expected = AX_EXPECTATIONS[scene];
  if (!expected) {
    return [];
  }
  const problems = [];
  if (AX_TAB_SCENES.has(scene)) {
    // One real `Tab`: focus must move in the framework *and* the computed tree must point at the node
    // that describes the control (the mirror node now takes DOM focus, which is how a screen reader
    // follows a canvas).
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab',
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab',
    });
    await sleep(250);
  }

  const { nodes } = await session.send('Accessibility.getFullAXTree');
  const visible = nodes.filter((node) => !node.ignored);
  const controls = visible.filter((node) => AX_CONTROL_ROLES.has(node.role?.value));

  for (const want of expected) {
    const matches = controls.filter(
      (node) => node.role?.value === want.role && (node.name?.value ?? '') === want.name,
    );
    if (matches.length !== 1) {
      problems.push(
        `"${want.name}" (${want.role}): found ${matches.length} node(s) in the computed tree, expected 1`,
      );
      continue;
    }
    const node = matches[0];
    if (want.value !== undefined && String(node.value?.value ?? '') !== want.value) {
      problems.push(`"${want.name}": value is "${node.value?.value}", expected "${want.value}"`);
    }
    for (const [name, value] of Object.entries(want.properties ?? {})) {
      const actual = axProperty(node, name);
      if (actual !== String(value)) {
        problems.push(`"${want.name}": ${name} is ${JSON.stringify(actual)}, expected ${value}`);
      }
    }
  }

  if (controls.length !== expected.length) {
    problems.push(
      `the tree exposes ${controls.length} control node(s), expected ${expected.length} ` +
        `(${controls.map((node) => `${node.role?.value}:${node.name?.value ?? ''}`).join(', ')})`,
    );
  }

  if (AX_TAB_SCENES.has(scene)) {
    const focused = controls.filter((node) => axProperty(node, 'focused') === 'true');
    if (focused.length !== 1) {
      problems.push(
        `after Tab, ${focused.length} control node(s) report focus, expected exactly 1 ` +
          `(the mirror node has to take DOM focus for a screen reader to follow)`,
      );
    }
  }

  // The live region is the other half of the feature: `role=status` with the configured politeness.
  const live = visible.filter((node) => node.role?.value === 'status');
  if (live.length !== 1) {
    problems.push(`found ${live.length} live region(s), expected exactly 1`);
  } else if (axProperty(live[0], 'live') !== 'assertive') {
    // The example app configures `MVVMPlugin.configure({ a11y: { politeness: 'assertive' } })`.
    problems.push(`the live region is "${axProperty(live[0], 'live')}", expected "assertive"`);
  }

  for (const problem of problems) {
    console.error(`[visual-check] ${scene} a11y: ${problem}`);
  }
  if (problems.length === 0) {
    console.log(
      `[visual-check] a11y tree ok for ${scene} (${controls.length} control nodes, no duplicates)`,
    );
  }
  return problems;
}

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

/**
 * The second half of the pixel check: what the same widgets must look like **after a theme switch**.
 *
 * The dark expectations above prove a widget painted the token it was supposed to; this proves it
 * *repainted* — the failure mode it exists for is a control that keeps its old colours on a new
 * background (the modal scrim did exactly that until round 71, see `DEFECT-BACKLOG` V38).
 *
 * Two kinds of entry, and both matter:
 *
 * - a **themed** point lists the *light* token of that widget (`danger` is `#f85149` in the dark theme
 *   and `#cf222e` in the light one), so a control that did not repaint fails;
 * - a **literal** point lists the same colour as the dark pass (`Rect({ color })` and world tiles are
 *   plain numbers, not tokens), so "everything changed" cannot pass for a correct repaint either.
 *
 * The canvas clear colour turns light by itself (the plugin keeps the camera in step with the theme),
 * which is checked wherever the corner is visible.
 */
const LIGHT_EXPECTATIONS = {
  m0: {
    // Both rects are literals: the theme must leave them alone.
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
  stack: {
    backdrop: { rgb: 0x161b22, fx: 0.05, fy: 0.05 },
    card: 0x1f6feb,
    badge: 0x3fb950,
    footer: 0xf2a33c,
  },
  hud: {
    // `score` is a themed button (dark `#2f6feb`, light `#0969da`); the tile is world colour.
    score: { rgb: 0x0969da, fx: 0.12, fy: 0.5 },
    tile: 0x161b22,
  },
  modal: {
    // `danger` and `surface` after the switch; the dialog is open (see SCENE_SETUP).
    'confirm.ok': { rgb: 0xcf222e, fx: 0.15, fy: 0.5 },
    'confirm.cancel': { rgb: 0xffffff, fx: 0.15, fy: 0.5 },
  },
  uiscene: {
    'show.a': { rgb: 0x0969da, fx: 0.12, fy: 0.5 },
  },
};

/** The clear colour the camera must show after switching to the light theme. */
const LIGHT_CANVAS_CLEAR = [0xf6, 0xf8, 0xfa];

/** How each scene switches theme, for the scenes that have light expectations. */
const THEME_SWITCH = {
  default:
    "window.game.scene.scenes.find((scene) => scene.scene.isActive()).mvvm.setTheme('light')",
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
function pixelSpec(scene, png, status, mode = 'dark') {
  const expectations = mode === 'light' ? LIGHT_EXPECTATIONS[scene] : PIXEL_EXPECTATIONS[scene];
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
      label: `${mode === 'light' ? 'canvas.clear (light)' : 'canvas.clear'}`,
      x: canvas.x + clearX,
      y: canvas.y + clearY,
      rgb: mode === 'light' ? LIGHT_CANVAS_CLEAR : [0x0d, 0x11, 0x17],
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

      // An opening dialog fades in over `transition.enter` (160 ms by default), so a screenshot taken
      // immediately after the setup would sample a *frame of the animation*: the scrim at 30 % of its
      // opacity and the danger fill blended with the page behind it — the pixel expectations below
      // describe the dialog at rest, and they must be read at rest. The wait is generic (any scene, any
      // layer) and resolves at once for a scene that animates nothing.
      await waitFor(
        async () => {
          const { result } = await session.send('Runtime.evaluate', {
            expression:
              '(() => { const scene = window.game?.scene?.scenes?.find((s) => s.scene.isActive());' +
              ' const pending = scene?.mvvm?.transitions?.pending;' +
              ' return pending === undefined || pending === 0; })()',
            returnByValue: true,
          });
          return result.value === true;
        },
        5000,
        `${scene} transitions settled`,
      );

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

      if (AX_EXPECTATIONS[scene]) {
        await session.send('Accessibility.enable');
        const axProblems = await checkAxTree(session, scene);
        failures += axProblems.length;
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

      // Second pass: switch the theme and look again. The geometry is reused on purpose — a theme
      // change moves nothing, so a sample that lands on the wrong control means the layout *did*
      // change (which would make the light expectations fail and say so).
      if (!LIGHT_EXPECTATIONS[scene]) {
        continue;
      }
      await session.send('Runtime.evaluate', {
        expression: `(() => { ${THEME_SWITCH[scene] ?? THEME_SWITCH.default}; return true; })()`,
      });
      await sleep(400);
      const lightPng = join(outDir, `${scene}.light.png`);
      const lightShot = await session.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(lightPng, Buffer.from(lightShot.data, 'base64'));
      console.log(`[visual-check] screenshot  ${lightPng}  (light theme)`);

      const lightSpec = pixelSpec(scene, lightPng, status, 'light');
      if (!lightSpec) {
        continue;
      }
      const lightMissing = lightSpec.checks.filter((check) => check.missing);
      for (const check of lightMissing) {
        console.error(`[visual-check] ${scene} (light): no rect reported for "${check.label}"`);
        failures += 1;
      }
      if (lightMissing.length === lightSpec.checks.length) {
        continue;
      }
      const lightSpecFile = join(outDir, `${scene}.light.pixels.json`);
      writeFileSync(lightSpecFile, `${JSON.stringify(lightSpec, null, 2)}\n`);
      try {
        await run('python3', [join(root, 'scripts', 'png-sample.py'), lightSpecFile]);
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
