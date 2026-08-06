import { SupportedLanguages } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { typeConfig as rubyTypeConfig } from '../type-extractors/ruby.js';
import { createImportResolver } from '../import-resolvers/resolver-factory.js';
import { rubyImportConfig } from '../import-resolvers/configs/ruby.js';
import { LUA_SCOPE_QUERY } from './lua/query.js';
import { emitLuaScopeCaptures, interpretLuaTypeBinding } from './lua/captures.js';
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
  typeConfig: rubyTypeConfig,
  exportChecker: (_node, name) => !name.startsWith('_'),
  importResolver: createImportResolver(rubyImportConfig),
  emitScopeCaptures: emitLuaScopeCaptures,
  interpretImport: interpretLuaImport,
  interpretTypeBinding: interpretLuaTypeBinding,
  bindingScopeFor: luaBindingScopeFor,
  importOwningScope: luaImportOwningScope,
  arityCompatibility: luaArityCompatibility,
  builtInNames: new Set(['require', 'pairs', 'ipairs', 'print', 'type', 'error', 'assert']),
});
