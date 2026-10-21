import type { NodeLabel } from 'gitnexus-shared';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

export const LUA_FUNCTION_TYPES = new Set(['function', 'local_function', 'function_definition']);
export const LUA_BLOCK_TYPES = new Set([
  'do_statement',
  'while_statement',
  'repeat_statement',
  'for_statement',
  'for_in_statement',
]);

export function luaStaticPath(node: SyntaxNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'variable_declarator' || node.type === 'function_call') {
    if (node.children.some((c) => c.type === '[')) {
      const parts = node.namedChildren.filter((c) => !['arguments', 'method'].includes(c.type));
      const base = luaStaticPath(parts[0]);
      const keys = parts.slice(1).map((c) => (c.type === 'string' ? luaStaticPath(c) : undefined));
      return base && keys.length && keys.every((key) => key !== undefined)
        ? [base, ...keys].join('.')
        : undefined;
    }
    if (node.type === 'variable_declarator' && node.namedChildCount === 1)
      return luaStaticPath(node.namedChild(0));
    return undefined;
  }
  if (['identifier', 'property_identifier', 'method', 'self'].includes(node.type)) return node.text;
  if (node.type === 'string') {
    const match = /^(["'])([A-Za-z_][\w]*)\1$/.exec(node.text);
    return match?.[2];
  }
  if (['field_expression', 'function_name', 'function_name_field'].includes(node.type)) {
    const parts = node.namedChildren.map(luaStaticPath);
    return parts.length && parts.every((p) => p !== undefined) ? parts.join('.') : undefined;
  }
  return undefined;
}

export function luaAssignmentPairs(
  node: SyntaxNode,
): Array<{ destination: SyntaxNode; source: SyntaxNode }> {
  if (!['local_variable_declaration', 'variable_declaration'].includes(node.type)) return [];
  const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator');
  const destinations =
    node.type === 'local_variable_declaration'
      ? declarators.flatMap((c) => c.namedChildren)
      : declarators;
  const sources = node.namedChildren.filter(
    (c) => c.type !== 'variable_declarator' && c.type !== 'comment',
  );
  return destinations.flatMap((destination, i) =>
    sources[i] ? [{ destination, source: sources[i]! }] : [],
  );
}

export function luaBindingPath(node: SyntaxNode): string | undefined {
  if (node.type === 'function')
    return luaStaticPath(node.namedChildren.find((c) => c.type === 'function_name'));
  if (node.type === 'local_function')
    return node.namedChildren.find((c) => c.type === 'identifier')?.text;
  const parent = node.parent;
  if (!parent) return undefined;
  if (['local_variable_declaration', 'variable_declaration'].includes(parent.type)) {
    const pair = luaAssignmentPairs(parent).find((p) => p.source.startIndex === node.startIndex);
    return luaStaticPath(pair?.destination);
  }
  if (
    parent.type === 'field' &&
    parent.namedChildCount === 2 &&
    parent.namedChild(1)?.startIndex === node.startIndex
  ) {
    const key = luaStaticPath(parent.namedChild(0));
    const table = parent.parent;
    const owner = table?.type === 'table' ? luaBindingPath(table) : undefined;
    return key && owner ? `${owner}.${key}` : undefined;
  }
  if (parent.type === 'return_statement' && parent.parent?.type === 'program') return '$return';
  return undefined;
}

export function luaDefinitionIdentity(node: SyntaxNode, _label: NodeLabel) {
  if (!LUA_FUNCTION_TYPES.has(node.type)) return undefined;
  const binding = luaBindingPath(node);
  const position = `${node.startPosition.row}:${node.startPosition.column}`;
  const name = binding?.split('.').pop() ?? `fn@${position}`;
  const isGlobal =
    binding &&
    !binding.includes('.') &&
    ((node.type === 'function' && node.parent?.type === 'program') ||
      (node.parent?.type === 'variable_declaration' && node.parent.parent?.type === 'program'));
  if (isGlobal) return { name, qualifiedName: binding };
  let prefix = '';
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (LUA_FUNCTION_TYPES.has(ancestor.type)) {
      prefix = `${luaDefinitionIdentity(ancestor, 'Function')!.qualifiedName}.`;
      break;
    }
  }
  // Positions distinguish redeclarations and sibling block bindings with the same name.
  return { name, qualifiedName: `${prefix}${binding ?? 'fn'}@${position}` };
}

export function luaFunctionLabel(node: SyntaxNode): 'Function' | 'Method' {
  return luaBindingPath(node)?.includes('.') ? 'Method' : 'Function';
}
