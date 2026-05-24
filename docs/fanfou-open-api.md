# Fanfou (饭否) Open API — reference for `fanfou`

This is a practical reference for the Fanfou Open API as exercised by the
`fanfou` CLI. It is original notes written for this project; it is **not** the
official specification.

> **Authoritative upstream:** the community-maintained
> [`FanfouAPI/FanFouAPIDoc`](https://github.com/FanfouAPI/FanFouAPIDoc) and its
> [**wiki**](https://github.com/FanfouAPI/FanFouAPIDoc/wiki) (~89 pages, marked
> "功能已冻结" / frozen). When this doc and the wiki disagree, trust the wiki.
> That project carries no explicit license, so its text is **not** copied here —
> only linked. Endpoint behaviour below was derived from using the API.

## Basics

- **Base URL:** `https://api.fanfou.com`
- **Formats:** most endpoints take a trailing `.json` (XML also exists). `fanfou`
  uses JSON throughout.
- **Rate limit:** ~1500 requests/hour per authenticated user (and per IP for
  anonymous calls).
- **`id` means loginname.** Where an endpoint wants a user `id`, pass the string
  loginname, not the numeric `rawid`.
- **Status length:** 140 characters max; the server rejects longer text.

## Authentication

Fanfou uses **OAuth 1.0a (HMAC-SHA1)**. Two ways to obtain an access token:

| Flow | When | `fanfou` |
| --- | --- | --- |
| **XAuth** | automation / headless; exchanges username+password for a token directly | `fanfou auth login -u <name> -p <pass>` |
| **OAuth web** | interactive; user approves in a browser | `fanfou auth oauth-url` → approve → `fanfou auth oauth-exchange …` |

Signing quirk worth knowing: Fanfou computes the **signature base string over the
`http://` scheme** even when the request is sent over HTTPS. `fanfou`'s signer
(`src/oauth1.ts`) replicates this, and it is pinned by the RFC 5849 test vector
in `test/oauth1.test.ts`.

## Errors

Errors come back as JSON with an HTTP status and a message, e.g.
`{ "request": "/statuses/update.json", "error": "..." }`. `fanfou` normalizes
this to `{ "error": { "type", "message", "status?", "body?", "hint?" } }` on
stderr and sets a non-zero exit code.

## Endpoint map (Fanfou API → `fanfou` command)

| Fanfou API | `fanfou` |
| --- | --- |
| `statuses/home_timeline`, `public_timeline`, `user_timeline`, `mentions`, `context_timeline`; `photos/user_timeline` | `timeline home/public/user/mentions/context/photos` |
| `statuses/show`, `statuses/update`, `statuses/destroy`; `photos/upload` | `status show/post/reply/repost/delete/photo` |
| `favorites`, `favorites/create/<id>`, `favorites/destroy/<id>` | `favorite list/add/remove` |
| `users/show`, `users/friends`, `users/followers`; `friendships/create\|destroy`; `search/users`; `blocks/*` | `user show/friends/followers/follow/unfollow/search/block/unblock/blocks/blocked` |
| `friendships/requests\|accept\|deny\|exists` | `friendship requests/accept/deny/exists` |
| `direct_messages/*` | `dm list/thread/inbox/sent/send/delete` |
| `account/verify_credentials`, `account/notification`, `account/update_profile`, `account/update_profile_image` | `account verify/notification/update-profile/update-avatar` |
| `search/public_timeline`, `search/users` | `search statuses/users` |
| anything else | `fanfou api <GET\|POST> <path>` |

For exact parameters of any endpoint, see the upstream wiki linked above, or run
`fanfou <command> --help --format json` for the CLI's view of the arguments.
