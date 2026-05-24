# Fanfou CLI — Claude Code guide

This repo is the `fanfou` command line for Fanfou (饭否) plus a bundled agent
skill. For how to run/use the CLI, the development commands, and the OAuth1
signing quirk, see:

@AGENTS.md

## Notes

- **Live account safety:** most write commands act on a real Fanfou account.
  Confirm intent and prefer `--dry-run` first; never post test/spam content to a
  user's account unless asked.
- **Fanfou replication lag:** a just-posted status can return 404 from
  `status show` / `status delete` for several minutes before it replicates.
