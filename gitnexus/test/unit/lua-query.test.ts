import { describe, expect, it } from 'vitest';
import { emitLuaScopeCaptures } from '../../src/core/ingestion/languages/lua/captures.js';

describe('Lua scope captures', () => {
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
