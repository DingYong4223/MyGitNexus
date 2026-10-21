import type { CaptureMatch, ParsedFile } from 'gitnexus-shared';
import { nodeToCapture, syntheticCapture, type SyntaxNode } from '../../utils/ast-helpers.js';
import { synthesizeCallableFlowCaptures } from '../../utils/callable-flow-captures.js';
import { assertCloneable } from '../../workers/clone-safety.js';
import { getLuaParser } from './query.js';
import { parseSourceSafe } from '../../../tree-sitter/safe-parse.js';
import {
  LUA_FUNCTION_TYPES,
  LUA_BLOCK_TYPES,
  luaAssignmentPairs,
  luaBindingPath,
  luaDefinitionIdentity,
  luaFunctionLabel,
  luaStaticPath,
} from './syntax.js';

export interface LuaModuleFacts {
  exports: Array<{ name: string; qualifiedName: string }>;
  imports: Array<{ localName: string; targetRaw: string; line: number; column: number }>;
  implicitReceivers: Array<{ qualifiedName: string; receiver: string }>;
}
const moduleFacts = new Map<string, LuaModuleFacts>();
export function collectLuaModuleFacts(filePath: string) {
  const facts = moduleFacts.get(filePath);
  moduleFacts.delete(filePath);
  return facts === undefined ? undefined : assertCloneable(facts);
}
export function getLuaModuleFacts(parsed: ParsedFile): LuaModuleFacts | undefined {
  return (
    (parsed.captureSideChannel as LuaModuleFacts | undefined) ?? moduleFacts.get(parsed.filePath)
  );
}

