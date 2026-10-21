import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercises the `require.main === module` direct-exec entrypoint of the runner
// (#1945) end-to-end: the pure `buildRunnerArgv` is covered in
// resolve-invocation.test.ts, but the spawn + exit-code propagation + missing-
// runner diagnostic only live in the exec tail. We spawn a real child `node`
// against the canonical run.cjs with MYGITNEXUS_INVOCATION forcing a mode (so no
// live PATH probe) and a fake `mygitnexus` on PATH.
//
// The POSIX cases stage a shebang shell script; the Windows case below stages a
// `.cmd` shim to exercise the Windows-specific branch (shell:true so cmd.exe
// resolves `.cmd`/`.ps1` shims via PATHEXT). This file is registered in
// scripts/cross-platform-tests.ts (SPAWN_CLI) so the windows-latest CI job
// actually runs the Windows case; the POSIX cases self-skip there.
const CANONICAL_CJS = path.resolve(
  __dirname,
  '..',
  '..',
  'hooks',
  'claude',
  'resolve-analyze-cmd.cjs',
);
const onPosix = process.platform !== 'win32';

describe('run.cjs direct-exec entrypoint (#1945)', () => {
  it.skipIf(!onPosix)(
    'execs the resolved runner, passes args through, and propagates its exit code',
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gn-runner-'));
      const fake = path.join(dir, 'mygitnexus');
      // Fake global `mygitnexus` that echoes its argv and exits 42.
      writeFileSync(fake, '#!/bin/sh\necho "fake-mygitnexus $@"\nexit 42\n');
      chmodSync(fake, 0o755);

      const res = spawnSync(process.execPath, [CANONICAL_CJS, 'analyze', '--foo'], {
        env: {
          ...process.env,
          MYGITNEXUS_INVOCATION: 'mygitnexus',
          PATH: `${dir}:${process.env.PATH}`,
        },
        encoding: 'utf-8',
      });

      expect(res.status).toBe(42); // exit code propagated, not swallowed
      expect(res.stdout).toContain('fake-mygitnexus analyze --foo'); // args passthrough + inherited stdio
    },
  );

  it.skipIf(!onPosix)(
    'prints a diagnostic and exits 1 when the resolved runner is absent from PATH',
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gn-runner-empty-'));
      const res = spawnSync(process.execPath, [CANONICAL_CJS, 'analyze'], {
        // Force mygitnexus mode but give an empty PATH so the spawn ENOENTs.
        env: { ...process.env, MYGITNEXUS_INVOCATION: 'mygitnexus', PATH: dir },
        encoding: 'utf-8',
      });

      expect(res.status).toBe(1);
      expect(res.stderr).toContain('could not launch');
    },
  );

  it.skipIf(onPosix)(
    'resolves a .cmd shim via the Windows shell branch, passing args and exit code',
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gn-runner-win-'));
      const fake = path.join(dir, 'mygitnexus.cmd');
      // Fake global `mygitnexus` .cmd shim: echoes its argv and exits 42. The exec
      // tail's `shell: process.platform === 'win32'` routes through cmd.exe,
      // which resolves bare `mygitnexus` → `mygitnexus.cmd` via PATHEXT.
      writeFileSync(fake, '@echo off\r\necho fake-mygitnexus %*\r\nexit /b 42\r\n');

      const res = spawnSync(process.execPath, [CANONICAL_CJS, 'analyze', '--foo'], {
        env: {
          ...process.env,
          MYGITNEXUS_INVOCATION: 'mygitnexus',
          PATH: `${dir};${process.env.PATH}`,
        },
        encoding: 'utf-8',
      });

      expect(res.status).toBe(42); // exit code propagated through the shell
      expect(res.stdout).toContain('fake-mygitnexus analyze --foo'); // args passthrough
    },
  );
});
