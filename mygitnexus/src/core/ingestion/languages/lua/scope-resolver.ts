import type { BindingRef, ParsedFile } from 'mygitnexus-shared';
import { SupportedLanguages } from 'mygitnexus-shared';
import { buildMro, defaultLinearize } from '../../scope-resolution/passes/mro.js';
import { populateClassOwnedMembers } from '../../scope-resolution/scope/walkers.js';
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
import { luaProvider } from '../lua.js';
import { resolveLuaImportTarget } from './import-target.js';
import { luaArityCompatibility } from './simple-hooks.js';
import { resolveLuaReceiverMember } from './member-resolution.js';

function mergeBindings(
  existing: readonly BindingRef[],
  incoming: readonly BindingRef[],
): BindingRef[] {
  const seen = new Set(existing.map((b) => b.def.nodeId));
  return [...existing, ...incoming.filter((b) => !seen.has(b.def.nodeId))];
}

export const luaScopeResolver: ScopeResolver = {
  language: SupportedLanguages.Lua,
  languageProvider: luaProvider,
  importEdgeReason: 'lua-scope: import',
  resolveImportTarget: (targetRaw, fromFile, allFilePaths) =>
    resolveLuaImportTarget(targetRaw, fromFile, allFilePaths),
  mergeBindings,
  arityCompatibility: (callsite, def) => luaArityCompatibility(def, callsite),
  buildMro: (graph, parsedFiles, nodeLookup) =>
    buildMro(graph, parsedFiles, nodeLookup, defaultLinearize),
  populateOwners: (parsed: ParsedFile) => populateClassOwnedMembers(parsed),
  isSuperReceiver: () => false,
  resolveQualifiedReceiverMember: resolveLuaReceiverMember,
  fieldFallbackOnMethodLookup: false,
  propagatesReturnTypesAcrossImports: true,
  allowGlobalFreeCallFallback: true,
  // Only explicit module-level globals are visible outside their lexical scope.
  isCallableVisibleFromCaller: ({ candidate }) => !/@\d+:\d+$/.test(candidate.qualifiedName ?? ''),
};
