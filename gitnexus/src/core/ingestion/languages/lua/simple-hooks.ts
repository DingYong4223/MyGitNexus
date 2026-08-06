import type {
  CaptureMatch,
  Scope,
  ScopeId,
  ScopeTree,
  ParsedImport,
  Callsite,
  SymbolDefinition,
} from 'gitnexus-shared';

export function luaBindingScopeFor(
  _capture: CaptureMatch,
  _scope: Scope,
  _tree: ScopeTree,
): ScopeId | null {
  return null;
}

export function luaImportOwningScope(
  _parsedImport: ParsedImport,
  _scope: Scope,
  _tree: ScopeTree,
): ScopeId | null {
  return null;
}

export function luaArityCompatibility(_def: SymbolDefinition, _callsite: Callsite): 'unknown' {
  return 'unknown';
}
