import type { Capture, CaptureMatch } from 'gitnexus-shared';
import { nodeToCapture, type SyntaxNode } from '../../utils/ast-helpers.js';
import { getLuaParser, getLuaScopeQuery } from './query.js';
import { parseSourceSafe } from '../../../tree-sitter/safe-parse.js';

export function emitLuaScopeCaptures(
  sourceText: string,
  _filePath: string,
  cachedTree?: unknown,
): readonly CaptureMatch[] {
  const tree = (cachedTree ?? parseSourceSafe(getLuaParser(), sourceText)) as {
    rootNode: SyntaxNode;
  };
  const out: CaptureMatch[] = [];
  for (const match of getLuaScopeQuery().matches(tree.rootNode)) {
    if (match.captures.length === 0) continue;
    const grouped: Record<string, Capture> = {};
    for (const capture of match.captures) {
      grouped[`@${capture.name}`] = nodeToCapture(`@${capture.name}`, capture.node);
    }
    if (grouped['@import.statement']) {
      // The source capture is interpreted directly; no synthetic marker is needed.
    }
    out.push(grouped);
  }
  return out;
}

export function interpretLuaTypeBinding(): null {
  return null;
}
