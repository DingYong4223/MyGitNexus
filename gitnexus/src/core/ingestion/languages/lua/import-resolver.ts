import type { CaptureMatch, ParsedImport } from 'gitnexus-shared';

export function interpretLuaImport(captures: CaptureMatch): ParsedImport | null {
  const source = captures['@import.source']?.text.replace(/^['"]|['"]$/g, '');
  if (!source) return null;
  const localName = captures['@import.local-name']?.text;
  if (!localName) return { kind: 'side-effect', targetRaw: source };
  return {
    kind: 'namespace',
    localName,
    importedName: source,
    targetRaw: source,
  };
}
