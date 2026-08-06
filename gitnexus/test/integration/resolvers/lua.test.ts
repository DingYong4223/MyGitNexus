import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPipelineFromRepo } from './helpers.js';
import { getNodesByLabel, getRelationships, writeFixtureRepo } from './helpers.js';

describe('Lua basic symbol resolution', () => {
  it('indexes functions, methods, require imports and static calls', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-lua-'));
    writeFixtureRepo(root, {
      'pkg/mod.lua': 'local M = {}\nfunction M.foo() end\nreturn M\n',
      'pkg/init.lua': 'local M = {}\nfunction M.init() end\nreturn M\n',
      'main.lua':
        'local mod = require("pkg.mod")\nlocal pkg = require("pkg")\nlocal missing = require("missing.module")\nfunction run() mod.foo() end\n',
    });
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    const result = await runPipelineFromRepo(root, () => {});
    expect(getNodesByLabel(result, 'Function')).toContain('run');
    expect(getNodesByLabel(result, 'Method')).toContain('foo');
    expect(getRelationships(result, 'IMPORTS').length).toBe(2);
    expect(
      getRelationships(result, 'CALLS').some((e) => e.source === 'run' && e.target === 'foo'),
    ).toBe(true);
  }, 60000);
});
