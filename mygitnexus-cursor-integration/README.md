# MyGitNexus — Cursor integration

Static config that adds MyGitNexus knowledge-graph augmentation and skill files to Cursor.

> **Hooks require Cursor 2.4+.** Earlier versions don't expose `postToolUse` and the hook will silently no-op.

## What you get

| Layer                     | What it does                                                                                                                              | How it's installed                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **MCP**                   | `mygitnexus` MCP server with 17 tools (`query`, `context`, `impact`, `detect_changes`, `rename`, …)                                         | `npx mygitnexus setup` writes `~/.cursor/mcp.json` automatically.                 |
| **Skills**                | All bundled markdown skills (`/mygitnexus-exploring`, `/mygitnexus-debugging`, `/mygitnexus-impact-analysis`, `/mygitnexus-refactoring`, `/mygitnexus-guide`, `/mygitnexus-cli`, `/mygitnexus-review`, `/mygitnexus-plan`, `/mygitnexus-work`, `/mygitnexus-lfg`, `/mygitnexus-pdg-query`, `/mygitnexus-taint-analysis`) | `npx mygitnexus setup` copies them to `~/.cursor/skills/mygitnexus/`.               |
| **Hooks** _(this README)_ | `postToolUse` hook that enriches `Shell` / `Read` / `Grep` tool calls with graph context — same augmentation Claude Code gets             | **Manual** — copy the files described below into your project's `.cursor/`. |

## Hook install

Cursor 2.4+ reads `.cursor/hooks.json` from the project root and runs hook commands with the project root as the working directory ([docs](https://cursor.com/docs/agent/hooks)).

From this repo's `mygitnexus-cursor-integration/hooks/`, copy the files below into your **project root**:

```text
<your-project>/
├── .cursor/
│   └── hooks.json              ← from mygitnexus-cursor-integration/hooks/hooks.json
└── hooks/
    ├── mygitnexus-hook.cjs       ← from mygitnexus-cursor-integration/hooks/mygitnexus-hook.cjs
    └── hook-lock.cjs           ← from mygitnexus-cursor-integration/hooks/hook-lock.cjs
```

Equivalent shell commands (run from your project root, with `$MYGITNEXUS_REPO` pointing at a clone of this repo):

```bash
mkdir -p .cursor hooks
cp "$MYGITNEXUS_REPO/mygitnexus-cursor-integration/hooks/hooks.json"        .cursor/hooks.json
cp "$MYGITNEXUS_REPO/mygitnexus-cursor-integration/hooks/mygitnexus-hook.cjs" hooks/mygitnexus-hook.cjs
cp "$MYGITNEXUS_REPO/mygitnexus-cursor-integration/hooks/hook-lock.cjs"     hooks/hook-lock.cjs
```

If you already have a `.cursor/hooks.json`, merge the `hooks.postToolUse` array rather than overwriting.

### Verify

1. Index the project: `npx mygitnexus analyze` (on npm 11.x, `npx` can crash during install — use `pnpm --allow-build=@ladybugdb/core --allow-build=mygitnexus --allow-build=tree-sitter dlx mygitnexus@latest analyze` instead; see [#1939](https://github.com/DingYong4223/MyGitNexus/issues/1939))
2. Reload the Cursor window so it picks up the new hook config.
3. Ask the agent something that triggers `Read` / `Grep` / `Shell rg`. You should see a `[MyGitNexus]` block appended to the tool result.
4. Diagnose silent no-ops by setting `MYGITNEXUS_DEBUG=1` in your shell environment — the hook will write Cursor's raw event payload to stderr so you can verify field names.

### What's installed manually vs. automated

| Step                                                                 | Automated by `mygitnexus setup`? |
| -------------------------------------------------------------------- | ------------------------------ |
| `~/.cursor/mcp.json`                                                 | ✅                             |
| `~/.cursor/skills/mygitnexus/*`                                        | ✅                             |
| `<project>/.cursor/hooks.json` + `<project>/hooks/mygitnexus-hook.cjs` + `<project>/hooks/hook-lock.cjs` | ❌ — copy manually (see above) |

Hook install is per-project (Cursor scopes hooks to a project root); skills and MCP config are global.

## Hook contract

The hook receives a JSON event on stdin matching Cursor 2.4's `postToolUse` shape:

```json
{
  "tool_name": "Grep" | "Read" | "Shell",
  "tool_input": { /* tool-specific */ },
  "tool_output": { /* optional */ },
  "cwd": "/absolute/path/to/project"
}
```

It writes augmentation context to stdout as:

```json
{ "additional_context": "[MyGitNexus] …" }
```

Empty stdout means "no augmentation, continue normally" — the hook never blocks the tool.

### Pattern extraction per tool

| Tool    | Pattern source                                                                                                         | Notes                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Grep`  | `tool_input.query` (also `pattern`, `regex`, `q`, `search`, `searchQuery`)                                             | Last-resort fallback: longest string value in `tool_input` (≥ 3 chars).                              |
| `Read`  | basename of `tool_input.target_file` (also `file_path`, `filePath`, `path`, `file`), stripped to identifier characters | `auth/handler.ts` → `handler`.                                                                       |
| `Shell` | First positional argument after `rg` / `grep` in `tool_input.command`                                                  | Best-effort tokenizer; quoted multi-word patterns (`rg "User Service"`) extract the first word only. |

## Troubleshooting

- **Nothing happens** — Confirm Cursor is on 2.4+ and the project root has `.cursor/hooks.json` plus both hook files at `hooks/mygitnexus-hook.cjs` and `hooks/hook-lock.cjs`. Then `npx mygitnexus list` to confirm the project is indexed.
- **`mygitnexus` not found** — The hook prefers a locally-resolvable `mygitnexus/dist/cli/index.js` and falls back to `npx -y mygitnexus`. Install globally with `npm i -g mygitnexus` to skip the npx cold-start latency.
- **Wrong pattern extracted** — Set `MYGITNEXUS_DEBUG=1` and run a tool call. The raw stdin payload is logged to stderr; use it to confirm Cursor's actual `tool_input` field names against the table above. If they differ, file an issue with the captured payload.
