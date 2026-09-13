#!/usr/bin/env node
/**
 * Android acceptance gate for the phaser-mvvm examples app shipped through Cordova.
 *
 * The repository's device-shaped claims were unverifiable until there was a device: this script drives a
 * real Android emulator (`adb shell input` produces genuine `MotionEvent`s, the System WebView does the
 * rendering) and reads the app's own probes (`#status`, `#demo-state`, `window.<scene>.*`) over the
 * WebView DevTools protocol. It is the Android counterpart of `scripts/visual-check.mjs`, and it reuses
 * that script's expectations instead of keeping a second copy of them.
 *
 * Prerequisites (see `docs/ACCEPTANCE-android.md` for the full recipe):
 *
 *   sdkmanager "system-images;android-36;google_apis;arm64-v8a"
 *   avdmanager create avd -n pmvvm_api36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_6
 *   emulator -avd pmvvm_api36 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect
 *   pnpm --filter @phaser-mvvm/examples exec vite build --base ./ \
 *     --outDir .tmp/android/www --emptyOutDir
 *   cordova create .tmp/android/cordova-app com.example.phasermvvm PhaserMVVM
 *   cp -R .tmp/android/www/. .tmp/android/cordova-app/www/
 *   (cd .tmp/android/cordova-app && cordova platform add android && cordova build android --debug)
 *
 * Usage:
 *
 *   node scripts/android-check.mjs device-info
 *   node scripts/android-check.mjs install --scene states
 *   node scripts/android-check.mjs verify                 # the whole A1–A9 matrix
 *   node scripts/android-check.mjs verify --only A2,A5
 *   node scripts/android-check.mjs ax-tables              # what the harness read out of visual-check.mjs
 *
 * Coordinate mapping: `adb shell input tap` takes **device pixels from the screen origin**, while the
 * app's probes report **CSS pixels inside the WebView viewport**. Both `devicePixelRatio` and the
 * WebView's screen origin have to be applied: the devtools target reports the WebView box itself
 * (`screenY` is the status bar), and A2 calibrates the offset by tapping a known control and requiring
 * the app to react — a wrong offset and a dead control look identical otherwise.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = process.env.ANDROID_APP_ID ?? 'com.example.phasermvvm';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_HOME =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  `${process.env.HOME}/Library/Android/sdk`;
const ADB = process.env.ADB ?? `${ANDROID_HOME}/platform-tools/adb`;
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);
/** Built by the Cordova recipe in the header; `CORDOVA_PROJECT` points at a checkout of its own. */
const CORDOVA_PROJECT = process.env.CORDOVA_PROJECT ?? join(ROOT, '.tmp/android/cordova-app');
const APK = join(CORDOVA_PROJECT, 'platforms/android/app/build/outputs/apk/debug/app-debug.apk');
/**
 * The desktop AX gate lives in `scripts/visual-check.mjs`. Rather than keeping a second copy of its
 * expectations (which would drift), the harness reads that file and parses the tables it needs. The
 * parse is deliberately dumb — object literals with string/number/boolean fields — and the count check
 * inside A6 makes it self-checking: an entry the parser misses shows up as a count mismatch.
 */
const VISUAL_CHECK = join(ROOT, 'scripts/visual-check.mjs');

