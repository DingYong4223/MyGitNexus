---
name: mygitnexus-cli
description: "Use when the user needs to run MyGitNexus CLI commands like analyze/index a repo, check status, clean the index, generate a wiki, or list indexed repos. Examples: \"Index this repo\", \"Reanalyze the codebase\", \"Generate a wiki\""
---

# MyGitNexus CLI Commands

Commands below use `node .mygitnexus/run.cjs <command>` — the project-local runner `mygitnexus analyze` drops next to the index. It auto-selects an available runner at call time (global `mygitnexus`, else `pnpm dlx`, else `npx`), so no package-manager assumption and no global install is required.

> **Not analyzed yet, or `node .mygitnexus/run.cjs` reports `Cannot find module`** (the gitignored runner is absent — e.g. a fresh clone or `git clean`)? (Re)generate it with `npx mygitnexus analyze` from the project root. On **npm 11.x**, if `npx` crashes during install (`node.target is null`), install once with `npm i -g mygitnexus` (then `mygitnexus analyze`) or use `pnpm --allow-build=@ladybugdb/core --allow-build=mygitnexus --allow-build=tree-sitter dlx mygitnexus@latest analyze`. See [#1939](https://github.com/DingYong4223/MyGitNexus/issues/1939).

## Commands

### analyze — Build or refresh the index

```bash
node .mygitnexus/run.cjs analyze
```

Run from the project root. This parses all source files, builds the knowledge graph, writes it to `.mygitnexus/`, and generates CLAUDE.md / AGENTS.md context files.

| Flag | Effect |
|------|--------|
| `--force` | Force full re-index even if up to date |
| `--embeddings` | Enable embedding generation for semantic search (off by default) |
| `--drop-embeddings` | Drop existing embeddings on rebuild. By default, an `analyze` without `--embeddings` preserves them. |
| `--pdg` | Build the program-dependence layers used by `explain` and `pdg_query` (taint, CDG, and REACHING_DEF). |

**When to run:** First time in a project, after major code changes, or when `mygitnexus://repo/{name}/context` reports the index is stale.

### status — Check index freshness

```bash
node .mygitnexus/run.cjs status
```

Shows whether the current repo has a MyGitNexus index, when it was last updated, and symbol/relationship counts. Use this to check if re-indexing is needed.

### clean — Delete the index

```bash
node .mygitnexus/run.cjs clean
```

Deletes the `.mygitnexus/` directory and unregisters the repo from the global registry. Use before re-indexing if the index is corrupt or after removing MyGitNexus from a project.

| Flag | Effect |
|------|--------|
| `--force` | Skip confirmation prompt |
| `--all` | Clean all indexed repos, not just the current one |

### wiki — Generate documentation from the graph

```bash
node .mygitnexus/run.cjs wiki
```

Generates repository documentation from the knowledge graph using an LLM. Requires an API key (saved to `~/.mygitnexus/config.json` on first use).

| Flag | Effect |
|------|--------|
| `--force` | Force full regeneration, also required to re-gerenate an existing wiki in a different language |
| `--model <model>` | LLM model (default: minimax/minimax-m2.5) |
| `--base-url <url>` | LLM API base URL |
| `--api-key <key>` | LLM API key |
| `--concurrency <n>` | Parallel LLM calls (default: 3) |
| `--gist` | Publish wiki as a public GitHub Gist |
| `--timeout <seconds>` | LLM request timeout in seconds (default: disabled) |
| `--retries <n>` | Max LLM retry attempts per request (default: 3) |
| `--lang <lang>`  | Output language for generated documentation (e.g. english, chinese, spanish, japanese)|
### list — Show all indexed repos

```bash
node .mygitnexus/run.cjs list
```

Lists all repositories registered in `~/.mygitnexus/registry.json`. The MCP `list_repos` tool provides the same information.

## After Indexing

1. **Read `mygitnexus://repo/{name}/context`** to verify the index loaded
2. Use the other MyGitNexus skills (`exploring`, `debugging`, `impact-analysis`, `refactoring`) for your task

## Troubleshooting

- **"Not inside a git repository"**: Run from a directory inside a git repo
- **Index is stale after re-analyzing**: Restart Claude Code to reload the MCP server
- **Embeddings slow**: Omit `--embeddings` (it's off by default) or set `OPENAI_API_KEY` for faster API-based embedding
