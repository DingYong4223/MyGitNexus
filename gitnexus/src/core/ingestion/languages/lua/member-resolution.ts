import {
  buildPositionIndex,
  type ParsedFile,
  type ScopeId,
  type SymbolDefinition,
} from 'gitnexus-shared';
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
import { definitionIdPosition } from '../../scope-resolution/utils/definition-id.js';
import { getLuaModuleFacts, type LuaModuleFacts } from './captures.js';
import { resolveLuaImportTarget } from './import-target.js';

type LuaImport = LuaModuleFacts['imports'][number];
interface FileIndex {
  parsed: ParsedFile;
  imports: Map<ScopeId, Map<string, LuaImport[]>>;
  exports: Map<string, SymbolDefinition[]>;
  implicitReceivers: Map<string, string>;
}
const workspaceIndexes = new WeakMap<
  readonly ParsedFile[],
  { files: Map<string, FileIndex>; paths: Set<string> }
>();

function workspaceIndex(parsedFiles: readonly ParsedFile[]) {
  const cached = workspaceIndexes.get(parsedFiles);
  if (cached) return cached;
  const files = new Map<string, FileIndex>();
  for (const parsed of parsedFiles) {
    const index: FileIndex = {
      parsed,
      imports: new Map(),
      exports: new Map(),
      implicitReceivers: new Map(),
    };
    const positions = buildPositionIndex(parsed.scopes);
    const facts = getLuaModuleFacts(parsed);
    for (const entry of facts?.implicitReceivers ?? [])
      index.implicitReceivers.set(entry.qualifiedName, entry.receiver);
    for (const imp of facts?.imports ?? []) {
      const scope = positions.atPosition(parsed.filePath, imp.line, imp.column);
      if (!scope) continue;
      let byName = index.imports.get(scope);
      if (!byName) index.imports.set(scope, (byName = new Map()));
      const entries = byName.get(imp.localName) ?? [];
      entries.push(imp);
      byName.set(imp.localName, entries);
    }
    const defs = new Map(parsed.localDefs.map((d) => [d.qualifiedName, d]));
    for (const entry of facts?.exports ?? []) {
      const def = defs.get(entry.qualifiedName);
      if (!def) continue;
      const entries = index.exports.get(entry.name) ?? [];
      if (!entries.some((d) => d.nodeId === def.nodeId)) entries.push(def);
      index.exports.set(entry.name, entries);
    }
    files.set(parsed.filePath, index);
  }
  const index = { files, paths: new Set(files.keys()) };
  workspaceIndexes.set(parsedFiles, index);
  return index;
}

export const resolveLuaReceiverMember: NonNullable<
  ScopeResolver['resolveQualifiedReceiverMember']
> = (receiverName, memberName, callerScope, scopes, parsedFiles) => {
  const initial = scopes.scopeTree.getScope(callerScope);
  const { files, paths } = workspaceIndex(parsedFiles);
  const file = files.get(initial?.filePath ?? '');
  if (!file) return undefined;
  let receiver = receiverName;
  if (receiver === 'self') {
    for (
      let scope = initial;
      scope;
      scope = scope.parent ? scopes.scopeTree.getScope(scope.parent) : undefined
    ) {
      // A parameter or local named self hides the implicit method receiver.
      if (scope.bindings.has('self')) return undefined;
      const method = scope.ownedDefs.find((d) => file.implicitReceivers.has(d.qualifiedName ?? ''));
      if (method?.qualifiedName) {
        receiver = file.implicitReceivers.get(method.qualifiedName)!;
        break;
      }
    }
  }
  const root = receiver.split('.')[0]!;
  for (
    let scope = initial;
    scope;
    scope = scope.parent ? scopes.scopeTree.getScope(scope.parent) : undefined
  ) {
    const local = (scope.bindings.get(`${receiver}.${memberName}`) ?? []).filter(
      (b) => b.origin === 'local',
    );
    if (local.length === 1) return local[0]!.def;
    if (local.length > 1) return 'ambiguous';
    const imports = file.imports.get(scope.id)?.get(root) ?? [];
    if (imports.length === 1) {
      const imp = imports[0]!;
      const own = scope.bindings.get(root) ?? [];
      if (
        own.some((b) => {
          if (b.origin !== 'local') return false;
          const pos = definitionIdPosition(b.def.nodeId, b.def.filePath);
          return pos?.line !== imp.line || pos?.column !== imp.column;
        })
      )
        return undefined;
      const targetFile = resolveLuaImportTarget(imp.targetRaw, file.parsed.filePath, paths);
      const exportedName = `${receiver.slice(root.length + 1)}.${memberName}`.replace(/^\./, '');
      const exported = files.get(targetFile ?? '')?.exports.get(exportedName) ?? [];
      return exported.length === 1 ? exported[0] : undefined;
    }
    if (imports.length > 1 || scope.bindings.has(root)) return undefined;
  }
  return undefined;
};