/**
 * Removes line and block comments, ignoring anything inside string literals.
 *
 * This is not cosmetic: the expectation tables are commented, and English prose in a comment contains
 * apostrophes (`the node's description`), which a quote-tracking splitter would read as an unterminated
 * string and then skip the braces it is supposed to count.
 */
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      out += char;
      if (char === quote && text[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** Splits a `[...]` array body into top-level `{...}` object literals (brace-balanced, string-aware). */
function splitObjects(body) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && body[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(body.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

const single = (text, key) => new RegExp(`${key}:\\s*'([^']*)'`).exec(text)?.[1];
const pairs = (text, key, value) => {
  const block = new RegExp(`${key}:\\s*\\{([^}]*)\\}`).exec(text)?.[1];
  if (!block) {
    return {};
  }
  const found = {};
  for (const [, name, raw] of block.matchAll(/(\w+):\s*(true|false|'[^']*'|-?\d+)/g)) {
    found[name] = raw.startsWith("'") ? raw.slice(1, -1) : raw;
  }
  return found;
};

function readAxExpectations(table, scene) {
  const source = readFileSync(VISUAL_CHECK, 'utf8');
  const start = source.indexOf(`const ${table} = {`);
  const body = source.slice(start, source.indexOf('\n};', start));
  const sceneStart = body.indexOf(`${scene}: [`);
  const sceneBody = body.slice(sceneStart + scene.length + 3);
  const end = sceneBody.indexOf('\n  ],');
  const entries = stripComments(end >= 0 ? sceneBody.slice(0, end) : sceneBody);
  return splitObjects(entries).map((text) => ({
    role: single(text, 'role'),
    name: single(text, 'name') ?? '',
    value: single(text, 'value'),
    properties: pairs(text, 'properties'),
    descendants: Object.fromEntries(
      Object.entries(pairs(text, 'descendants')).map(([role, count]) => [role, Number(count)]),
    ),
  }));
}

/**
 * The desktop gate runs `SCENE_SETUP[scene]` before it reads the tree (for `#/a11y` that is
 * `window.a11y.validate(); window.a11y.setVolume(65)` — a failed submit and a moved slider, i.e. the
 * states the frozen expectations describe). The Android run has to start from the same place.
 */
function readSceneSetup(scene) {
  const source = readFileSync(VISUAL_CHECK, 'utf8');
  const start = source.indexOf('const SCENE_SETUP = {');
  if (start < 0) {
    return null;
  }
  const body = source.slice(start, source.indexOf('\n};', start));
  return new RegExp(`(?:^|\\n)\\s*${scene}:\\s*'([^']*)'`).exec(body)?.[1] ?? null;
}

function readAxControlRoles() {
  const source = readFileSync(VISUAL_CHECK, 'utf8');
  const start = source.indexOf('const AX_CONTROL_ROLES = new Set([');
  const body = source.slice(start, source.indexOf(']);', start));
  return new Set([...body.matchAll(/'([a-z]+)'/g)].map((match) => match[1]));
}

/** Chrome's flattened tree: every non-ignored descendant, walking `childIds`. */
function axDescendants(nodes, node) {
  const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
  const out = [];
  const walk = (current) => {
    for (const id of current.childIds ?? []) {
      const child = byId.get(id);
      if (!child || child.ignored) {
        continue;
      }
      out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

function axProperty(node, name) {
  const raw = (node.properties ?? []).find((entry) => entry.name === name)?.value?.value;
  return raw === undefined ? undefined : String(raw);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Unbuffered progress note: a hang has to be locatable from the log, not guessed at. */
function stage(message) {
  try {
    writeFileSync(2, `[device-check] ${message}\n`);
  } catch {
    /* stderr closed */
  }
}

// ------------------------------------------------------------------------------------------------ adb

function adb(args, { binary = false } = {}) {
  return execFileSync(ADB, args, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const shell = (command) => adb(['shell', command]);

async function waitForBoot(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  adb(['wait-for-device']);
  while (Date.now() < deadline) {
    if (shell('getprop sys.boot_completed').trim() === '1') {
      return true;
    }
    await sleep(2000);
  }
  throw new Error('emulator did not finish booting');
}

function appPid() {
  const out = shell(`pidof ${APP_ID}`).trim();
  return out ? Number(out.split(/\s+/)[0]) : null;
}

function deviceInfo() {
  const size = /(\d+)x(\d+)/.exec(shell('wm size').trim());
  const density = /(\d+)/.exec(shell('wm density').trim());
  return {
    sdk: shell('getprop ro.build.version.sdk').trim(),
    release: shell('getprop ro.build.version.release').trim(),
    abi: shell('getprop ro.product.cpu.abi').trim(),
    model: shell('getprop ro.product.model').trim(),
    size: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
    density: density ? Number(density[1]) : null,
    frame: appWindowFrame(),
    insets: displayInsets(),
  };
}

/** The app window's frame on the physical screen — `input tap` works in this space. */
function appWindowFrame() {
  const dump = shell('dumpsys window windows');
  let inApp = false;
  for (const line of dump.split('\n')) {
    if (line.includes('Window{') && line.includes(APP_ID)) {
      inApp = true;
      continue;
    }
    if (!inApp) {
      continue;
    }
    const frame = /mFrame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(line);
    if (frame) {
      const [, l, t, r, b] = frame.map(Number);
      return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
    }
    if (/^\s*Window\{/.test(line)) {
      inApp = false;
    }
  }
  return null;
}

/** Whether the system soft keyboard is actually up — the half of the IME story a page cannot read. */
function imeState() {
  const dump = shell('dumpsys input_method');
  const grab = (name) => new RegExp(`${name}=(true|false)`).exec(dump)?.[1] ?? null;
  return { inputShown: grab('mInputShown'), viewShown: grab('mIsInputViewShown') };
}

function displayInsets() {
  const dump = shell('dumpsys window displays');
  const parse = (regex) => {
    const match = regex.exec(dump);
    return match
      ? {
          left: Number(match[1]),
          top: Number(match[2]),
          right: Number(match[3]),
          bottom: Number(match[4]),
        }
      : null;
  };
  return {
    stable: parse(/mStableInsets=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/),
    content: parse(/mContentInsets=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/),
  };
}

/**
 * Samples a small box around each point and returns the **dominant** colour.
 *
 * `scripts/png-sample.py` compares exact literals, which is right for the desktop gate where the values
 * were measured; on a device the GPU rounds differently, so this returns the reading and lets the check
 * apply a ±2 tolerance.
 */
function samplePixels(png, points) {
  const script = `
import json, sys
from PIL import Image
spec = json.load(sys.stdin)
image = Image.open(spec["png"]).convert("RGB")
out = []
for point in spec["points"]:
    radius = point.get("radius", 2)
    counts = {}
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            pixel = image.getpixel((point["x"] + dx, point["y"] + dy))
            counts[pixel] = counts.get(pixel, 0) + 1
    best = max(counts.items(), key=lambda entry: entry[1])
    out.append({
        "label": point["label"],
        "x": point["x"],
        "y": point["y"],
        "rgb": list(best[0]),
        "dominant": best[1],
        "distinct": len(counts),
    })
print(json.dumps(out))
`;
  let raw;
  try {
    raw = execFileSync('python3', ['-c', script], {
      input: JSON.stringify({ png, points }),
      encoding: 'utf8',
    });
  } catch (error) {
    stage(
      `samplePixels failed: code=${error.code} status=${error.status} png=${png} points=${JSON.stringify(
        points,
      )} stderr=${String(error.stderr ?? '')
        .trim()
        .slice(0, 300)}`,
    );
    throw error;
  }
  return JSON.parse(raw);
}

const rgbOf = (token) => [(token >> 16) & 0xff, (token >> 8) & 0xff, token & 0xff];
const closeEnough = (actual, expected, tolerance = 2) =>
  actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);

// ------------------------------------------------------------------------------- DevTools protocol

class CdpSession {
  constructor(webSocket) {
    this.socket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.consoleLog = [];
    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(`${message.error.message} (${message.error.code})`));
        } else {
          resolve(message.result);
        }
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        this.consoleLog.push({ type: message.params.type, text });
      }
      for (const handler of this.listeners.get(message.method) ?? []) {
        handler(message.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result?.value;
  }
}

/**
 * The devtools target carries the WebView's own screen box in **device pixels** (`screenY` is the status
 * bar), which is exactly the offset `input tap` needs. It is only filled in once the window is laid out,
 * so an incomplete description is rejected rather than half-trusted.
 */
function parseWebViewRect(page) {
  try {
    const described = JSON.parse(page.description ?? '{}');
    const numbers = ['screenX', 'screenY', 'width', 'height'].map((key) => described[key]);
    if (numbers.every((value) => Number.isFinite(value)) && described.width > 0) {
      return described;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Re-reads the target list so the WebView rect reflects the laid-out window. */
async function readWebViewRect(port = CDP_PORT) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000),
    });
    const targets = await response.json();
    const page = targets.find((target) => target.type === 'page') ?? targets[0];
    return page ? parseWebViewRect(page) : null;
  } catch {
    return null;
  }
}

async function connectCdp(port = CDP_PORT) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(5000),
  });
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page') ?? targets[0];
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`no page target on 127.0.0.1:${port}`);
  }
  // The WebView reports its own screen rectangle here (device pixels): `screenY` is the status bar,
  // which is exactly the offset `input tap` needs — far more trustworthy than parsing `dumpsys`.
  const webViewRect = parseWebViewRect(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket open timed out')), 5000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('websocket error'));
      },
      { once: true },
    );
  });
  const session = new CdpSession(socket);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return { session, target: page, webViewRect };
}

