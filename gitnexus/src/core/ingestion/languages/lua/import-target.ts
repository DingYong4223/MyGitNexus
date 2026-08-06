import path from 'node:path';

export function resolveLuaImportTarget(
  targetRaw: string,
  fromFile: string,
  allFiles: ReadonlySet<string>,
): string | null {
  const modulePath = targetRaw.replace(/^\.\//, '').replace(/\./g, '/');
  const fromDir = path.posix.dirname(fromFile);
  const candidates = [
    `${modulePath}.lua`,
    `${modulePath}/init.lua`,
    path.posix.join(fromDir, `${modulePath}.lua`),
    path.posix.join(fromDir, `${modulePath}/init.lua`),
  ];
  const found = [...new Set(candidates)].filter(
    (candidate) => allFiles.has(candidate) || allFiles.has(candidate.replace(/^\.\//, '')),
  );
  return found.length === 1 ? found[0]! : null;
}
