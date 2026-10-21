# mygitnexus-lfg — plan → gate → work → review

Thin pipeline orchestrator over three existing skills: `mygitnexus-plan`
produces the plan (asking up front how deep to go), the user chooses at a
blocking gate to proceed or stop (an explicit deepen request is still
honored), `mygitnexus-work` executes it as verified atomic commits, and
`mygitnexus-review` reviews the result (the open PR if one exists, else the
branch diff against the default branch). One bounded fix cycle for review
findings, then a final report. It never pushes or opens a PR on its own.

## Invocation

| CLI | How to invoke |
|-----|---------------|
| **Claude Code** | `/mygitnexus-lfg <task description>` or `/mygitnexus-lfg docs/plans/<plan>.md` |
| **Codex CLI** | Ask: "run the mygitnexus pipeline on <task>" (Codex reads `AGENTS.md`), or install the skill user-level (below) |

### Codex (user-level install)

```
cp -r .claude/skills/mygitnexus-lfg ~/.agents/skills/mygitnexus-lfg
```

Optionally, for an explicit slash command, create
`~/.codex/prompts/mygitnexus-lfg.md`:

```markdown
---
description: MyGitNexus pipeline — plan (depth asked up front), user gate, work, PR review
argument-hint: <task description or plan path>
---
Use the mygitnexus-lfg skill for: $ARGUMENTS

Read `~/.agents/skills/mygitnexus-lfg/SKILL.md` (prefer the repo copy at
`.claude/skills/mygitnexus-lfg/SKILL.md` when present) and follow its lanes in
order, invoking the real mygitnexus-plan / mygitnexus-work / mygitnexus-review
skills for each lane. Stop at the plan gate for the user's choice.
```

## The three lanes

| Lane | Skill | Gate |
|------|-------|------|
| Plan | `mygitnexus-plan` (`.claude/skills/mygitnexus-plan/`) | Depth asked up front; blocking gate: proceed / stop |
| Work | `mygitnexus-work` (`.claude/skills/mygitnexus-work/`) | Structural drift routes back to the plan gate |
| Review | `mygitnexus-review` (`.claude/skills/mygitnexus-review/`) | One fix cycle max, then report |

## Threshold governance (maintainers)

The Lane 1 planning boundary (~35 turns) is a promoted benchmark policy from
the MyGitNexus repository's `eval/workflow_bench/` paired candidate loop.
Re-evaluate it offline whenever the named model or tool harness changes, and
at least every 90 days; update the SKILL.md threshold only after the
deterministic promotion gate shows no quality regression. Reading agents
never self-edit it from a live task.
