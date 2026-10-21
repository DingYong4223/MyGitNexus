import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPipelineFromRepo } from './helpers.js';
import { getNodesByLabel, getRelationships, writeFixtureRepo } from './helpers.js';
import {
  loadParseCache,
  saveParseCache,
  PARSE_CACHE_VERSION,
} from '../../../src/storage/parse-cache.js';
import {
  getDurableParsedFileDir,
  pruneAndSaveDurableParsedFileStore,
} from '../../../src/storage/parsedfile-store.js';

describe('Lua basic symbol resolution', () => {
  const roots: string[] = [];
  const fixtureRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-lua-'));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps closures, table owners, colon calls and private bindings distinct', async () => {
    const root = fixtureRoot();
    writeFixtureRepo(root, {
      'mod.lua': `local M = {}
local function private() end
function M:save() private() end
return M`,
      'main.lua': `local Alias = require("mod")
local function target() end
local function invoke(cb) cb() end
local assigned = function() target() end
local multiline =
  function() target() end
local Indexed = {}
Indexed["keyed"] = function() target() end
local function indexedCaller() Indexed["keyed"]() Indexed[unknown]() multiline() end
local A = { save = function() target() end }
local B = {}
B.save = function() end
function B:run() self:save() end
function B.dot() self:save() end
local function setup() invoke(function() target() end) end
local function runAll() assigned() A.save() B:save() Alias:save() end
local function illegal() private() end
local function scoped() end
do
  local function scoped() target() end
  scoped()
end
scoped()
return { run = runAll }`,
    });
    const result = await runPipelineFromRepo(root, () => {});
    const nodes = [...result.graph.iterNodes()].filter((n) =>
      ['Function', 'Method'].includes(n.label),
    );
    expect(nodes.some((n) => n.properties.name === 'assigned' && n.label === 'Function')).toBe(
      true,
    );
    expect(nodes.filter((n) => n.properties.name === 'save')).toHaveLength(3);
    expect(nodes.filter((n) => n.properties.name === 'scoped')).toHaveLength(2);
    const calls = getRelationships(result, 'CALLS');
    const targets = (source: string) =>
      calls.filter((e) => e.source === source).map((e) => e.target);
    expect(targets('assigned')).toContain('target');
    expect(targets('multiline')).toEqual(['target']);
    expect(targets('indexedCaller').sort()).toEqual(['keyed', 'multiline']);
    expect(targets('keyed')).toEqual(['target']);
    expect(targets('runAll')).toContain('assigned');
    expect(calls.filter((e) => e.source === 'runAll' && e.target === 'save')).toHaveLength(3);
    expect(
      calls
        .filter((e) => e.source === 'runAll' && e.target === 'save')
        .map((e) =>
          result.graph.getNode(e.rel.targetId)?.properties.qualifiedName?.replace(/@\d+:\d+$/, ''),
        )
        .sort(),
    ).toEqual(['A.save', 'B.save', 'M.save']);
    expect(targets('run')).toEqual(['save']);
    expect(targets('dot')).toEqual([]);
    expect(targets('runAll')).not.toContain('B');
    expect(targets('illegal')).not.toContain('private');
    expect(targets('setup')).not.toContain('target');
    const callback = nodes.find((n) => n.properties.name.startsWith('fn@'));
    expect(callback).toBeDefined();
    expect(calls.some((e) => e.source === callback?.properties.name && e.target === 'target')).toBe(
      true,
    );
    expect(targets('invoke')).toContain(callback?.properties.name);
    expect(targets('runAll')).not.toContain('target');
    expect(targets('runAll')).not.toContain('private');
    const scoped = nodes.filter((n) => n.properties.name === 'scoped');
    for (const node of scoped) {
      expect(calls.some((e) => e.rel.targetId === node.id)).toBe(true);
    }
  }, 60000);

  it('resolves explicit exports and scoped aliases identically on a warm cache', async () => {
    const root = fixtureRoot();
    writeFixtureRepo(root, {
      'mod.lua': `local M = {}
local function hidden() end
local function helper() end
M.forward = helper
function M.save() end
local function nested() local M = {}; function M.save() end end
return M`,
      'literal.lua': `local function helper() end
return {forward = helper, run = function() end}`,
      'global.lua': 'function globalAction() end',
      'main.lua': `local Alias = require("mod")
local Literal = require("literal")
local function good() Alias.save() Alias.forward() Literal.forward() Literal.run() globalAction() end
local function bad() Alias.hidden() hidden() end
local function shadow(Alias) Alias.save() end
local function own() local Inner = require("literal"); Inner.run() end
local function outside() Inner.run() end
return {run = good}`,
    });
    const storagePath = path.join(root, '.gitnexus');
    const cache = await loadParseCache(storagePath);
    const cold = await runPipelineFromRepo(root, () => {}, { parseCache: cache });
    const keys = await saveParseCache(storagePath, cache);
    await pruneAndSaveDurableParsedFileStore(
      getDurableParsedFileDir(storagePath),
      PARSE_CACHE_VERSION,
      new Set(keys),
    );
    const progress: string[] = [];
    const warm = await runPipelineFromRepo(root, (p) => progress.push(p.message), {
      parseCache: await loadParseCache(storagePath),
    });
    expect(progress.some((message) => message.includes('(cache)'))).toBe(true);
    const edges = (result: typeof cold) =>
      getRelationships(result, 'CALLS')
        .map((e) => `${e.rel.sourceId} -> ${e.rel.targetId}`)
        .sort();
    expect(edges(warm)).toEqual(edges(cold));
    const calls = getRelationships(warm, 'CALLS');
    expect(
      calls
        .filter((e) => e.source === 'good')
        .map((e) => `${e.targetFilePath}:${e.target}`)
        .sort(),
    ).toEqual([
      'global.lua:globalAction',
      'literal.lua:helper',
      'literal.lua:run',
      'mod.lua:helper',
      'mod.lua:save',
    ]);
    expect(calls.filter((e) => ['bad', 'shadow', 'outside'].includes(e.source))).toEqual([]);
    expect(calls.filter((e) => e.source === 'own').map((e) => e.target)).toEqual(['run']);
  }, 60000);

  it('indexes functions, methods, require imports and static calls', async () => {
    const root = fixtureRoot();
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
