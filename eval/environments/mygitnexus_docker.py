"""
MyGitNexus Docker Environment for SWE-bench Evaluation

Extends mini-swe-agent's Docker environment to:
1. Install MyGitNexus (Node.js + npm + mygitnexus package)
2. Run `mygitnexus analyze` on the repository
3. Start the eval-server daemon (persistent HTTP server with warm KuzuDB)
4. Install standalone tool scripts in /usr/local/bin/ (works with subprocess.run)
5. Cache indexes per (repo, base_commit) to avoid re-indexing

IMPORTANT: mini-swe-agent runs every command with subprocess.run in a fresh subshell.
This means .bashrc is NOT sourced, exported functions are NOT available, and env vars
don't persist. The tool scripts must be standalone executables in $PATH.

Architecture:
  Agent bash cmd → /usr/local/bin/mygitnexus-query → curl localhost:4848/tool/query → eval-server → KuzuDB
  Fallback: → npx mygitnexus query (cold start, slower)

Tool call latency: ~50-100ms via eval-server, ~5-10s via CLI fallback.
"""

import hashlib
import json
import logging
import shutil
import time
from pathlib import Path

from constants import (
    EVAL_SERVER_HEALTH_INTERVAL_SECONDS,
    EVAL_SERVER_HEALTH_RETRIES,
    EVAL_SERVER_HEALTH_TIMEOUT_SECONDS,
)
from minisweagent.environments.docker import DockerEnvironment
from tool_registry import TOOL_SPECS, ToolScriptSpec
from utils.errors import is_debug_enabled, log_safe_exception

logger = logging.getLogger("mygitnexus_docker")

DEFAULT_CACHE_DIR = Path.home() / ".mygitnexus-eval-cache"
EVAL_SERVER_PORT = 4848
EVAL_SERVER_HOST = "127.0.0.1"