function forwardWebView(pid, port = CDP_PORT) {
  adb(['forward', '--remove-all']);
  adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
}

// ------------------------------------------------------------------------------------------ the runner

class Device {
  constructor(outDir) {
    this.out = outDir;
    this.session = null;
    this.info = null;
    this.origin = null;
    this.viewport = null;
    this.webViewRect = null;
    this.target = null;
    this.shots = [];
    // Console output and status lines are accumulated **across scenes**: each scene switch relaunches
    // the activity, so a per-session log would only ever see the last scene's errors.
    this.consoleLog = [];
    this.statusLog = [];
    mkdirSync(outDir, { recursive: true });
  }

  async boot() {
    await waitForBoot();
    this.info = deviceInfo();
    return this.info;
  }

  install() {
    return adb(['install', '-r', '-g', APK]).trim();
  }

  /**
   * Relaunches the app and makes sure `scene` is the one running.
   *
   * The launch intent's fragment never reaches the page (`am start -d …#/states` still boots `m0`), so
   * the scene is selected the way a user would: set `location.hash`; the app reloads on `hashchange`.
   */
  async open(scene, { timeoutMs = 120_000 } = {}) {
    stage(`open(${scene}): force-stop + start`);
    shell(`am force-stop ${APP_ID}`);
    await sleep(400);
    shell(`am start -n ${APP_ID}/.MainActivity -a android.intent.action.VIEW`);
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    let attached = false;
    while (Date.now() < deadline) {
      try {
        if (!attached) {
          const pid = appPid();
          stage(`open(${scene}): pid=${pid ?? 'none'}`);
          if (pid) {
            forwardWebView(pid);
            stage(`open(${scene}): forwarding + attaching`);
            const { session, target, webViewRect } = await connectCdp();
            stage(`open(${scene}): attached`);
            this.webViewRect = webViewRect;
            this.target = target;
            session.consoleLog = this.consoleLog;
            this.session = session;
            attached = true;
          }
        }
        if (attached) {
          // The page exists before Phaser has booted; wait for the status block the scenes fill in.
          const state = await this.session
            .eval(
              `JSON.stringify({ready: Boolean(document.getElementById('status')?.textContent?.trim()) && Boolean(window.game), title: document.title, hash: location.hash})`,
            )
            .then(JSON.parse);
          stage(`open(${scene}): ready=${state.ready} hash=${state.hash} title=${state.title}`);
          if (state.ready) {
            if (!state.hash.includes(scene)) {
              await this.session.eval(`location.hash = ${JSON.stringify(`#/${scene}`)}`);
              await sleep(1500);
            } else if (!state.title.includes(scene)) {
              await sleep(500);
            }
            const settled = await this.session
              .eval(
                `JSON.stringify({ready: Boolean(document.getElementById('status')?.textContent?.trim()) && Boolean(window.game), title: document.title})`,
              )
              .then(JSON.parse);
            if (settled.ready && settled.title.includes(scene)) {
              this.viewport = await this.session
                .eval(
                  'JSON.stringify({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})',
                )
                .then(JSON.parse);
              const rect = await readWebViewRect();
              if (rect) {
                this.webViewRect = rect;
              }
              return this.session;
            }
          }
        }
      } catch (error) {
        lastError = error;
        attached = false;
        this.session?.socket.close();
        this.session = null;
      }
      await sleep(1200);
    }
    throw new Error(`app did not become ready on #/${scene}: ${lastError?.message ?? 'timeout'}`);
  }

  async eval(expression) {
    return this.session.eval(expression);
  }

  /** Reads the shared `#demo-state` line into an object of raw strings. */
  async demoState() {
    const text = await this.eval('document.getElementById("demo-state").textContent');
    const state = {};
    for (const token of String(text).trim().split(/\s+/)) {
      const index = token.indexOf('=');
      if (index > 0) {
        state[token.slice(0, index)] = token.slice(index + 1);
      }
    }
    return state;
  }

  async status() {
    return String(await this.eval('document.getElementById("status").textContent'));
  }

  /** Candidate WebView screen origins, best guess first. */
  originCandidates() {
    const candidates = [];
    const rect = this.webViewRect;
    if (rect) {
      candidates.push({
        left: rect.screenX,
        top: rect.screenY,
        source: 'webview target description',
      });
    }
    const frame = this.info?.frame;
    if (frame) {
      candidates.push({ left: frame.left, top: frame.top, source: 'dumpsys window mFrame' });
    }
    const stable = this.info?.insets?.stable;
    if (stable && stable.top > 0) {
      candidates.push({ left: 0, top: stable.top, source: 'mStableInsets.top' });
    }
    candidates.push({ left: 0, top: 0, source: 'screen origin' });
    return candidates;
  }

  toDevice(point, origin) {
    const dpr = this.viewport?.dpr ?? 1;
    return {
      x: origin.left + point.x * dpr,
      y: origin.top + point.y * dpr,
    };
  }

  tapDevice(x, y) {
    shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  }

  swipeDevice(x1, y1, x2, y2, ms = 320) {
    shell(
      `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${ms}`,
    );
  }

  /** Taps a control given in CSS page pixels, using the calibrated origin. */
  tapCss(point) {
    const origin = this.origin ?? this.originCandidates()[0];
    const device = this.toDevice(point, origin);
    this.tapDevice(device.x, device.y);
    return device;
  }

  swipeCss(from, to, ms = 320) {
    const origin = this.origin ?? this.originCandidates()[0];
    const a = this.toDevice(from, origin);
    const b = this.toDevice(to, origin);
    this.swipeDevice(a.x, a.y, b.x, b.y, ms);
    return { from: a, to: b };
  }

  shoot(name) {
    const path = join(this.out, `${name}.png`);
    writeFileSync(path, adb(['exec-out', 'screencap', '-p'], { binary: true }));
    this.shots.push(path);
    return path;
  }
}

/** A check result: `id`, `title`, `ok`, human-readable `detail`, and optional `data`. */
const result = (id, title, ok, detail, data = null) => ({ id, title, ok, detail, data });

/** `ok: null` = skipped (the device cannot answer this question), which is neither pass nor fail. */
const skipped = (id, title, reason, data = null) =>
  result(id, title, null, `SKIPPED: ${reason}`, data);

// ----------------------------------------------------------------------------------------- the checks

const checks = {
  async A1(device) {
    const status = await device.status();
    const renderer = /renderer=(\w+)/.exec(status)?.[1];
    const size = /size=([\d.]+)x([\d.]+)/.exec(status);
    const dpr = /dpr=([\d.]+)/.exec(status)?.[1];
    const errors = status.split('\n').filter((line) => /^(ERROR|REJECTION):/.test(line));
    // `Scale.RESIZE` hands the canvas the *fractional* CSS viewport (412.19×842.29 at DPR 2.625), so the
    // comparison is a tolerance, not equality.
    const ok =
      renderer === 'webgl' &&
      Boolean(size) &&
      Math.abs(Number(size[1]) - device.viewport.width) <= 1 &&
      Math.abs(Number(size[2]) - device.viewport.height) <= 1 &&
      errors.length === 0;
    return result(
      'A1',
      'App boots in the Android WebView (WebGL + RESIZE viewport, no page errors)',
      ok,
      `renderer=${renderer} statusSize=${size?.[0]?.replace('size=', '')} viewport=${
        device.viewport.width
      }x${device.viewport.height} dpr=${dpr} errors=${errors.length}`,
      { status, viewport: device.viewport, errors },
    );
  },

  async A2(device) {
    const state = await device.demoState();
    const point = /@(-?\d+),(-?\d+)/.exec(state['pt.button.default'] ?? '');
    if (!point) {
      return result('A2', 'Real touch activates a control', false, 'pt.button.default missing');
    }
    const target = { x: Number(point[1]), y: Number(point[2]) };
    await device.eval('window.states.clearEvents()');
    const before = await device.eval('window.states.state().clicks');

    const attempts = [];
    let landed = null;
    for (const origin of device.originCandidates()) {
      device.origin = origin;
      const devicePoint = device.tapCss(target);
      await sleep(500);
      const after = await device.eval('window.states.state().clicks');
      attempts.push({ origin: origin.source, devicePoint, clicks: after });
      if (after > before) {
        landed = origin;
        break;
      }
    }

    const events = await device.eval('JSON.stringify(window.states.events())').then(JSON.parse);
    const pointers = await device
      .eval(
        `JSON.stringify((() => {
          const input = window.game?.input ?? null;
          const list = input?.pointers ?? input?.manager?.pointers ?? [];
          return list.map((p) => ({ id: p.id, wasTouch: p.wasTouch, active: p.active }));
        })())`,
      )
      .then(JSON.parse);
    const activation = events.activated.find((entry) => entry.name === 'button.default');
    const ok = Boolean(landed) && activation?.source === 'touch';
    return result(
      'A2',
      'Real touch (`adb shell input tap` → MotionEvent) activates a control',
      ok,
      `css=@${target.x},${target.y} origin=${landed?.source ?? 'none'} clicks=${
        attempts.at(-1)?.clicks
      } activation=${activation ? `${activation.name}/${activation.source ?? 'n/a'}` : 'none'} wasTouch=${pointers
        .map((p) => p.wasTouch)
        .join(',')}`,
      { attempts, events, pointers },
    );
  },

  async A3(device) {
    const viewport = await device
      .eval('JSON.stringify(window.listDemo.viewport())')
      .then(JSON.parse);
    const offsetBefore = await device.eval('window.listDemo.offset()');
    const createdBefore = await device.eval('window.listDemo.created()');
    // Mounted rows, read from the one probe that answers it (`counts()` has no `rendered` field; the
    // `#demo-state` line does, and this hard read is what the "virtualisation stays bounded" claim needs).
    const renderedBefore = await device.eval('window.listDemo.renderedKeys().length');
    const stateBefore = await device.demoState();
    const keys = await device
      .eval('JSON.stringify(window.listDemo.visibleKeys())')
      .then(JSON.parse);
    const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
    const drag = device.swipeCss(centre, { x: centre.x, y: centre.y - 280 }, 320);
    await sleep(700);
    const offsetAfter = await device.eval('window.listDemo.offset()');
    const createdAfter = await device.eval('window.listDemo.created()');
    const renderedAfter = await device.eval('window.listDemo.renderedKeys().length');
    const stateAfter = await device.demoState();
    const owners = await device
      .eval('JSON.stringify(window.listDemo.owners?.() ?? null)')
      .then((text) => JSON.parse(text));
    const total = Number(stateAfter.total ?? 0);
    const ok =
      offsetAfter > offsetBefore &&
      createdAfter > createdBefore &&
      renderedAfter <= total / 4 &&
      renderedAfter < total;
    return result(
      'A3',
      'Real drag scrolls a `ScrollView`; `Repeat` builds rows lazily and keeps only a window mounted',
      ok,
      `offset ${offsetBefore} → ${offsetAfter}; created ${createdBefore} → ${createdAfter}; mounted rows ${renderedBefore} → ${renderedAfter} of ${total}; visibleKeys=${keys.length}`,
      {
        viewport,
        drag,
        offsetBefore,
        offsetAfter,
        createdBefore,
        createdAfter,
        renderedBefore,
        renderedAfter,
        total,
        owners,
      },
    );
  },

  async A4(device) {
    const info = device.info;
    const viewport = device.viewport;
    const rect = device.webViewRect;
    const safe = await device.eval('JSON.stringify(window.config.safeArea())').then(JSON.parse);
    const status = await device.status();
    const canvasLine = /canvas=@([\d.-]+),([\d.-]+) ([\d.]+)x([\d.]+)/.exec(status);
    const expectedDpr = (info.density ?? 160) / 160;
    // The target description reports the WebView's own device-pixel box: the CSS viewport scaled by the
    // DPR has to land on it, otherwise every coordinate conversion below would be off.
    const frameMatch = rect
      ? Math.abs(viewport.width * viewport.dpr - rect.width) <= 2 &&
        Math.abs(viewport.height * viewport.dpr - rect.height) <= 2
      : null;
    const ok = Math.abs(viewport.dpr - expectedDpr) < 0.02 && frameMatch !== false;

    return result(
      'A4',
      'Device shape: DPR = density/160 and the CSS viewport scales onto the WebView box',
      ok,
      `dpr=${viewport.dpr} (density ${info.density} → ${expectedDpr}); css ${viewport.width}x${
        viewport.height
      }; webview box=${
        rect ? `${rect.width}x${rect.height} @screen ${rect.screenX},${rect.screenY}` : 'n/a'
      }; canvas=${canvasLine?.[0] ?? 'n/a'}; safeArea=${JSON.stringify(safe.reserved)}`,
      { info, viewport, webViewRect: rect, safe, canvas: canvasLine?.[0] ?? null },
    );
  },

  async A5(device) {
    const imeBefore = imeState();
    const field = 'JSON.stringify(window.form.rect("name"))';
    const before = await device
      .eval(
        'JSON.stringify({value: window.form.values().name, focus: window.form.focus(), vv: visualViewport ? {height: Math.round(visualViewport.height), top: Math.round(visualViewport.pageTop)} : null, inner: innerHeight})',
      )
      .then(JSON.parse);
    const rect = await device.eval(field).then(JSON.parse);
    if (!rect) {
      return result('A5', 'Soft keyboard path', false, 'form.rect("name") was null');
    }
    device.tapCss({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    await sleep(1200);
    const focused = await device.eval('window.form.focus()');
    const imeOpen = imeState();
    const duringIme = await device
      .eval(
        'JSON.stringify({vv: visualViewport ? {height: Math.round(visualViewport.height), top: Math.round(visualViewport.pageTop)} : null, inner: innerHeight, ime: document.activeElement?.tagName})',
      )
      .then(JSON.parse);
    device.shoot('A5-ime-open');
    shell('input text "android"');
    await sleep(900);
    const typed = await device.eval('JSON.stringify(window.form.values())').then(JSON.parse);
    const after = await device
      .eval(
        'JSON.stringify({focus: window.form.focus(), vv: visualViewport ? {height: Math.round(visualViewport.height)} : null, inner: innerHeight})',
      )
      .then(JSON.parse);
    // A tapped, bridged field must raise the real system keyboard — that was the one M5 acceptance item
    // the repository always listed as "只能在真机上验" (`ACCEPTANCE-form.md`, `ACCEPTANCE-mobile.md` §4).
    const imeRaised = imeOpen.inputShown === null ? null : imeOpen.inputShown === 'true';
    const ok =
      focused === 'name' && typed.name.includes('android') && (imeRaised === null || imeRaised);
    return result(
      'A5',
      'Soft-keyboard path: tap focuses the DOM-bridged field, the system IME appears and types into it',
      ok,
      `focus=${focused}; value="${typed.name}"; ime inputShown ${imeBefore.inputShown} → ${
        imeOpen.inputShown
      } (view ${imeOpen.viewShown}); visualViewport ${before.vv?.height} → ${duringIme.vv?.height} (innerHeight ${before.inner} → ${duringIme.inner}); activeElement=${duringIme.ime}`,
      { rect, before, duringIme, after, typed, imeBefore, imeOpen, imeRaised },
    );
  },

  async A6(device) {
    const expected = readAxExpectations('AX_EXPECTATIONS', 'a11y');
    const structure = readAxExpectations('AX_STRUCTURE_EXPECTATIONS', 'a11y');
    const controlRoles = readAxControlRoles();
    const problems = [];

    const setup = readSceneSetup('a11y');
    if (setup) {
      await device.eval(`(async () => { ${setup}; return true; })()`);
      await sleep(300);
    }

    // A real Android key event, not a CDP one: `Tab` has to move framework focus *and* leave exactly one
    // control node reporting focus (the mirror node takes DOM focus so a screen reader can follow).
    shell('input keyevent 61');
    await sleep(400);

    let tree;
    try {
      await device.session.send('Accessibility.enable');
      tree = await device.session.send('Accessibility.getFullAXTree');
    } catch (error) {
      return skipped(
        'A6',
        'Accessibility tree inside the Android WebView',
        `the WebView DevTools build has no Accessibility domain: ${error.message}`,
      );
    }

    const visible = tree.nodes.filter((node) => !node.ignored);
    const controls = visible.filter((node) => controlRoles.has(node.role?.value));

    for (const want of expected) {
      const matches = controls.filter(
        (node) => node.role?.value === want.role && (node.name?.value ?? '') === want.name,
      );
      if (matches.length !== 1) {
        problems.push(`"${want.name}" (${want.role}): ${matches.length} node(s), expected 1`);
        continue;
      }
      const node = matches[0];
      if (want.value !== undefined && String(node.value?.value ?? '') !== want.value) {
        problems.push(`"${want.name}": value "${node.value?.value}", expected "${want.value}"`);
      }
      for (const [name, value] of Object.entries(want.properties)) {
        const actual = axProperty(node, name);
        if (actual !== value) {
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

    // Containment, not just membership: the region really holds its six buttons, and the labelled
    // container really owns the two bridged `<input>` elements (`aria-owns`).
    for (const want of structure) {
      const matches = visible.filter(
        (node) => node.role?.value === want.role && (node.name?.value ?? '') === want.name,
      );
      if (matches.length !== 1) {
        problems.push(`structure "${want.name}": ${matches.length} node(s), expected 1`);
        continue;
      }
      const inside = axDescendants(tree.nodes, matches[0]);
      const counts = {};
      for (const child of inside) {
        counts[child.role?.value] = (counts[child.role?.value] ?? 0) + 1;
      }
      for (const [role, count] of Object.entries(want.descendants)) {
        if ((counts[role] ?? 0) !== count) {
          problems.push(
            `structure "${want.name}" holds ${counts[role] ?? 0} ${role}, expected ${count}`,
          );
        }
      }
    }

    const focused = controls.filter((node) => axProperty(node, 'focused') === 'true');
    if (focused.length !== 1) {
      problems.push(
        `after a real Tab key, ${focused.length} control node(s) report focus, expected 1`,
      );
    }

    const names = controls.map((node) => `${node.role?.value}:${node.name?.value ?? ''}`);
    return result(
      'A6',
      'Accessibility tree in the Android WebView matches the desktop gate (membership, properties, containment, Tab focus)',
      problems.length === 0,
      problems.length === 0
        ? `${controls.length} control node(s) exactly as promised; ${structure.length} containment rule(s); focused=${focused
            .map((node) => node.name?.value)
            .join(',')}`
        : problems.join(' | '),
      { names, total: tree.nodes.length, problems, expectedCount: expected.length, setup },
    );
  },

  /**
   * Pixel evidence, on the device framebuffer.
   *
   * The desktop gate's universal check is "the canvas is the *camera* background, not the page
   * background" — `index.html` deliberately uses `#05070a` behind the canvas so a surface that never
   * painted is distinguishable from one that did. The same two colours are checked here, plus a theme
   * token that only appears after a real draw (`slider` fill = `primary`).
   */
  async A9(device) {
    const shot = device.shoot('A9-states-pixels');
    const rect = device.webViewRect;
    if (!rect) {
      return skipped('A9', 'Device-framebuffer pixel evidence', 'the WebView box is unknown');
    }
    const dpr = device.viewport.dpr;
    const geometry = await device.eval('JSON.stringify(window.states.geometry())').then(JSON.parse);
    const state = await device.demoState();
    const size = geometry.probes['slider.volume'];
    const centre = /@(-?\d+),(-?\d+)/.exec(state['pt.slider.volume'] ?? '');
    if (!size || !centre) {
      return skipped('A9', 'Device-framebuffer pixel evidence', 'slider probes missing');
    }
    // `pt.*` is the widget centre; the filled part of the track ends at `value / max`, so a point at 20 %
    // of the width is inside `primary` for any value above 20.
    const left = Number(centre[1]) - size[0] / 2;
    const top = Number(centre[2]) - size[1] / 2;
    const fillCss = { x: left + size[0] * 0.2, y: top + size[1] / 2 };
    // `toDevice()` takes an `{left, top}` origin; the target description names the same pair
    // `screenX`/`screenY`, so map it explicitly instead of relying on the property names matching.
    const origin = { left: rect.screenX, top: rect.screenY };
    const points = [
      { label: 'canvas.clear', x: rect.screenX + 6, y: rect.screenY + 6, radius: 2 },
      { label: 'slider.fill', ...device.toDevice(fillCss, origin), radius: 3 },
    ];
    const readings = samplePixels(shot, points);
    const expectations = {
      'canvas.clear': {
        rgb: rgbOf(0x0d1117),
        note: 'camera background (a blank canvas would read #05070a)',
      },
      'slider.fill': { rgb: rgbOf(0x2f6feb), note: '`primary` token, painted by the slider' },
    };
    const problems = readings
      .filter((reading) => !closeEnough(reading.rgb, expectations[reading.label].rgb))
      .map(
        (reading) =>
          `${reading.label} at (${reading.x},${reading.y}) is #${reading.rgb
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')}, expected #${expectations[reading.label].rgb
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')} — ${expectations[reading.label].note}`,
      );
    return result(
      'A9',
      'Device framebuffer: the canvas painted (camera background) and a theme token is on screen',
      problems.length === 0,
      problems.length === 0
        ? readings
            .map(
              (reading) =>
                `${reading.label}=#${reading.rgb
                  .map((channel) => channel.toString(16).padStart(2, '0'))
                  .join('')}@(${reading.x},${reading.y})`,
            )
            .join(' ')
        : problems.join(' | '),
      { readings, expectations, shot, fillCss },
    );
  },

  async A7(device) {
    device.shoot('A7-before-churn');
    const samples = await device.eval('window.lifecycle.churn(5)');
    const tracked = [
      'themeListeners',
      'displayList',
      'sceneObjects',
      'focusables',
      'pointerTargets',
      'textures',
      'tweens',
      'timers',
      'widgets',
      'frameListeners',
    ];
    const first = samples[0];
    const drifted = tracked.filter((key) => samples.some((sample) => sample[key] !== first[key]));
    const pages = await device.eval('JSON.stringify(window.lifecycle.pages())').then(JSON.parse);
    const alive = pages.filter((page) => !page.destroyed).length;
    const ok = drifted.length === 0 && alive === 1;
    return result(
      'A7',
      'Leak gate: 5 scene restarts keep all ten counters flat and leave exactly one page alive',
      ok,
      `drifted=[${drifted.join(',')}] alivePages=${alive} rounds=${samples.length} sample=${JSON.stringify(first)}`,
      { samples, pages },
    );
  },

  async A8(device) {
    const statuses = [...device.statusLog, await device.status()];
    const pageErrors = statuses
      .flatMap((text) => text.split('\n'))
      .filter((line) => /^(ERROR|REJECTION):/.test(line));
    const consoleErrors = device.consoleLog.filter((entry) => entry.type === 'error');
    const unknownOptions = device.consoleLog.filter((entry) =>
      entry.text.includes('unknown option'),
    );
    const ok = pageErrors.length === 0 && consoleErrors.length === 0 && unknownOptions.length === 0;
    return result(
      'A8',
      'No page error, no console error and no unknown-option warning across every scene visited',
      ok,
      `scenes=${statuses.length} pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length} unknownOptions=${unknownOptions.length}`,
      { pageErrors, consoleErrors: consoleErrors.slice(0, 5), unknownOptions },
    );
  },
};

/** Scene each check runs on: the checks read scene-specific probes, so they are placed deliberately. */
const SCENE_OF = {
  A1: 'showcase',
  A9: 'states',
  A2: 'states',
  A3: 'list',
  A4: 'config',
  A5: 'form',
  A6: 'a11y',
  A7: 'lifecycle',
  A8: 'showcase',
};

// ----------------------------------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const outDir = flag('out', join(ROOT, '.tmp/android/out'));

if (command === 'device-info') {
  await waitForBoot();
  console.log(JSON.stringify(deviceInfo(), null, 2));
} else if (command === 'install') {
  const device = new Device(outDir);
  stage('install: waiting for boot');
  await device.boot();
  stage('install: adb install');
  console.log(device.install());
  stage('install: installed');
  if (flag('scene')) {
    await device.open(flag('scene'));
    console.log(await device.status());
  }
} else if (command === 'verify') {
  const only = (flag('only') ?? 'A1,A9,A2,A3,A4,A5,A6,A7,A8')
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter((id) => checks[id]);
  const device = new Device(outDir);
  const info = await device.boot();
  console.log('device:', JSON.stringify(info));
  const results = [];
  let currentScene = null;
  for (const id of only) {
    const scene = SCENE_OF[id];
    try {
      if (scene !== currentScene) {
        await device.open(scene);
        currentScene = scene;
      }
      const outcome = await checks[id](device);
      results.push(outcome);
      const label = outcome.ok === null ? 'skip' : outcome.ok ? 'ok  ' : 'FAIL';
      console.log(`${label} ${outcome.id} [${scene}] ${outcome.detail}`);
      device.statusLog.push(await device.status());
      if (id !== 'A5') {
        device.shoot(`${id}-${scene}`);
      }
    } catch (error) {
      // A spawned tool's failure is in its stderr; without it the crash line is useless.
      const detail = [
        error?.message,
        String(error?.stderr ?? '')
          .trim()
          .slice(0, 400),
      ]
        .filter(Boolean)
        .join(' | ');
      results.push(result(id, `${id} crashed`, false, detail));
      console.log(`FAIL ${id} [${scene}] crashed: ${detail}`);
    }
  }
  const report = {
    device: info,
    viewport: device.viewport,
    origin: device.origin,
    results,
    shots: device.shots,
    consoleLog: device.session?.consoleLog ?? [],
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const failed = results.filter((entry) => entry.ok === false);
  const passed = results.filter((entry) => entry.ok === true).length;
  const skippedCount = results.filter((entry) => entry.ok === null).length;
  console.log(
    `\n${passed}/${results.length} check(s) passed${
      skippedCount ? `, ${skippedCount} skipped` : ''
    }${
      failed.length
        ? `, ${failed.length} FAILED: ${failed.map((entry) => entry.id).join(', ')}`
        : ''
    }; report: ${join(outDir, 'report.json')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
} else if (command === 'ax-tables') {
  console.log(
    JSON.stringify(
      {
        roles: [...readAxControlRoles()],
        a11y: readAxExpectations('AX_EXPECTATIONS', 'a11y'),
        structure: readAxExpectations('AX_STRUCTURE_EXPECTATIONS', 'a11y'),
        keyboardCount: readAxExpectations('AX_EXPECTATIONS', 'keyboard').length,
        setups: { a11y: readSceneSetup('a11y'), showcase: readSceneSetup('showcase') },
      },
      null,
      2,
    ),
  );
} else if (command === 'screenshot') {
  const device = new Device(outDir);
  await device.boot();
  const name = flag('name', 'shot');
  writeFileSync(
    join(outDir, `${name}.png`),
    adb(['exec-out', 'screencap', '-p'], { binary: true }),
  );
  console.log(join(outDir, `${name}.png`));
} else {
  console.log(
    'usage: android-check.mjs <device-info|install|verify|screenshot|ax-tables> [--scene name] [--only A1,A2]',
  );
}

// The DevTools WebSocket keeps the event loop alive; without this the script would hang after the work.
process.exit(0);
