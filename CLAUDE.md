# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **Calen**, a local-first desktop AI agent (Tauri 2 + React/TS + Rust), with an optional Go **Gateway** that relays browser access to a running desktop agent, and a managed **stock-sidecar** for evidence-aware stock research. The desktop app is always the execution and storage authority; the Gateway is a bounded relay, never a second source of truth.

Read `AGENTS.md` before non-trivial work — it encodes hard project rules (summarized under "Critical rules" below). Deeper design lives in `docs/architecture/overview.md` and `docs/features/*`.

## Repository layout

This is a hybrid monorepo: a pnpm workspace + a Cargo workspace + a Go module, all under `crates/`.

```
crates/agent-gui/          Desktop app: React/TS frontend (src/) + Tauri Rust backend (src-tauri/)
crates/agent-gateway/      Go gRPC/HTTP/WS Gateway (cmd/, internal/, proto/) + browser WebUI (web/)
crates/stock-sidecar/      TS JSON-RPC stdio sidecar: normalizes provider evidence + quant research
crates/stock-process-tree/       Rust crate (process-tree helper, in Cargo workspace)
crates/stock-sidecar-runtime/    Rust crate (sidecar runtime, in Cargo workspace)
Opptrix-main/              READ-ONLY upstream source project for stock capabilities (see rules)
docs/                      Architecture, feature, ADR, operations, release docs
scripts/                   Release, validation, maintenance scripts
```

The Cargo workspace (`Cargo.toml`) only contains `agent-gui/src-tauri`, `stock-process-tree`, and `stock-sidecar-runtime`.

## Common commands

Run from repo root unless noted. The `Makefile` is the source of truth for build/release; `make help` lists everything.

### Desktop development

```bash
# First run and whenever sidecar source changes — the sidecar must be built before the app can use it:
pnpm --dir crates/stock-sidecar build

# Start the REAL desktop app (Tauri shell + Vite hot reload). Prefer this over `make dev`'s bare form only if you need the sidecar step:
pnpm --dir crates/agent-gui tauri dev      # or: make dev
```

`pnpm --dir crates/agent-gui dev` starts ONLY the browser frontend (Vite). It cannot validate Tauri IPC, SQLite, native attachments, window chrome, taskbar state, or packaged resources — use `tauri dev` to test anything touching the backend.

### Gateway development

```bash
make dev-gateway     # Go gateway on :50051 (grpc) / :50052 (http), token=dev-token
make dev-webui       # WebUI dev server, proxying to the gateway
make proto           # regenerate protobuf/gRPC Go code from proto/v1/gateway.proto
make gateway-build   # proto + webui + CGO_ENABLED=0 go build
```

### Checks (run before any release / large change)

```bash
pnpm typecheck       # tsc --noEmit across stock-sidecar, agent-gui, gateway/web
pnpm test            # runs stock-sidecar + gui + gateway test suites
git diff --check     # whitespace/conflict-marker check
```

### Tests — per package and single test

Tests use Node's built-in runner (`node --test`), not jest/vitest.

```bash
pnpm --dir crates/stock-sidecar test
pnpm --dir crates/agent-gui test            # node --test test/**/*.test.mjs
pnpm --dir crates/agent-gateway/web test

# Single test file (agent-gui example):
pnpm --dir crates/agent-gui exec node --test test/settings/some.test.mjs
# stock-sidecar uses TS test files with type stripping:
pnpm --dir crates/stock-sidecar exec node --test --experimental-strip-types test/foo.test.ts
```

### Lint / format

Frontend uses **Biome** (not ESLint/Prettier for `src/`). Husky + lint-staged run on commit.

```bash
pnpm --dir crates/agent-gui lint       # biome check src/
pnpm --dir crates/agent-gui lint:fix   # biome check --write src/
```

### Rust check for the Tauri backend

```bash
cargo check --manifest-path crates/agent-gui/src-tauri/Cargo.toml --tests
```

## Architecture (the big picture)

Five layers, each owning a distinct boundary:

1. **Desktop UI** — `crates/agent-gui/src`. React/TS/Vite. Chat surfaces, settings, tools, and stock research views. Feature logic is organized under `src/lib/` (e.g. `chat/`, `tools/`, `mcpRegistry/`, `skills/`, `subagents/`, `memory/`, `settings/`, `stock-research/`, `translation/`). Talks to the backend over Tauri IPC.
2. **Desktop backend** — `crates/agent-gui/src-tauri/src` (Rust: `commands/`, `services/`, `runtime/`, `bin/`). High-privilege local capability and persistence: SQLite, system commands, managed processes, file/native access, the stock sidecar lifecycle.
3. **Agent runtime** — context construction, model streaming, tool execution, long-context compaction, memory, and Gateway event emission. Provider routes cover Claude, OpenAI/Codex, and Gemini flows; credentials are stored by the desktop app and redacted from Gateway snapshots.
4. **Stock sidecar** — `crates/stock-sidecar`. A Tauri-managed JSON-RPC-over-stdio child process that normalizes provider evidence and runs quantitative research. Every result carries source, `asOf` (business time), `retrievedAt`, cache state, and warnings.
5. **Gateway** — `crates/agent-gateway` (Go). gRPC + HTTP + WebSocket + auth + bounded relay state + embedded WebUI (`web/`). Relays authenticated chat/settings traffic to a running desktop agent under a restricted remote tool profile — it does not browse the local filesystem.

The long-term stock seam is a small, stable `StockResearch`-style interface; MCP, stdio, and builtin tools are just adapters over it. The interface hides provider routing, caching, throttling, source, freshness, and errors.

## Critical rules (from AGENTS.md — read the full file)

- **Never `git add .` or `git add -A`.** It would commit the entire read-only `Opptrix-main/` source tree. Stage exact Calen files only.
- `Opptrix-main/` is a read-only reference project (Apache-2.0). Only edit it when the user explicitly asks. Extract designs from it into the Calen main tree; do not copy its full Web/Electron/API product layer. When citing it, give the concrete path and separate "source-project fact" from "Calen adaptation".
- **Compatibility identifiers are intentionally preserved.** `.liveagent` data dir, `LIVEAGENT_*` env vars, `com.xiaofei.liveagent` app id, the gRPC package, and some storage keys are legacy but load-bearing. Do NOT mass-rename them without a data migration + upgrade path. New config prefers `CALEN_*` and reads the old `LIVEAGENT_*` name as a fallback.
- User-facing brand is **Calen**; repo is `MiaTxxx/Calen`.
- **Stock capability is read-only.** No auto-trading, order placement, guaranteed returns, or investment advice. No conclusion may be detached from its source and time; experimental analysis must stay partitioned from factual evidence data; AI access to a user's portfolio requires explicit authorization in the current request.
- License hygiene: Calen is MIT, Opptrix is Apache-2.0 — preserve copyright and attribution when reusing code.

## Domain vocabulary

Two ubiquitous-language tables define the shared terms — consult them before naming or renaming domain concepts:

- `CONTEXT.md` — desktop workspace concepts (Workspace Project, Default Project, remove vs hide, translation model, app proxy, offline/local-only translation).
- `UBIQUITOUS_LANGUAGE.md` — stock domain (Instrument/`InstrumentRef`, Provider, Evidence Result, `asOf` vs `retrievedAt`, partial/unavailable, sidecar, fallback, circuit breaker, throttle, portfolio/transaction).