class MyGitNexusDockerEnvironment(DockerEnvironment):
    """
    Docker environment with MyGitNexus pre-installed, indexed, and eval-server running.

    Setup flow:
    1. Start Docker container (base SWE-bench image)
    2. Install Node.js + mygitnexus inside the container
    3. Run `mygitnexus analyze` (or restore from cache)
    4. Start `mygitnexus eval-server` daemon (keeps KuzuDB warm)
    5. Install standalone tool scripts in /usr/local/bin/
    6. Agent runs with near-instant MyGitNexus tool calls
    """

    def __init__(
        self,
        *,
        enable_mygitnexus: bool = True,
        cache_dir: str | Path | None = None,
        skip_embeddings: bool = True,
        mygitnexus_timeout: int = 120,
        eval_server_port: int = EVAL_SERVER_PORT,
        eval_server_host: str = EVAL_SERVER_HOST,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.enable_mygitnexus = enable_mygitnexus
        self.cache_dir = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
        self.skip_embeddings = skip_embeddings
        self.mygitnexus_timeout = mygitnexus_timeout
        self.eval_server_port = eval_server_port
        self.eval_server_host = eval_server_host
        self.index_time: float = 0.0
        self._mygitnexus_ready = False

    def start(self) -> dict:
        """Start the container and set up MyGitNexus."""
        result = super().start()

        if self.enable_mygitnexus:
            try:
                self._setup_mygitnexus()
            except Exception as e:
                log_safe_exception(
                    logger,
                    "MyGitNexus setup failed, continuing without it",
                    e,
                    include_debug=is_debug_enabled(),
                    level="warning",
                )
                self._mygitnexus_ready = False

        return result

    def _setup_mygitnexus(self):
        """Install and configure MyGitNexus in the container."""
        start = time.time()

        self._ensure_nodejs()
        self._install_mygitnexus()
        self._index_repository()
        self._start_eval_server()
        self._install_tools()

        self.index_time = time.time() - start
        self._mygitnexus_ready = True
        logger.info(f"MyGitNexus setup completed in {self.index_time:.1f}s")

    def _ensure_nodejs(self):
        """Ensure Node.js >= 18 is available in the container."""
        check = self.execute({"command": "node --version 2>/dev/null || echo 'NOT_FOUND'"})
        output = check.get("output", "").strip()

        if "NOT_FOUND" in output:
            logger.info("Installing Node.js in container...")
            install_cmds = [
                "apt-get update -qq",
                "apt-get install -y -qq curl ca-certificates",
                "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
                "apt-get install -y -qq nodejs",
            ]
            for cmd in install_cmds:
                result = self.execute({"command": cmd, "timeout": 60})
                if result.get("returncode", 1) != 0:
                    raise RuntimeError(f"Failed to install Node.js: {result.get('output', '')}")
        else:
            logger.info(f"Node.js already available: {output}")

    def _install_mygitnexus(self):
        """Install the mygitnexus npm package globally."""
        check = self.execute({"command": "npx mygitnexus --version 2>/dev/null || echo 'NOT_FOUND'"})
        if "NOT_FOUND" in check.get("output", ""):
            logger.info("Installing mygitnexus...")
            result = self.execute({
                "command": "npm install -g mygitnexus",
                "timeout": 60,
            })
            if result.get("returncode", 1) != 0:
                raise RuntimeError(f"Failed to install mygitnexus: {result.get('output', '')}")

    def _index_repository(self):
        """Run mygitnexus analyze on the repo, using cache if available."""
        repo_info = self._get_repo_info()
        cache_key = self._make_cache_key(repo_info)
        cache_path = self.cache_dir / cache_key

        if cache_path.exists():
            logger.info(f"Restoring MyGitNexus index from cache: {cache_key}")
            self._restore_cache(cache_path)
            return

        logger.info("Running mygitnexus analyze...")
        skip_flag = "--skip-embeddings" if self.skip_embeddings else ""
        result = self.execute({
            "command": f"cd /testbed && npx mygitnexus analyze . {skip_flag} 2>&1",
            "timeout": self.mygitnexus_timeout,
        })

        if result.get("returncode", 1) != 0:
            output = result.get("output", "")
            if "error" in output.lower() and "indexed" not in output.lower():
                raise RuntimeError(f"mygitnexus analyze failed: {output[-500:]}")

        self._save_cache(cache_path, repo_info)

    def _start_eval_server(self):
        """Start the MyGitNexus eval-server daemon in the background."""
        logger.info(
            f"Starting eval-server on {self.eval_server_host}:{self.eval_server_port}..."
        )

        self.execute({
            "command": (
                f"nohup npx mygitnexus eval-server --port {self.eval_server_port} "
                f"--host {self.eval_server_host} "
                f"--idle-timeout 600 "
                f"> /tmp/mygitnexus-eval-server.log 2>&1 &"
            ),
            "timeout": 5,
        })

        # Use 127.0.0.1 for the health probe — reachable whether server binds
        # loopback or all interfaces (0.0.0.0), avoiding DNS resolution issues.
        health_host = "127.0.0.1"

        # Wait for the server to be ready (up to ~15s for KuzuDB init)
        for i in range(EVAL_SERVER_HEALTH_RETRIES):
            time.sleep(EVAL_SERVER_HEALTH_INTERVAL_SECONDS)
            health = self.execute({
                "command": f"curl -sf http://{health_host}:{self.eval_server_port}/health 2>/dev/null || echo 'NOT_READY'",
                "timeout": EVAL_SERVER_HEALTH_TIMEOUT_SECONDS,
            })
            output = health.get("output", "").strip()
            if "NOT_READY" not in output and "ok" in output:
                logger.info(
                    f"Eval-server ready after {(i + 1) * EVAL_SERVER_HEALTH_INTERVAL_SECONDS:.1f}s"
                )
                return

        log_output = self.execute({
            "command": "cat /tmp/mygitnexus-eval-server.log 2>/dev/null | tail -20",
        })
        logger.warning(
            f"Eval-server didn't become ready in "
            f"{EVAL_SERVER_HEALTH_RETRIES * EVAL_SERVER_HEALTH_INTERVAL_SECONDS:.1f}s. "
            f"Tools will fall back to direct CLI.\n"
            f"Server log: {log_output.get('output', 'N/A')}"
        )

    @staticmethod
    def _render_tool_script(spec: ToolScriptSpec, port: str, host: str = EVAL_SERVER_HOST) -> str:
        """
        Render a standalone bash script for a MyGitNexus tool.

        Scripts call the eval-server fast path when an endpoint is present,
        and fall back to the CLI otherwise.
        """
        lines = ["#!/bin/bash"]

        if spec.endpoint:
            lines.append(f'PORT="${{MYGITNEXUS_EVAL_PORT:-{port}}}"')
            lines.append(f'HOST="${{MYGITNEXUS_EVAL_HOST:-{host}}}"')

        if spec.header:
            lines.append(spec.header.strip())

        if spec.payload_builder:
            lines.append(spec.payload_builder.strip())

        if spec.endpoint:
            lines.append(
                f'result=$(curl -sf -X POST "http://${{HOST}}:${{PORT}}{spec.endpoint}" '
                '-H "Content-Type: application/json" -d "$payload" 2>/dev/null)'
            )
            lines.append('if [ $? -eq 0 ] && [ -n "$result" ]; then echo "$result"; exit 0; fi')

        lines.append(spec.fallback.strip())
        return "\n".join(lines)

    def _install_tools(self):
        """
        Install standalone MyGitNexus tool scripts in /usr/local/bin/.

        Each script is a self-contained bash script that:
        1. Calls the eval-server via curl (fast path, ~100ms)
        2. Falls back to direct CLI if eval-server is unavailable

        These are standalone executables — no sourcing, env inheritance, or .bashrc
        needed. This is critical because mini-swe-agent runs every command via
        subprocess.run in a fresh subshell.

        Uses heredocs with quoted delimiter to avoid all quoting/escaping issues.
        """
        port = str(self.eval_server_port)
        host = self.eval_server_host

        for spec in TOOL_SPECS.values():
            script_content = self._render_tool_script(spec, port, host).strip()
            # Use heredoc with quoted delimiter — prevents all variable expansion and quoting issues
            self.execute({
                "command": (
                    f"cat << 'MYGITNEXUS_SCRIPT_EOF' > /usr/local/bin/{spec.bin_name}\n"
                    f"{script_content}\n"
                    "MYGITNEXUS_SCRIPT_EOF\n"
                    f"chmod +x /usr/local/bin/{spec.bin_name}"
                ),
                "timeout": 5,
            })

        logger.info(f"Installed {len(TOOL_SPECS)} MyGitNexus tool scripts in /usr/local/bin/")

    def _get_repo_info(self) -> dict:
        """Get repository identity info from the container."""
        repo_result = self.execute({
            "command": "cd /testbed && basename $(git remote get-url origin 2>/dev/null || basename $(pwd)) .git"
        })
        commit_result = self.execute({"command": "cd /testbed && git rev-parse HEAD 2>/dev/null || echo unknown"})

        return {
            "repo": repo_result.get("output", "unknown").strip(),
            "commit": commit_result.get("output", "unknown").strip(),
        }

    @staticmethod
    def _make_cache_key(repo_info: dict) -> str:
        """Create a deterministic cache key from repo info."""
        content = f"{repo_info['repo']}:{repo_info['commit']}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def _save_cache(self, cache_path: Path, repo_info: dict):
        """Save the MyGitNexus index to the host cache directory."""
        try:
            cache_path.mkdir(parents=True, exist_ok=True)

            find_result = self.execute({
                "command": "find /root/.mygitnexus -name 'kuzu' -type d 2>/dev/null | head -1"
            })
            mygitnexus_dir = find_result.get("output", "").strip()

            if mygitnexus_dir:
                parent = str(Path(mygitnexus_dir).parent)
                self.execute({
                    "command": f"cd {parent} && tar czf /tmp/mygitnexus-cache.tar.gz .",
                    "timeout": 30,
                })

                container_id = getattr(self, "_container_id", None) or getattr(self, "container_id", None)
                if container_id:
                    import subprocess as sp
                    sp.run(
                        ["docker", "cp", f"{container_id}:/tmp/mygitnexus-cache.tar.gz",
                         str(cache_path / "index.tar.gz")],
                        check=True, capture_output=True,
                    )
                    (cache_path / "metadata.json").write_text(json.dumps(repo_info, indent=2))
                    logger.info(f"Cached MyGitNexus index: {cache_path}")

        except Exception as e:
            log_safe_exception(
                logger,
                "Failed to cache MyGitNexus index",
                e,
                include_debug=is_debug_enabled(),
                level="warning",
            )
            if cache_path.exists():
                shutil.rmtree(cache_path, ignore_errors=True)

    def _restore_cache(self, cache_path: Path):
        """Restore a cached MyGitNexus index into the container."""
        try:
            cache_tarball = cache_path / "index.tar.gz"
            if not cache_tarball.exists():
                logger.warning("Cache tarball not found, re-indexing")
                self._index_repository()
                return

            container_id = getattr(self, "_container_id", None) or getattr(self, "container_id", None)
            if container_id:
                import subprocess as sp

                self.execute({"command": "mkdir -p /root/.mygitnexus"})

                storage_result = self.execute({
                    "command": "npx mygitnexus list 2>/dev/null | grep -o '/root/.mygitnexus/[^ ]*' | head -1 || echo '/root/.mygitnexus/repos/default'"
                })
                storage_path = storage_result.get("output", "").strip() or "/root/.mygitnexus/repos/default"
                self.execute({"command": f"mkdir -p {storage_path}"})

                sp.run(
                    ["docker", "cp", str(cache_tarball), f"{container_id}:/tmp/mygitnexus-cache.tar.gz"],
                    check=True, capture_output=True,
                )
                self.execute({
                    "command": f"cd {storage_path} && tar xzf /tmp/mygitnexus-cache.tar.gz",
                    "timeout": 30,
                })
                logger.info("MyGitNexus index restored from cache")

        except Exception as e:
            log_safe_exception(
                logger,
                "Failed to restore cache, re-indexing",
                e,
                include_debug=is_debug_enabled(),
                level="warning",
            )
            self._index_repository()

    def stop(self) -> dict:
        """Stop the container, shutting down eval-server first."""
        if self._mygitnexus_ready:
            try:
                self.execute({
                    "command": f"curl -sf -X POST http://127.0.0.1:{self.eval_server_port}/shutdown 2>/dev/null || true",
                    "timeout": 3,
                })
            except Exception:
                pass

        return super().stop()

    def get_template_vars(self) -> dict:
        """Add MyGitNexus-specific template variables."""
        base_vars = super().get_template_vars()
        base_vars["mygitnexus_ready"] = self._mygitnexus_ready
        base_vars["mygitnexus_index_time"] = self.index_time
        return base_vars

    def serialize(self) -> dict:
        """Include MyGitNexus environment info in serialization."""
        base = super().serialize()
        base.setdefault("info", {})["mygitnexus_env"] = {
            "enabled": self.enable_mygitnexus,
            "ready": self._mygitnexus_ready,
            "index_time_seconds": round(self.index_time, 2),
            "skip_embeddings": self.skip_embeddings,
            "eval_server_port": self.eval_server_port,
            "eval_server_host": self.eval_server_host,
        }
        return base
