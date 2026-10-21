# Security Policy

## Supported Versions

MyGitNexus is developed on `main`. Security fixes are applied to the latest released minor on npm (`mygitnexus`) and to the published Docker images (`Dockerfile.cli`, `Dockerfile.web`). Older minors are not back-patched.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.**

Use **GitHub Private Vulnerability Reporting** for this repository:

→ https://github.com/DingYong4223/MyGitNexus/security/advisories/new

Please include:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal repro repo or commit hash if possible)
- The affected version(s) — `npm view mygitnexus version`, image digest, or commit SHA
- Any suggested mitigation

### What to expect

- **Acknowledgement:** best-effort within 5 business days, subject to maintainer capacity.
- **Triage:** we will confirm whether the report is in scope, request clarifications if needed, and propose a fix timeline.
- **Disclosure:** coordinated. We will agree on a disclosure date with you before publishing an advisory.

### Scope

In scope:

- The `mygitnexus` CLI and MCP server (`mygitnexus/`)
- The `mygitnexus-web` thin client (`mygitnexus-web/`)
- The `mygitnexus-shared` types package (`mygitnexus-shared/`)
- The published Docker images (`Dockerfile.cli`, `Dockerfile.web`)
- GitHub Actions workflows in `.github/workflows/`

Out of scope:

- Vulnerabilities in third-party dependencies that we have no influence over (please report upstream; if a viable mitigation exists at the MyGitNexus layer, that's in scope).
- Issues requiring physical access to a developer machine or a compromised local environment.
- Theoretical attacks without a practical exploit against a default MyGitNexus deployment.

## Recommended Hardening for Forks and Self-Hosted Deployments

If you fork MyGitNexus or self-host it, we recommend enabling the following in your repository's **Settings → Code security and analysis**:

- **Private vulnerability reporting** — the channel described above.
- **Dependabot alerts** — alerts on advisories affecting your dependencies.
- **Dependabot security updates** — automated PRs for security patches (this repo's `.github/dependabot.yml` already covers version updates).
- **Secret scanning** and **Push protection** — blocks pushes that introduce known secret patterns. Defense-in-depth on top of the in-CI Gitleaks scan documented below.
- **Code scanning** — surfaces SARIF results from CodeQL, Trivy, Scorecard, and zizmor in one place.

## Automated Scans Running in CI

This repository runs the following scans automatically. Findings appear under the repository's **Security → Code scanning** tab.

| Scan | Tool | Trigger | Action on finding |
|------|------|---------|-------------------|
| Static analysis (JS/TS, Python) | [CodeQL](https://github.com/github/codeql-action) | PR, `main` push, weekly | Advisory (Security tab) |
| Dependency vulnerabilities (PR diff) | [`dependency-review-action`](https://github.com/actions/dependency-review-action) | PR | **Blocks PR** at `high+` severity |
| Secret scanning | [Gitleaks](https://github.com/gitleaks/gitleaks-action) | PR, `main` push | **Blocks PR** on default rules |
| Supply-chain posture | [OpenSSF Scorecard](https://github.com/ossf/scorecard-action) | Weekly, `main` push | Advisory (Security tab + public badge) |
| Workflow lint | [zizmor](https://github.com/woodruffw/zizmor) | PR (touching `.github/**`) | **Blocks PR** at `high+` severity |
| Container image scan | [Trivy](https://github.com/aquasecurity/trivy-action) | Weekly, `main` push | Advisory (Security tab) |

Dependency version updates are managed separately by Dependabot — see `.github/dependabot.yml`.
