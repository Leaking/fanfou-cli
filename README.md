# 饭否 CLI (`fanfou`)

> 中文 | [English](README.en.md)

一个**对 LLM 友好**的 [饭否](https://fanfou.com) API 命令行工具，并附带一个开箱即用的
**agent skill**，可在 Claude Code、Codex、Cursor 等 50+ AI 编程助手中使用。默认输出
JSON、支持 schema 自省、支持 dry-run 预览，命令分三层组织（快捷指令 / 资源命令 / 原始 API）。

## 环境要求

- Node.js **≥ 22.6**（CLI 通过 type-stripping 直接运行 TypeScript，无需构建）。

## 安装

```bash
# 1) 安装 CLI（提供 `fanfou` 命令）：
npm install -g fanfou          # 或者一次性运行，无需安装：npx fanfou <command>

# 2) 把 skill 安装到你的 AI agent — 通过 npx skills（GitHub 即注册中心）：
npx skills add Leaking/fanfou-cli -y -g
#    …或只装到指定 agent（支持 Claude Code、Codex、Cursor 等 50+ 种）：
npx skills add Leaking/fanfou-cli --agent claude-code codex cursor
```

试运行：

```bash
fanfou --help
```

从源码开发（Node ≥ 22.6 直接运行 TypeScript，无需 build）：

```bash
node src/index.ts --help
```

## 快速开始

```bash
# 1) 登录（XAuth）。用环境变量避免密码出现在 argv / 命令历史里。
FANFOU_USERNAME='you@example.com' FANFOU_PASSWORD='••••••' fanfou auth login

# 2) 看时间线
fanfou +timeline --count 10
fanfou +timeline --format table

# 3) 发饭 / 回复 / 转发
fanfou +post "Hello 饭否"
fanfou +reply <status-id> "说得对"
fanfou +repost <status-id>

# 4) 其它任意接口（原始调用）：
fanfou api GET statuses/mentions.json --query count=5
```

## 三层命令结构

1. **快捷指令**（`+timeline`、`+post`、`+reply`、`+repost`、`+mentions`、`+me`、
   `+search`、`+fav`、`+dm`）— 高频操作，自带合理默认值。
2. **资源命令** — `auth`、`timeline`、`status`、`favorite`、`user`、`friendship`、
   `dm`、`account`、`search`（完整覆盖饭否 API）。
3. **原始 API** — `fanfou api <GET|POST> <path> [--query ...] [--form ...]`。

## 认证

两种登录方式，token 按 profile 存放在 `~/.config/fanfou/config.json`（权限 `0600`）：

- **XAuth**（默认）：`fanfou auth login -u <用户名> -p <密码>`
- **OAuth 网页授权**：`fanfou auth oauth-url` → 浏览器授权 →
  `fanfou auth oauth-exchange --token … --secret … [--verifier …]`

环境变量（适合 CI / agent 场景）：`FANFOU_USERNAME`、`FANFOU_PASSWORD`、
`FANFOU_OAUTH_TOKEN`、`FANFOU_OAUTH_TOKEN_SECRET`、`FANFOU_CONSUMER_KEY`、
`FANFOU_CONSUMER_SECRET`、`FANFOU_PROFILE`、`FANFOU_CONFIG_DIR`。

多账号：任意命令加 `--profile <名称>`，或用 `fanfou auth use <名称>` 切换默认 profile。

## LLM / Agent 友好性

- **默认输出 JSON** 到 stdout；错误以 JSON 形式写到 stderr，并带退出码（`2` 参数错误、
  `3` 需要登录、`1` 其它/HTTP 错误）。
- **Schema 自省**：`fanfou <cmd> --help --format json`。
- **Dry-run**（`--dry-run` / `-n`）：所有会改状态的命令都支持，打印将要发送的签名请求
  内容但不实际发送。
- **多种输出格式**：`--format json|ndjson|table|raw`（短选项 `-o`）。
- 健壮的参数解析，正确处理以 `-` 开头的饭否 ID。

## 自带的 agent skill

仓库内置了一份跨 agent 的 skill：[`skills/fanfou/SKILL.md`](skills/fanfou/SKILL.md)。
任何遵循 [skills](https://github.com/vercel-labs/skills) 约定的 AI 编程助手都能直接消费
—— Claude Code、Codex、Cursor、Cline、Aider、Continue 等 50+ 种。

一次性安装到所有 agent，或只安装到指定 agent：

```bash
npx skills add Leaking/fanfou-cli -y -g                           # 所有 agent
npx skills add Leaking/fanfou-cli --agent claude-code codex cursor # 指定 agent
```

从本地 clone 也可以直接把 skill 放到 Claude Code 的 skills 目录（其他 agent 通常用上
面的 `skills` CLI）：

```bash
npm run install-skill           # -> ./.claude/skills/fanfou（项目级）
npm run install-skill -- --user # -> ~/.claude/skills/fanfou（用户级）
```

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test（OAuth1 签名向量测试）
npm run build       # 产物输出到 dist/
```

OAuth1 HMAC-SHA1 签名实现与 RFC 5849 的标准样例一致（由 `test/oauth1.test.ts`
锁定）。一个饭否特有的怪癖：即使请求走 HTTPS，签名 base string 里仍然要把 scheme
写成 `http://` —— 本实现保留了这个行为。
