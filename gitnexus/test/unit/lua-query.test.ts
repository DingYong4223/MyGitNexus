import { describe, expect, it } from 'vitest';
import { emitLuaScopeCaptures } from '../../src/core/ingestion/languages/lua/captures.js';
import { extractParsedFile } from '../../src/core/ingestion/scope-extractor-bridge.js';
import { luaProvider } from '../../src/core/ingestion/languages/lua.js';
import { getLuaParser } from '../../src/core/ingestion/languages/lua/query.js';

describe('Lua scope captures', () => {
  it.each([
    ['local f = function() end', ['f']],
    ['f = function() end', ['f']],
    ['local f, g = function() end, function() end', ['f', 'g']],
    ['f, g = function() end, function() end', ['f', 'g']],
    ['local M = {}; M["foo"] = function() end', ['M.foo']],
    ['local M = {}; M.foo = function() end', ['M.foo']],
    ['local M = {foo = function() end, ["bar"] = function() end}', ['M.foo', 'M.bar']],
    ['return {run = function() end}', ['$return.run']],
  ])('extracts callable definitions from %s', (source, names) => {
    const parsed = extractParsedFile(luaProvider, source, 'sample.lua')!;
    const definitions = parsed.localDefs.filter(
      (d) => d.type === 'Function' || d.type === 'Method',
    );
    expect(definitions.map((d) => d.qualifiedName?.replace(/@\d+:\d+$/, ''))).toEqual(names);
    expect(parsed.scopes.filter((s) => s.kind === 'Function')).toHaveLength(names.length);
  });

  it('records colon calls once with the method name and receiver', () => {
    const parsed = extractParsedFile(
      luaProvider,
      'function M:run() self:save() end\nM:run()',
      'sample.lua',
    )!;
    expect(
      parsed.referenceSites.map((s) => [s.name, s.callForm, s.explicitReceiver?.name]),
    ).toEqual([
      ['save', 'member', 'self'],
      ['run', 'member', 'M'],
    ]);
    expect(parsed.localDefs.filter((d) => d.type === 'Method')).toHaveLength(1);
  });

  it('keeps callback calls inside their own function scope', () => {
    const parsed = extractParsedFile(
      luaProvider,
      'local function setup() register(function() target() end) end',
      'sample.lua',
    )!;
    const register = parsed.referenceSites.find((s) => s.name === 'register')!;
    const target = parsed.referenceSites.find((s) => s.name === 'target')!;
    expect(target.inScope).not.toBe(register.inScope);
    expect(
      parsed.scopes.find((s) => s.id === target.inScope)?.ownedDefs[0]?.qualifiedName,
    ).toContain('.fn@');
  });

  it('resolves constant string keys and leaves dynamic keys unresolved', () => {
    const parsed = extractParsedFile(luaProvider, 'M["run"]()\nM[key]()', 'sample.lua')!;
    expect(parsed.referenceSites.map((s) => [s.name, s.explicitReceiver?.name])).toEqual([
      ['run', 'M'],
    ]);
  });

  it('retains require aliases and does not create a namespace for side-effect imports', () => {
    const parsed = extractParsedFile(
      luaProvider,
      'local Alias = require("pkg.mod")\nrequire "side.effect"',
      'sample.lua',
    )!;
    expect(parsed.parsedImports).toEqual([
      { kind: 'namespace', localName: 'Alias', importedName: 'pkg.mod', targetRaw: 'pkg.mod' },
      { kind: 'side-effect', targetRaw: 'side.effect' },
    ]);
  });

  it('gives sibling branches separate local bindings', () => {
    const parsed = extractParsedFile(
      luaProvider,
      'if ok then local function f() end f() else local function f() end f() end',
      'sample.lua',
    )!;
    const calls = parsed.referenceSites.filter((s) => s.name === 'f');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.inScope).not.toBe(calls[1]!.inScope);
    expect(parsed.scopes.find((s) => s.kind === 'Module')?.bindings.has('f')).toBe(false);
  });

  it('emits identical captures when reusing a parsed tree', () => {
    const source = 'local cb = function() work() end\ninvoke(cb)';
    const tree = getLuaParser().parse(source);
    expect(emitLuaScopeCaptures(source, 'sample.lua', tree)).toEqual(
      emitLuaScopeCaptures(source, 'sample.lua'),
    );
  });

  it('captures functions, methods, variables, imports and static calls', () => {
    const captures = emitLuaScopeCaptures(
      `
      local M = {}
      function f() end
      local function g() f() end
      function M.foo() end
      function M:bar() end
      local X = require("pkg.mod")
      f()
      M.foo()
      M:bar()
      M[name]()
    `,
      'sample.lua',
    );
    const tags = captures.flatMap((m) => Object.keys(m));
    expect(tags).toContain('@declaration.function');
    expect(tags).toContain('@definition.function');
    expect(tags).toContain('@declaration.method');
    expect(tags).toContain('@declaration.variable');
    expect(tags).toContain('@import.statement');
    expect(tags).toContain('@reference.call.free');
    expect(tags).toContain('@reference.call.member');
    expect(captures.filter((m) => m['@reference.call.index']).length).toBe(0);
  });
});
