import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncPluginManifests } from '../../scripts/sync-plugin-manifests.mjs';

const SURFACES = [
  'mygitnexus-claude-plugin/.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'mygitnexus-claude-plugin/.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
] as const;

const MCP_SKILL_DIRS = [
  'mygitnexus-plan',
  'mygitnexus-work',
  'mygitnexus-review',
  'mygitnexus-lfg',
  'mygitnexus-guide',
  'mygitnexus-cli',
  'mygitnexus-debugging',
  'mygitnexus-exploring',
  'mygitnexus-impact-analysis',
  'mygitnexus-refactoring',
] as const;

const TOTAL_SURFACES = SURFACES.length + MCP_SKILL_DIRS.length;

function mcpPath(dir: string): string {
  return `mygitnexus-claude-plugin/skills/${dir}/mcp.json`;
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeJson(root: string, file: string, value: unknown): void {
  const filePath = path.join(root, file);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRoot(packageVersion: string, manifestVersion: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mygitnexus-manifest-sync-'));
  tempRoots.push(root);
  writeJson(root, 'mygitnexus/package.json', { name: 'mygitnexus', version: packageVersion });
  writeJson(root, SURFACES[0], { name: 'mygitnexus', version: manifestVersion });
  writeJson(root, SURFACES[1], {
    name: 'mygitnexus-marketplace',
    plugins: [
      { name: 'mygitnexus', version: manifestVersion, source: './mygitnexus-claude-plugin' },
    ],
  });
  writeJson(root, SURFACES[2], { name: 'mygitnexus', version: manifestVersion });
  writeJson(root, SURFACES[3], {
    name: 'mygitnexus-marketplace',
    plugins: [{ name: 'mygitnexus', version: manifestVersion, category: 'Developer Tools' }],
  });
  for (const dir of MCP_SKILL_DIRS) {
    writeJson(root, mcpPath(dir), {
      mcpServers: {
        mygitnexus: { command: 'npx', args: ['-y', `mygitnexus@${manifestVersion}`, 'mcp'] },
      },
    });
  }
  return root;
}

function readVersions(root: string): string[] {
  return SURFACES.map((file) => {
    const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as {
      version?: string;
      plugins?: Array<{ name: string; version: string }>;
    };
    return (
      manifest.version ??
      manifest.plugins?.find((plugin) => plugin.name === 'mygitnexus')?.version ??
      ''
    );
  });
}

describe('syncPluginManifests (#2445)', () => {
  it('rewrites every version-bearing surface to the package version and reports them', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');

    const result = syncPluginManifests(root);

    expect(result.version).toBe('1.6.10-rc.29');
    expect(result.synced).toHaveLength(TOTAL_SURFACES);
    expect(result.stale.map(({ from }) => from)).toEqual(Array(TOTAL_SURFACES).fill('1.6.9'));
    expect(readVersions(root)).toEqual(Array(4).fill('1.6.10-rc.29'));
  });

  it('pins the mygitnexus@<version> launch arg in every plugin skill mcp.json', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');

    syncPluginManifests(root);

    for (const dir of MCP_SKILL_DIRS) {
      const mcp = JSON.parse(readFileSync(path.join(root, mcpPath(dir)), 'utf8')) as {
        mcpServers: { mygitnexus: { args: string[] } };
      };
      expect(mcp.mcpServers.mygitnexus.args).toEqual(['-y', 'mygitnexus@1.6.10-rc.29', 'mcp']);
    }
  });

  it('fails closed when an mcp.json has no mygitnexus@ launch arg', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    writeJson(root, mcpPath('mygitnexus-plan'), {
      mcpServers: { mygitnexus: { command: 'npx', args: ['-y', 'mcp'] } },
    });

    expect(() => syncPluginManifests(root)).toThrow(
      /exactly one "mygitnexus@<version>" launch arg/,
    );
  });

  it('is idempotent once everything matches', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    syncPluginManifests(root);

    const second = syncPluginManifests(root);

    expect(second.synced).toHaveLength(0);
    expect(second.stale).toHaveLength(0);
  });

  it('check mode reports drift without writing anything', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');

    const result = syncPluginManifests(root, { check: true });

    expect(result.stale).toHaveLength(TOTAL_SURFACES);
    expect(result.synced).toHaveLength(0);
    expect(readVersions(root)).toEqual(Array(4).fill('1.6.9'));
  });

  it('changes only the version text and preserves the surrounding formatting', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    const inlineFormatted = `{
  "name": "mygitnexus",
  "version": "1.6.9",
  "keywords": ["code-intelligence", "knowledge-graph", "mcp"]
}
`;
    writeFileSync(path.join(root, SURFACES[0]), inlineFormatted);

    syncPluginManifests(root);

    expect(readFileSync(path.join(root, SURFACES[0]), 'utf8')).toBe(
      inlineFormatted.replace('"version": "1.6.9"', '"version": "1.6.10-rc.29"'),
    );
  });

  it('fails closed when the current version text is ambiguous in the file', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    writeFileSync(
      path.join(root, SURFACES[0]),
      `{
  "name": "mygitnexus",
  "version": "1.6.9",
  "previous": { "version": "1.6.9" }
}
`,
    );

    expect(() => syncPluginManifests(root)).toThrow(/expected exactly one/);
  });

  it('fails closed when a marketplace has no mygitnexus entry', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    writeJson(root, SURFACES[1], { name: 'mygitnexus-marketplace', plugins: [] });

    expect(() => syncPluginManifests(root)).toThrow(/exactly one "mygitnexus" plugin entry/);
  });

  it('fails closed when a surface file is missing', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    rmSync(path.join(root, SURFACES[2]));

    expect(() => syncPluginManifests(root)).toThrow(/Cannot read manifest surface/);
  });

  it('fails closed on unparseable JSON', () => {
    const root = makeRoot('1.6.10-rc.29', '1.6.9');
    writeFileSync(path.join(root, SURFACES[0]), '{ not json');

    expect(() => syncPluginManifests(root)).toThrow(/not valid JSON/);
  });

  it('matches the real repository layout and passes the check on a synced tree', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');

    const result = syncPluginManifests(repoRoot, { check: true });

    expect(result.stale).toEqual([]);
  });

  it('is wired into the npm version lifecycle so every bump syncs the manifests', async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } });

    expect(pkg.default.scripts.version).toBe('node scripts/sync-plugin-manifests.mjs');
  });
});
