#!/usr/bin/env node
// Installs the bundled `fanfou` skill into a Claude Code skills directory.
//   node scripts/install-skill.mjs            -> ./.claude/skills/fanfou (project)
//   node scripts/install-skill.mjs --user     -> ~/.claude/skills/fanfou (global)
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "skills", "fanfou");

const user = process.argv.includes("--user");
const base = user ? join(homedir(), ".claude", "skills") : join(process.cwd(), ".claude", "skills");
const target = join(base, "fanfou");

mkdirSync(base, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Installed fanfou skill -> ${target}`);
console.log("提示：确保 fanfou 命令在 PATH 上（npm i -g），或 SKILL.md 中的 CLI 路径与你的安装位置一致。");
