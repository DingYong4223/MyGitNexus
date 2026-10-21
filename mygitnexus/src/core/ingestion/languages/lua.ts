import { SupportedLanguages } from 'mygitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { LUA_SCOPE_QUERY } from './lua/query.js';
import {
  collectLuaModuleFacts,
  emitLuaScopeCaptures,
  interpretLuaTypeBinding,
} from './lua/captures.js';
import { luaDefinitionIdentity, luaFunctionLabel } from './lua/syntax.js';
import { resolveLuaImportTarget } from './lua/import-target.js';
import { interpretLuaImport } from './lua/import-resolver.js';
import {
  luaArityCompatibility,
  luaBindingScopeFor,
  luaImportOwningScope,
} from './lua/simple-hooks.js';

export const luaProvider = defineLanguage({
  id: SupportedLanguages.Lua,
  extensions: ['.lua'],
  treeSitterQueries: LUA_SCOPE_QUERY,
  typeConfig: {
    declarationNodeTypes: new Set(),
    extractDeclaration: () => {},
    extractParameter: () => {},
  },
  exportChecker: (node) => {
    for (let current = node; current; current = current.parent) {
      if (current.type === 'local_function' || current.type === 'local_variable_declaration')
        return false;
    }
    return true;
  },
  importResolver: (raw, from, ctx) => {
    const target = resolveLuaImportTarget(raw, from, ctx.allFilePaths);
    return target ? { kind: 'files', files: [target] } : null;
  },
  definitionIdentity: luaDefinitionIdentity,
  labelOverride: (node) => luaFunctionLabel(node),
  collectCaptureSideChannel: collectLuaModuleFacts,
  emitScopeCaptures: emitLuaScopeCaptures,
  interpretImport: interpretLuaImport,
  interpretTypeBinding: interpretLuaTypeBinding,
  bindingScopeFor: luaBindingScopeFor,
  importOwningScope: luaImportOwningScope,
  arityCompatibility: luaArityCompatibility,
  builtInNames: new Set(['require', 'pairs', 'ipairs', 'print', 'type', 'error', 'assert']),
});
