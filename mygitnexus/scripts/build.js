#!/usr/bin/env node
/**
 * Build script that compiles mygitnexus and inlines mygitnexus-shared into the dist.
 *
 * Steps:
 *  1. Build mygitnexus-shared (tsc)
 *  2. Build mygitnexus (tsc)
 *  3. Copy mygitnexus-shared/dist → dist/_shared
 *  4. Rewrite bare 'mygitnexus-shared' specifiers → relative paths
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHARED_ROOT = path.resolve(ROOT, '..', 'mygitnexus-shared');
const DIST = path.join(ROOT, 'dist');
const SHARED_DEST = path.join(DIST, '_shared');
const DEFAULT_BUILD_TIMEOUT_MS = 300_000;

function getBuildTimeoutMs() {
  const raw = process.env.MYGITNEXUS_BUILD_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BUILD_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  console.warn(
    `[build] ignoring invalid MYGITNEXUS_BUILD_TIMEOUT_MS=${JSON.stringify(raw)}; using ${DEFAULT_BUILD_TIMEOUT_MS}ms`,
  );
  return DEFAULT_BUILD_TIMEOUT_MS;
}

const BUILD_TIMEOUT_MS = getBuildTimeoutMs();

// Published-package guard: when installed from the npm registry the
// monorepo sibling `mygitnexus-shared` does not exist and `dist/` is
// already pre-built. Skip the build to avoid a misleading ENOENT
// crash (#1795).
if (!fs.existsSync(SHARED_ROOT)) {
  if (fs.existsSync(DIST)) {
    console.log('[build] skipping — dist/ already present (published package).');
    process.exit(0);
  }
  console.error(
    `[build] mygitnexus-shared not found at ${SHARED_ROOT} and no dist/ exists.\n` +
      'Are you running from the monorepo checkout? Run `npm install` from the repo root first.',
  );
  process.exit(1);
}

// ── 1. Build mygitnexus-shared ───────────────────────────────────────
console.log('[build] compiling mygitnexus-shared…');
const tscCmd =
  process.platform === 'win32'
    ? path.join('node_modules', '.bin', 'tsc.cmd')
    : path.join('node_modules', '.bin', 'tsc');
execSync(tscCmd, { cwd: SHARED_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

// ── 2. Build mygitnexus ──────────────────────────────────────────────
console.log('[build] compiling mygitnexus…');
execSync(tscCmd, { cwd: ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

// ── 3. Copy shared dist ────────────────────────────────────────────
console.log('[build] copying shared module into dist/_shared…');
fs.cpSync(path.join(SHARED_ROOT, 'dist'), SHARED_DEST, { recursive: true });

// ── 4. Rewrite imports ─────────────────────────────────────────────
console.log('[build] rewriting mygitnexus-shared imports…');
let rewritten = 0;

function rewriteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('mygitnexus-shared')) return;

  const relDir = path.relative(path.dirname(filePath), SHARED_DEST);
  // Always use posix separators and point to the package index
  const relImport = relDir.split(path.sep).join('/') + '/index.js';

  const updated = content
    .replace(/from\s+['"]mygitnexus-shared['"]/g, `from '${relImport}'`)
    .replace(/import\(\s*['"]mygitnexus-shared['"]\s*\)/g, `import('${relImport}')`);

  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    rewritten++;
  }
}

function walk(dir, extensions, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, cb);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      cb(full);
    }
  }
}

walk(DIST, ['.js', '.d.ts'], rewriteFile);

// ── 5. Make CLI entry executable ────────────────────────────────────
const cliEntry = path.join(DIST, 'cli', 'index.js');
if (fs.existsSync(cliEntry)) fs.chmodSync(cliEntry, 0o755);

// ── 6. Build & copy web UI ──────────────────────────────────────────
const WEB_ROOT = path.resolve(ROOT, '..', 'mygitnexus-web');
const WEB_DEST = path.join(DIST, '..', 'web');

if (fs.existsSync(path.join(WEB_ROOT, 'package.json'))) {
  console.log('[build] building mygitnexus-web…');
  if (!fs.existsSync(path.join(WEB_ROOT, 'node_modules'))) {
    console.log('[build] installing mygitnexus-web dependencies…');
    execSync('npm ci', { cwd: WEB_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });
  }
  execSync('npm run build', { cwd: WEB_ROOT, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS });

  // Copy dist → mygitnexus/web/ (shipped in the npm package)
  fs.rmSync(WEB_DEST, { recursive: true, force: true });
  fs.cpSync(path.join(WEB_ROOT, 'dist'), WEB_DEST, { recursive: true });
  console.log('[build] copied web UI → mygitnexus/web/');
} else {
  console.log('[build] skipping web UI (mygitnexus-web not found)');
}

console.log(`[build] done — rewrote ${rewritten} files.`);
