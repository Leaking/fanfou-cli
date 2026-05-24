---
name: fanfou
description: >-
  Read and write Fanfou (饭否) through the `fanfou` command-line tool. Use when the
  user wants to browse their Fanfou home/public/mentions timeline, post / reply /
  repost / delete a status (发饭/回复/转发), favorite (收藏), follow or search users,
  send direct messages (私信), or call any Fanfou API endpoint. Triggers on "饭否",
  "fanfou", "发饭", "刷饭", or requests mentioning the fanfou CLI.
---

# Fanfou (饭否) via the `fanfou` CLI

`fanfou` is an LLM-friendly command line over the Fanfou API. It prints **JSON to
stdout by default**, so parse stdout as JSON. Errors are JSON on **stderr** with a
non-zero exit code: `{ "error": { "type", "message", "status?", "body?", "hint?" } }`.

## Running the CLI

Install the CLI once, then call `fanfou` directly:

```bash
npm install -g fanfou      # global; or one-off without installing: npx fanfou <command>
fanfou <command> ...
```

(Developing from a clone? Node ≥ 22.6 runs the source with no build:
`node src/index.ts <command> ...`.)

Discover anything at runtime — every command supports `--help` (and
`--help --format json` returns a machine-readable schema of args/flags):

```bash
fanfou --help                 # top-level command list
fanfou status post --help     # text help for one command
fanfou timeline home --help --format json   # schema for tooling
```

## Three layers (pick the simplest that fits)

1. **Shortcuts** — `+`-prefixed, high-frequency, smart defaults:
   `+timeline`, `+post`, `+reply`, `+repost`, `+mentions`, `+me`, `+search`, `+fav`, `+dm`.
2. **Resource commands** — full coverage grouped by resource:
   `auth`, `timeline`, `status`, `favorite`, `user`, `friendship`, `dm`, `account`, `search`.
3. **Raw API** — `fanfou api <GET|POST> <path> [--query k=v&..] [--form k=v&..]`
   for any endpoint not covered above.

## Authentication (required for most commands)

Two flows are supported; tokens are stored per-profile under `~/.config/fanfou`.

```bash
# XAuth (simplest, recommended for automation): username + password
fanfou auth login -u <用户名/邮箱> -p <密码>
# or via env, to keep secrets out of argv / shell history:
FANFOU_USERNAME=... FANFOU_PASSWORD=... fanfou auth login

# OAuth web flow (two scriptable steps):
fanfou auth oauth-url                 # prints authorize_url + request token
#   -> open authorize_url in a browser, approve
fanfou auth oauth-exchange --token <request_token> --secret <request_token_secret> [--verifier <code>]

fanfou auth status      # check login state (no network)
fanfou auth whoami      # verify against the server
fanfou auth logout
```

Multiple accounts: `fanfou auth login --profile work ...`, then add
`--profile work` to any command, or `fanfou auth use work` to set the default.

## Common recipes

```bash
fanfou +timeline --count 10                 # home timeline, latest 10
fanfou timeline mentions --count 5          # who mentioned me
fanfou +post "今天天气不错"                   # post a status (≤140 chars)
fanfou +reply <status-id> "说得对"           # reply (auto-prepends @name)
fanfou +repost <status-id>                  # repost ("转@用户 原文" if no text)
fanfou status delete <status-id>            # delete your own status
fanfou +fav <status-id>                     # favorite
fanfou user show <login-id>                 # someone's profile
fanfou user follow <login-id>               # follow
fanfou +search "关键词"                       # search public statuses
fanfou +dm <login-id> "在吗"                 # send a direct message
fanfou api GET statuses/home_timeline.json --query count=3   # raw endpoint
```

### Output formats

`--format` / `-o`: `json` (default), `ndjson` (one object per line; good for
piping/streaming arrays), `table` (compact human summary), `raw` (response text
as-is). Example: `fanfou +timeline --format table`.

## Important behaviors & gotchas

- **JSON by default.** Parse stdout as JSON. On error, read the JSON on stderr and
  check the exit code (`2` usage, `3` auth-required, `1` other/HTTP).
- **Preview before writing.** Every state-changing command supports `--dry-run`
  (`-n`): it prints the exact signed request `{method,url,form,...}` without
  sending it. Use this to confirm a destructive call (e.g. `status delete`) first.
- **Status IDs can start with `-`** (e.g. `-A_ycI00_Kc`). The parser handles this,
  but if you ever build args dynamically and hit trouble, use `--` to end flag
  parsing: `fanfou status delete -- -A_ycI00_Kc`.
- **140-character limit** on statuses; longer text is rejected by the server.
- **`id` means loginname**, not the numeric/`rawid`. Pass the string `id` field.
- **Destructive ops** (`status delete`, `dm delete`, `user block`, `unfollow`)
  act on the live account — confirm intent, and prefer `--dry-run` to preview.
- **Reading is safe**; writing posts to the real account. Don't post test/spam
  content to a user's real account without being asked.

## Endpoint coverage map (resource command → Fanfou API)

| Command | API |
| --- | --- |
| `timeline home/public/user/mentions/context/photos` | `statuses/*_timeline`, `statuses/context_timeline`, `photos/user_timeline` |
| `status show/post/reply/repost/delete/photo` | `statuses/show`, `statuses/update`, `statuses/destroy`, `photos/upload` |
| `favorite list/add/remove` | `favorites`, `favorites/create/<id>`, `favorites/destroy/<id>` |
| `user show/friends/followers/follow/unfollow/search/block/unblock/blocks/blocked` | `users/*`, `friendships/create|destroy`, `search/users`, `blocks/*` |
| `friendship requests/accept/deny/exists` | `friendships/requests|accept|deny|exists` |
| `dm list/thread/inbox/sent/send/delete` | `direct_messages/*` |
| `account verify/notification/update-profile/update-avatar` | `account/*` |
| `search statuses/users` | `search/public_timeline`, `search/users` |
| anything else | `fanfou api <METHOD> <path>` |
