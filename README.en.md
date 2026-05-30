# 饭否 CLI (`fanfou`)

> [中文](README.md) | English

An **LLM-friendly** command line for the [Fanfou (饭否)](https://fanfou.com) API,
plus a bundled **agent skill** that works with Claude Code, Codex, Cursor, and
50+ other AI coding agents. JSON-by-default output, schema introspection,
dry-run previews, and a three-layer command surface (shortcuts / resource
commands / raw API).

## Requirements

- Node.js **≥ 22.6** (the CLI runs TypeScript directly via type-stripping — no build step needed).

## Install

```bash
# 1) The CLI (provides the `fanfou` command):
npm install -g fanfou          # or one-off, no install: npx fanfou <command>

# 2) The skill, into your AI agent(s) — via npx skills (GitHub as registry):
npx skills add Leaking/fanfou-cli -y -g
#    …or target specific agents (Claude Code, Codex, Cursor, 50+ more):
npx skills add Leaking/fanfou-cli --agent claude-code codex cursor
```

Run it:

```bash
fanfou --help
```

Developing from a clone (Node ≥ 22.6 runs the TypeScript directly — no build):

```bash
node src/index.ts --help
```

## Quick start

```bash
# 1) Log in (XAuth). Use env vars to keep secrets out of argv.
FANFOU_USERNAME='you@example.com' FANFOU_PASSWORD='••••••' fanfou auth login

# 2) Read your timeline
fanfou +timeline --count 10
fanfou +timeline --format table

# 3) Post / reply / repost
fanfou +post "Hello 饭否"
fanfou +reply <status-id> "说得对"
fanfou +repost <status-id>

# 4) Anything else, raw:
fanfou api GET statuses/mentions.json --query count=5
```

## Three layers

1. **Shortcuts** (`+timeline`, `+post`, `+reply`, `+repost`, `+mentions`, `+me`,
   `+search`, `+fav`, `+dm`) — high-frequency operations with smart defaults.
2. **Resource commands** — `auth`, `timeline`, `status`, `favorite`, `user`,
   `friendship`, `dm`, `account`, `search` (full Fanfou API coverage).
3. **Raw API** — `fanfou api <GET|POST> <path> [--query ...] [--form ...]`.

## Authentication

Two flows, stored per-profile under `~/.config/fanfou/config.json` (mode `0600`):

- **XAuth** (default): `fanfou auth login -u <name> -p <pass>`
- **OAuth web**: `fanfou auth oauth-url` → approve in browser →
  `fanfou auth oauth-exchange --token … --secret … [--verifier …]`

Env overrides (handy for CI / agents): `FANFOU_USERNAME`, `FANFOU_PASSWORD`,
`FANFOU_OAUTH_TOKEN`, `FANFOU_OAUTH_TOKEN_SECRET`, `FANFOU_CONSUMER_KEY`,
`FANFOU_CONSUMER_SECRET`, `FANFOU_PROFILE`, `FANFOU_CONFIG_DIR`.

Multiple accounts: pass `--profile <name>` to any command, or
`fanfou auth use <name>` to change the default.

## LLM / agent friendliness

- **JSON by default** on stdout; errors are JSON on stderr with exit codes
  (`2` usage, `3` auth-required, `1` other/HTTP).
- **Schema introspection**: `fanfou <cmd> --help --format json`.
- **Dry-run** (`--dry-run` / `-n`) on every state-changing command prints the
  exact signed request without sending it.
- **Output formats**: `--format json|ndjson|table|raw` (`-o`).
- Robust arg parsing for Fanfou IDs that begin with `-`.

## The bundled agent skill

A single, cross-agent skill lives at
[`skills/fanfou/SKILL.md`](skills/fanfou/SKILL.md). It is consumable by any
AI coding agent that supports the [skills](https://github.com/vercel-labs/skills)
convention — Claude Code, Codex, Cursor, Cline, Aider, Continue, and 50+ more.

Install it globally for all of your agents at once, or scope it to a specific
agent:

```bash
npx skills add Leaking/fanfou-cli -y -g                           # all agents
npx skills add Leaking/fanfou-cli --agent claude-code codex cursor # specific
```

From a local clone, you can also drop the skill into a Claude Code skills
directory directly (other agents typically use the `skills` CLI above):

```bash
npm run install-skill           # -> ./.claude/skills/fanfou (project)
npm run install-skill -- --user # -> ~/.claude/skills/fanfou (global)
```

## Develop

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test (OAuth1 signer vectors)
npm run build       # emit dist/
```

The OAuth1 HMAC-SHA1 signer matches the canonical RFC 5849 example signature
(pinned by `test/oauth1.test.ts`). Fanfou signs the base string over `http://`
even on HTTPS requests — the signer replicates that quirk.
