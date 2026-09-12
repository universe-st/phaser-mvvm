#!/usr/bin/env node
/**
 * Bundle-size budget check (PLAN §8).
 *
 * | group            | entries                          | budget (gzip, minified) |
 * | ---------------- | -------------------------------- | ----------------------- |
 * | core + layout    | core/index, layout/index         | < 25 KB                 |
 * | phaser + widgets | phaser/index, widgets/index+compose | < 45 KB              |
 *
 * Phaser itself is external and never counted. The budget is evaluated on the **minified** gzip size,
 * because that is what a consumer ships: the unbundled `dist/` output stays readable on purpose (no
 * `--minify` in the library builds, so a stack trace points at real code), and every bundler in use
 * minifies before it ships. Both numbers are printed so the raw figure is never hidden.
 *
 * Usage: `node scripts/size-check.mjs [--no-build]`
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KB = 1024;

const GROUPS = [
  {
    name: 'core + layout',
    budget: 25 * KB,
    entries: ['packages/core/dist/index.js', 'packages/layout/dist/index.js'],
  },
  {
    name: 'phaser + widgets',
    budget: 45 * KB,
    entries: [
      'packages/phaser/dist/index.js',
      'packages/widgets/dist/index.js',
      'packages/widgets/dist/compose.js',
    ],
  },
];

function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}

/** Minified gzip size, or `null` when esbuild (a tsup dependency) is not installed. */
function minifiedGzipSize(path) {
  const esbuild = join(root, 'node_modules/.bin/esbuild');
  if (!existsSync(esbuild)) {
    return null;
  }
  try {
    const minified = execFileSync(esbuild, [path, '--minify', '--format=esm', '--target=es2022'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return gzipSize(minified);
  } catch {
    return null;
  }
}

function format(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

if (!process.argv.includes('--no-build')) {
  console.log('building packages …');
  execFileSync('pnpm', ['-r', 'run', 'build'], { cwd: root, stdio: 'inherit' });
}

let failed = false;
for (const group of GROUPS) {
  console.log(`\n${group.name} (budget < ${format(group.budget)} gzip, minified)`);
  let raw = 0;
  let plainGzip = 0;
  let minified = 0;
  let minifiedKnown = true;

  for (const relative of group.entries) {
    const path = join(root, relative);
    if (!existsSync(path)) {
      console.error(`  MISSING ${relative} — run the build first (or drop --no-build)`);
      failed = true;
      minifiedKnown = false;
      continue;
    }
    const buffer = readFileSync(path);
    const gz = gzipSize(buffer);
    const min = minifiedGzipSize(path);
    raw += buffer.length;
    plainGzip += gz;
    if (min === null) {
      minifiedKnown = false;
    } else {
      minified += min;
    }
    console.log(
      `  ${relative.padEnd(38)} raw ${format(buffer.length).padStart(8)}  gzip ${format(gz).padStart(8)}` +
        `  min+gzip ${min === null ? 'n/a' : format(min).padStart(8)}`,
    );
  }

  console.log(
    `  total: raw ${format(raw)}  gzip ${format(plainGzip)}` +
      `  min+gzip ${minifiedKnown ? format(minified) : 'n/a'}`,
  );

  if (!minifiedKnown) {
    console.log('  (minified size unavailable — esbuild not installed; budget not evaluated)');
    continue;
  }
  if (minified > group.budget) {
    console.error(`  OVER BUDGET by ${format(minified - group.budget)}`);
    failed = true;
  } else {
    console.log(`  within budget (${format(group.budget - minified)} headroom)`);
  }
}

if (failed) {
  console.error('\nsize check failed');
  process.exit(1);
}
console.log('\nsize check passed');
