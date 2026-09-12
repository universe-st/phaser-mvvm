#!/usr/bin/env node
/**
 * Visual + DOM check for `apps/examples`.
 *
 * Builds the example app, serves the production bundle with `vite preview`, then for every scene
 * hash:
 *   1. captures a PNG with headless Chrome (`--screenshot`),
 *   2. dumps the DOM so the `#status` block (real geometry reported by the scenes) can be asserted.
 *
 * Usage:
 *   node scripts/visual-check.mjs                 # builds, serves, checks m0 + probe
 *   node scripts/visual-check.mjs --no-build      # reuse an existing dist/
 *   node scripts/visual-check.mjs --port 4174
 *
 * Exit code is non-zero if a scene reports an ERROR/REJECTION line or Chrome fails.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'apps', 'examples');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(name);

const port = Number(flag('--port', '4173'));
const outDir = resolve(root, flag('--out', '.tmp/visual-check'));
const size = flag('--size', '1280x720');
const scenes = ['m0', 'probe'];

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

function run(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', rejectPromise);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code}`)),
    );
  });
}

function chrome(args_, { capture = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chromePath(), args_, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        rejectPromise(new Error(`chrome exited with ${code}\n${stderr}`));
      }
    });
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`server did not become ready: ${url}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  if (!has('--no-build')) {
    await run('pnpm', ['--filter', '@phaser-mvvm/examples', 'run', 'build'], { cwd: root });
  }

  const preview = spawn(
    'pnpm',
    ['--filter', '@phaser-mvvm/examples', 'run', 'preview', '--', '--port', String(port)],
    { cwd: root, stdio: 'inherit' },
  );

  const base = `http://localhost:${port}`;
  let failures = 0;

  try {
    await waitForServer(`${base}/index.html`);

    for (const scene of scenes) {
      const url = `${base}/#/${scene}`;
      const png = join(outDir, `${scene}.png`);
      const dom = join(outDir, `${scene}.html`);

      await chrome([
        '--headless=new',
        '--hide-scrollbars',
        '--enable-unsafe-swiftshader',
        '--mute-audio',
        `--window-size=${size.replace('x', ',')}`,
        '--virtual-time-budget=6000',
        `--screenshot=${png}`,
        url,
      ]);
      console.log(`[visual-check] screenshot  ${png}`);

      const { stdout } = await chrome(
        [
          '--headless=new',
          '--enable-unsafe-swiftshader',
          '--virtual-time-budget=6000',
          '--dump-dom',
          url,
        ],
        { capture: true },
      );
      writeFileSync(dom, stdout);

      const statusMatch = /<pre id="status">([\s\S]*?)<\/pre>/.exec(stdout);
      const status = statusMatch
        ? statusMatch[1].replace(/&[a-z]+;/g, ' ').trim()
        : '(no status block)';
      console.log(`[visual-check] status for ${scene}:\n${status}\n`);

      if (/ERROR:|REJECTION:/.test(status) || status === '(no status block)') {
        failures++;
      }
    }
  } finally {
    preview.kill('SIGTERM');
  }

  if (failures > 0) {
    console.error(`[visual-check] ${failures} scene(s) reported errors`);
    process.exitCode = 1;
  } else {
    console.log('[visual-check] ok');
  }
}

main().catch((error) => {
  console.error('[visual-check] failed:', error);
  process.exitCode = 1;
});