export function emitLuaScopeCaptures(
  sourceText: string,
  filePath: string,
  cachedTree?: unknown,
): readonly CaptureMatch[] {
  const tree = (cachedTree ?? parseSourceSafe(getLuaParser(), sourceText)) as {
    rootNode: SyntaxNode;
  };
  const out: CaptureMatch[] = [];
  const facts: LuaModuleFacts = { exports: [], imports: [], implicitReceivers: [] };
  const functions: Array<{ path: string; node: SyntaxNode; qualifiedName: string }> = [];
  const returned = tree.rootNode.namedChildren
    .find((n) => n.type === 'return_statement')
    ?.namedChild(0);
  const exportRoot = returned?.type === 'table' ? '$return' : luaStaticPath(returned);
  const cap = (tag: string, node: SyntaxNode, text?: string) =>
    text === undefined ? nodeToCapture(tag, node) : syntheticCapture(tag, node, text);

  const nodes: SyntaxNode[] = [];
  const pending = [tree.rootNode];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    for (let i = node.namedChildren.length - 1; i >= 0; i--) pending.push(node.namedChildren[i]!);
  }
  for (const node of nodes) {
    if (node.type === 'program') out.push({ '@scope.module': cap('@scope.module', node) });
    if (LUA_BLOCK_TYPES.has(node.type)) out.push({ '@scope.block': cap('@scope.block', node) });
    if (['if_statement', 'elseif', 'else'].includes(node.type)) {
      const body = node.namedChildren.filter(
        (n) => !['condition_expression', 'elseif', 'else', 'comment'].includes(n.type),
      );
      if (body.length) {
        const range = {
          startLine: body[0]!.startPosition.row + 1,
          startCol: body[0]!.startPosition.column,
          endLine: body.at(-1)!.endPosition.row + 1,
          endCol: body.at(-1)!.endPosition.column,
        };
        out.push({ '@scope.block': { ...cap('@scope.block', node), range } });
      }
    }
    if (LUA_FUNCTION_TYPES.has(node.type)) {
      const kind = luaFunctionLabel(node).toLowerCase();
      const identity = luaDefinitionIdentity(node, luaFunctionLabel(node))!;
      const binding = luaBindingPath(node) ?? identity.name;
      out.push({ '@scope.function': cap('@scope.function', node) });
      out.push({
        [`@declaration.${kind}`]: cap(`@declaration.${kind}`, node),
        [`@definition.${kind}`]: cap(`@definition.${kind}`, node),
        '@declaration.name': cap('@declaration.name', node, binding),
        '@declaration.qualified_name': cap(
          '@declaration.qualified_name',
          node,
          identity.qualifiedName,
        ),
        '@name': cap('@name', node, identity.name),
      });
      functions.push({ path: binding, node, qualifiedName: identity.qualifiedName });
      if (
        node.namedChildren
          .find((n) => n.type === 'function_name')
          ?.namedChildren.some((n) => n.type === 'method')
      ) {
        facts.implicitReceivers.push({
          qualifiedName: identity.qualifiedName,
          receiver: binding.slice(0, binding.lastIndexOf('.')),
        });
      }
      const params = node.namedChildren.find((n) => n.type === 'parameters');
      for (const parameter of params?.namedChildren ?? []) {
        if (parameter.type !== 'identifier') continue;
        out.push({
          '@declaration.variable': cap('@declaration.variable', parameter),
          '@declaration.name': cap('@declaration.name', parameter),
        });
      }
    }
    if (['local_variable_declaration', 'variable_declaration'].includes(node.type)) {
      const pairs = luaAssignmentPairs(node);
      for (const destination of node.namedChildren
        .filter((n) => n.type === 'variable_declarator')
        .flatMap((n) => (n.children.some((c) => c.type === '[') ? [] : n.namedChildren))) {
        if (destination.type !== 'identifier') continue;
        if (
          pairs.some(
            (p) =>
              p.destination.startIndex === destination.startIndex &&
              LUA_FUNCTION_TYPES.has(p.source.type),
          )
        )
          continue;
        out.push({
          '@declaration.variable': cap('@declaration.variable', destination),
          '@declaration.name': cap('@declaration.name', destination),
        });
      }
    }
    if (node.type !== 'function_call') continue;
    const args = node.namedChildren.find((n) => n.type === 'arguments');
    const callee = node.namedChild(0);
    const method = node.namedChildren.find((n) => n.type === 'method');
    const staticCallee = luaStaticPath(callee);
    if (
      staticCallee === 'require' &&
      !method &&
      !node.children.some((c) => c.type === '[') &&
      args?.namedChildCount === 1 &&
      args.namedChild(0)?.type === 'string'
    ) {
      const source = args.namedChild(0)!;
      const pair = node.parent
        ? luaAssignmentPairs(node.parent).find((p) => p.source.id === node.id)
        : undefined;
      const localName = luaStaticPath(pair?.destination);
      out.push({
        '@import.statement': cap('@import.statement', node),
        '@import.source': cap('@import.source', source),
        ...(localName
          ? { '@import.local-name': cap('@import.local-name', pair!.destination, localName) }
          : {}),
      });
      if (localName)
        facts.imports.push({
          localName,
          targetRaw: source.text.slice(1, -1),
          line: pair!.destination.startPosition.row + 1,
          column: pair!.destination.startPosition.column,
        });
      continue;
    }
    const path = node.children.some((c) => c.type === '[')
      ? luaStaticPath(node)
      : method && staticCallee
        ? `${staticCallee}.${method.text}`
        : staticCallee;
    if (!path) continue;
    const dot = path.lastIndexOf('.');
    out.push({
      [dot < 0 ? '@reference.call.free' : '@reference.call.member']: cap(
        dot < 0 ? '@reference.call.free' : '@reference.call.member',
        node,
      ),
      '@reference.name': cap(
        '@reference.name',
        method ?? callee!,
        dot < 0 ? path : path.slice(dot + 1),
      ),
      ...(dot < 0
        ? {}
        : { '@reference.receiver': cap('@reference.receiver', callee!, path.slice(0, dot)) }),
    });
  }
  if (exportRoot) {
    const atModuleLevel = (node: SyntaxNode) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          LUA_FUNCTION_TYPES.has(parent.type) ||
          LUA_BLOCK_TYPES.has(parent.type) ||
          parent.type === 'if_statement'
        )
          return false;
      }
      return true;
    };
    const moduleFunctions = functions.filter((fn) => atModuleLevel(fn.node));
    for (const fn of moduleFunctions) {
      if (fn.path.startsWith(`${exportRoot}.`))
        facts.exports.push({
          name: fn.path.slice(exportRoot.length + 1),
          qualifiedName: fn.qualifiedName,
        });
    }
    for (const node of nodes) {
      if (!atModuleLevel(node)) continue;
      for (const { destination, source } of luaAssignmentPairs(node)) {
        const name = luaStaticPath(destination);
        const value = luaStaticPath(source);
        const target = moduleFunctions.filter((f) => f.path === value);
        if (name?.startsWith(`${exportRoot}.`) && target.length === 1) {
          facts.exports.push({
            name: name.slice(exportRoot.length + 1),
            qualifiedName: target[0]!.qualifiedName,
          });
        }
      }
    }
    const tables = nodes.filter(
      (n) => n.type === 'table' && atModuleLevel(n) && luaBindingPath(n) === exportRoot,
    );
    for (const table of tables) {
      for (const field of table.namedChildren) {
        if (field.type !== 'field' || field.namedChildCount !== 2) continue;
        const name = luaStaticPath(field.namedChild(0));
        const value = luaStaticPath(field.namedChild(1));
        const target = moduleFunctions.filter((f) => f.path === value);
        if (name && target.length === 1)
          facts.exports.push({ name, qualifiedName: target[0]!.qualifiedName });
      }
    }
  }
  moduleFacts.set(filePath, facts);
  out.push(
    ...synthesizeCallableFlowCaptures(tree.rootNode, {
      functionNodeTypes: LUA_FUNCTION_TYPES,
      callNodeTypes: new Set(['function_call']),
      parameterListNodeTypes: new Set(['parameters', 'arguments']),
      parameterNodeTypes: new Set(['identifier']),
      bindingNodeTypes: new Set(['local_variable_declaration', 'variable_declaration']),
      assignmentNodeTypes: new Set(['local_variable_declaration', 'variable_declaration']),
      identifierNodeTypes: new Set(['identifier']),
      functionName: (n) => luaBindingPath(n) ?? luaDefinitionIdentity(n, 'Function')?.name,
      extractAssignment: luaAssignmentPairs,
      extractFunctionParameters: (n) =>
        n.namedChildren
          .find((c) => c.type === 'parameters')
          ?.namedChildren.filter((c) => c.type === 'identifier'),
      isCallNode: (n) =>
        n.namedChild(0)?.type === 'identifier' &&
        !n.namedChildren.some((c) => c.type === 'method') &&
        !n.children.some((c) => c.type === '['),
      extractCallCallee: (n) => n.namedChild(0) ?? undefined,
      extractCallableReference: (n) =>
        LUA_FUNCTION_TYPES.has(n.type)
          ? { name: luaBindingPath(n) ?? luaDefinitionIdentity(n, 'Function')!.name, anchor: n }
          : undefined,
    }),
  );
  return out;
}

export function interpretLuaTypeBinding(): null {
  return null;
}
