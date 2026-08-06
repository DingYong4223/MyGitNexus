import type { CaptureMatch, ParsedImport } from 'gitnexus-shared';

export function interpretLuaImport(captures: CaptureMatch): ParsedImport | null {
  const source = captures['@import.source']?.text.replace(/^['"]|['"]$/g, '');
  if (!source) return null;
  return {
    kind: 'namespace',
    localName: source.split('.').pop()!,
    importedName: source,
    targetRaw: source,
  };
}
