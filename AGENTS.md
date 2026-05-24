# Fanfou (饭否) — Agent Guide

`fanfou` is an LLM-friendly command line over the [Fanfou (饭否)](https://fanfou.com)
API. This repository is the CLI itself plus a bundled agent skill at
`skills/fanfou/SKILL.md`.

## Run it

- Node **≥ 22.6** runs the TypeScript directly (no build): `node src/index.ts <command> ...`
- Or install the binary: `npm install && npm run build && npm link` → `fanfou ...`
- Every command supports `--help`, and `--help --format json` returns a
  machine-readable schema of its args/flags.

## Using the CLI (for agents)

- **Output is JSON on stdout by default.** Errors are JSON on stderr with exit
  codes: `2` usage, `3` auth-required, `1` other/HTTP. Parse stdout as JSON.
- **Three layers:** `+`-shortcuts (`+timeline`, `+post`, `+reply`, …), resource
  commands (`timeline`, `status`, `user`, `dm`, …), and a raw escape hatch
  `api <GET|POST> <path>`.
- **Auth:** `fanfou auth login -u <name> -p <pass>` (XAuth) or the OAuth web flow;
  tokens are stored per-profile under `~/.config/fanfou`.
- **Preview writes** with `--dry-run` before sending. Reading is safe; writing
  posts to a real account — don't post test/spam content without being asked.
- Full usage lives in `skills/fanfou/SKILL.md` and `README.md`.

## Developing this repo

- `npm install` — dev deps only (typescript, @types/node).
- `npm test` — `node:test` OAuth1 signer vectors.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — emit `dist/`.
- The OAuth1 HMAC-SHA1 signer (`src/oauth1.ts`) mirrors RFC 5849. Fanfou signs
  the signature base string over `http://` even on HTTPS requests — keep that
  quirk intact (it's verified by the test vectors).

## Fanfou API reference

See [`docs/fanfou-open-api.md`](docs/fanfou-open-api.md), which maps each CLI
command to its endpoint and links the authoritative community wiki.
