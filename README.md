# pi-local-mem

Project-level session memory for the [pi coding agent](https://pi.dev/) — a single **LocalMem.md** file per project.

## Why

Every other pi memory extension either uses SQLite (unreadable outside the tool), spawns LLM calls on session shutdown (slow), or scatters memory across dozens of files. **pi-local-mem** is different:

- **One file** — `LocalMem.md` at project root. Human-readable. Git-ignorable.
- **Zero dependencies** — No SQLite, no vector DB, no git dependency. Pure TypeScript + Node fs.
- **Zero LLM calls** — No consolidation step. No reflection model. All operations are deterministic file I/O.
- **Fast** — Read on session start, cached in memory. Tools do append-only writes with dedup.
- **Smart clean** — Built-in dedup, stale detection, and size management via `localmem_clean`.

## LocalMem.md Structure

```markdown
# Project Memory

## Decisions
- 2025-05-05: Using FastAPI for the API layer — simpler than Flask for async
- 2025-05-04: Chose PostgreSQL over MongoDB — relational data model fits better

## Active Context
- Docker stack uses Cloudflare Tunnel for public access
- All services on `labnet` Docker network

## Bugs & Fixes
- 2025-05-03: Immich container OOM — increased memory limit to 4G

## Changelog
- 2025-05-05: Added health endpoint to FastAPI service

## Patterns
- Always use `labnet` Docker network for new services
- Conventional commits for all repos
```

Sections auto-date entries for Decisions, Bugs & Fixes, and Changelog. Active Context and Patterns are undated.

## Credit

Forked from [pi-memd](https://github.com/whonixnetworks/pi-memd) by greedy. Stripped commands, strengthened context instructions, fixed file-read overhead, added dedup-on-write, and centralized section logic.

## Install

From GitHub:

```bash
pi install github:3DAlgoLab/pi-local-mem
```

Or from npm:

```bash
pi install npm:pi-local-mem
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["github:3DAlgoLab/pi-local-mem"]
}
```

Or project-local in `.pi/settings.json`:

```json
{
  "packages": ["github:3DAlgoLab/pi-local-mem"]
}
```

## Tools

| Tool | Description |
|------|-------------|
| `localmem_write` | Append entries or overwrite sections in LocalMem.md (duplicates skipped automatically) |
| `localmem_read` | Read entire LocalMem.md or a specific section |
| `localmem_search` | Search entries by keyword (case-insensitive) |
| `localmem_clean` | Remove duplicates and stale entries (supports dry run) |

## Configuration

In `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "localMem": {
    "enabled": true,
    "maxSizeKb": 8,
    "maxAgeDays": 90,
    "sections": ["Decisions", "Active Context", "Bugs & Fixes", "Changelog", "Patterns"],
    "autoInit": true,
    "injectContext": true
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable LocalMem |
| `maxSizeKb` | `8` | Max LocalMem.md size in KB before lightweight injection |
| `maxAgeDays` | `90` | Days before Changelog/Bugs entries are stale |
| `sections` | 5 defaults | Section names in order |
| `autoInit` | `true` | Auto-create LocalMem.md on first session |
| `injectContext` | `true` | Inject LocalMem.md content into system prompt |

## How It Works

1. **Session start** — Reads LocalMem.md, auto-creates if missing, adds to .gitignore if in git repo
2. **Every agent turn** — Injects LocalMem.md content into system prompt as `<localmem>` XML block
3. **Agent writes** — Uses `localmem_write` tool to append entries (duplicates are silently skipped)
4. **Clean** — Run `localmem_clean` to remove duplicates and stale entries

## License

MIT
