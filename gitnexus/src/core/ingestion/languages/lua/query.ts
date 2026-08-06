import Parser from 'tree-sitter';
import { requireVendoredGrammar } from '../../../tree-sitter/vendored-grammars.js';

const Lua = requireVendoredGrammar('tree-sitter-lua') as Parameters<Parser['setLanguage']>[0];
const LUA_SCOPE_QUERY = `
(program) @scope.module
(function) @scope.function
(local_function) @scope.function

(function
  (function_name (identifier) @declaration.name @name)) @declaration.function @definition.function
(function
  (function_name (function_name_field (identifier) @declaration.owner (property_identifier) @declaration.name @name))) @declaration.function @definition.method
(function
  (function_name (identifier) @declaration.owner (method) @declaration.method @declaration.method-name @name)) @declaration.function @definition.method
(local_function
  (identifier) @declaration.name @name) @declaration.function @definition.function

(local_variable_declaration
  (variable_declarator (identifier) @declaration.name @name)) @declaration.variable @definition.variable
(variable_declaration
  (variable_declarator (identifier) @declaration.name @name)) @declaration.variable @definition.variable

(function_call
  (identifier) @_require
  (arguments (string) @import.source)) @import.statement
  (#eq? @_require "require")

(function_call
  (identifier) @reference.name) @reference.call.free
(function_call
  (field_expression (identifier) @reference.receiver (property_identifier) @reference.name)) @reference.call.member
(function_call
  (identifier) @reference.receiver (method) (arguments)) @reference.call.member
`;

let parser: Parser | undefined;
let query: Parser.Query | undefined;

export function getLuaParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Lua);
  }
  return parser;
}

export function getLuaScopeQuery(): Parser.Query {
  if (!query) query = new Parser.Query(Lua, LUA_SCOPE_QUERY);
  return query;
}

export { LUA_SCOPE_QUERY };
