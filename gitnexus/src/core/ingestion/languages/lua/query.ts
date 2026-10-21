import Parser from 'tree-sitter';
import { requireVendoredGrammar } from '../../../tree-sitter/vendored-grammars.js';

const Lua = requireVendoredGrammar('tree-sitter-lua') as Parameters<Parser['setLanguage']>[0];
const LUA_SCOPE_QUERY = `
(function) @definition.function @name
(local_function) @definition.function @name
(function_definition) @definition.function @name
(variable_declarator (identifier) @name) @definition.variable
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
