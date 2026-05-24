import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { FanfouClient, type TimelineParams, type UploadFile } from "./client.ts";
import { flagBool, flagNumber, flagString, type FlagValue } from "./args.ts";
import type { Command, CommandContext } from "./registry.ts";
import {
  clearProfile,
  listProfiles,
  resolveProfile,
  saveConfig,
  loadConfig,
  saveProfile,
  configDir,
} from "./config.ts";

// ---- shared helpers -----------------------------------------------------

function timelineParams(ctx: CommandContext, defaults: TimelineParams = {}): TimelineParams {
  return {
    id: flagString(ctx.flags, "id") ?? defaults.id,
    sinceId: flagString(ctx.flags, "since-id") ?? defaults.sinceId,
    maxId: flagString(ctx.flags, "max-id") ?? defaults.maxId,
    count: flagNumber(ctx.flags, "count") ?? defaults.count,
    page: flagNumber(ctx.flags, "page") ?? defaults.page,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function readUpload(path: string, fieldName: string): UploadFile {
  const data = readFileSync(path);
  const ext = extname(path).toLowerCase();
  return {
    fieldName,
    fileName: basename(path),
    mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream",
    data,
  };
}

function parseKv(value: string | undefined): Array<[string, string]> {
  if (!value) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of new URLSearchParams(value).entries()) out.push([k, v]);
  return out;
}

function requireArg(ctx: CommandContext, index: number, name: string): string {
  const value = ctx.args[index];
  if (value === undefined || value === "") {
    throw new UsageError(`缺少参数 <${name}> (missing argument)`);
  }
  return value;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const TIMELINE_FLAGS = [
  { name: "count", type: "number" as const, description: "Number of items to fetch" },
  { name: "since-id", type: "string" as const, description: "Only items newer than this id" },
  { name: "max-id", type: "string" as const, description: "Only items older than or equal to this id" },
  { name: "page", type: "number" as const, description: "Page number" },
  { name: "id", type: "string" as const, description: "Target user id (loginname)" },
];

// ---- run implementations (shared by full commands and shortcuts) --------

const runHome = (ctx: CommandContext) => ctx.client.homeTimeline(timelineParams(ctx));
const runPublic = (ctx: CommandContext) => ctx.client.publicTimeline(timelineParams(ctx));
const runUserTimeline = (ctx: CommandContext) => ctx.client.userTimeline(timelineParams(ctx));
const runMentions = (ctx: CommandContext) => ctx.client.mentions(timelineParams(ctx));

async function runPost(ctx: CommandContext): Promise<unknown> {
  const text = requireArg(ctx, 0, "text");
  return ctx.client.updateStatus({
    status: text,
    inReplyToStatusId: flagString(ctx.flags, "reply-to-status"),
    inReplyToUserId: flagString(ctx.flags, "reply-to-user"),
    repostStatusId: flagString(ctx.flags, "repost-status"),
    location: flagString(ctx.flags, "location"),
  });
}

async function runReply(ctx: CommandContext): Promise<unknown> {
  const id = requireArg(ctx, 0, "status-id");
  const text = requireArg(ctx, 1, "text");
  let replyUserId = flagString(ctx.flags, "reply-to-user");
  let finalText = text;
  if (!ctx.dryRun) {
    const original = (await ctx.client.showStatus(id)) as { user?: { id?: string; name?: string } };
    replyUserId = replyUserId ?? original.user?.id;
    const name = original.user?.name;
    if (name && !text.includes(`@${name}`)) finalText = `@${name} ${text}`;
  }
  return ctx.client.updateStatus({ status: finalText, inReplyToStatusId: id, inReplyToUserId: replyUserId });
}

async function runRepost(ctx: CommandContext): Promise<unknown> {
  const id = requireArg(ctx, 0, "status-id");
  let text = ctx.args[1];
  if (!text) {
    if (ctx.dryRun) {
      text = "转发";
    } else {
      const original = (await ctx.client.showStatus(id)) as { user?: { name?: string }; text?: string };
      text = `转@${original.user?.name ?? ""} ${original.text ?? ""}`.trim();
    }
  }
  return ctx.client.updateStatus({ status: text, repostStatusId: id });
}

async function runMe(ctx: CommandContext): Promise<unknown> {
  return ctx.client.verifyCredentials();
}

const runSearchStatuses = (ctx: CommandContext) =>
  ctx.client.searchPublicTimeline(requireArg(ctx, 0, "query"), timelineParams(ctx));
const runSearchUsers = (ctx: CommandContext) =>
  ctx.client.searchUsers(requireArg(ctx, 0, "query"), {
    count: flagNumber(ctx.flags, "count"),
    page: flagNumber(ctx.flags, "page"),
  });

const runFavAdd = (ctx: CommandContext) => ctx.client.createFavorite(requireArg(ctx, 0, "status-id"));
const runDmSend = (ctx: CommandContext) =>
  ctx.client.sendDirectMessage({
    user: requireArg(ctx, 0, "user-id"),
    text: requireArg(ctx, 1, "text"),
    inReplyToId: flagString(ctx.flags, "reply-to"),
  });

// ---- auth commands ------------------------------------------------------

async function runLogin(ctx: CommandContext): Promise<unknown> {
  if (flagBool(ctx.flags, "web")) return runWebLoginInteractive(ctx);

  let username = flagString(ctx.flags, "username") ?? process.env.FANFOU_USERNAME;
  let password = flagString(ctx.flags, "password") ?? process.env.FANFOU_PASSWORD;
  if (flagBool(ctx.flags, "password-stdin")) {
    password = (await readAllStdin()).trim();
  }
  if (!username || !password) {
    throw new UsageError(
      "请提供 --username 和 --password（或设置 FANFOU_USERNAME / FANFOU_PASSWORD，或用 --web 走网页授权）",
    );
  }
  const { token, secret } = await ctx.client.xauthLogin(username, password);
  return finalizeLogin(ctx, token, secret);
}

async function finalizeLogin(ctx: CommandContext, token: string, secret: string): Promise<unknown> {
  const { profile } = resolveProfile(ctx.profileName);
  const verifyClient = new FanfouClient({
    consumerKey: profile.consumerKey!,
    consumerSecret: profile.consumerSecret!,
    token,
    tokenSecret: secret,
  });
  const user = (await verifyClient.verifyCredentials()) as { id?: string; name?: string; screen_name?: string };
  saveProfile(ctx.profileName, {
    consumerKey: profile.consumerKey,
    consumerSecret: profile.consumerSecret,
    token,
    tokenSecret: secret,
    user: { id: user.id, name: user.name, screenName: user.screen_name },
  });
  return { ok: true, profile: ctx.profileName, user: { id: user.id, name: user.name } };
}

async function runOAuthUrl(ctx: CommandContext): Promise<unknown> {
  const callback = flagString(ctx.flags, "callback") ?? "oob";
  const { token, secret } = await ctx.client.requestToken(callback);
  return {
    authorize_url: ctx.client.authorizeURL(token, callback === "oob" ? undefined : callback),
    request_token: token,
    request_token_secret: secret,
    next: "在浏览器中打开 authorize_url 完成授权，然后运行：fanfou auth oauth-exchange --token <request_token> --secret <request_token_secret> [--verifier <code>]",
  };
}

async function runOAuthExchange(ctx: CommandContext): Promise<unknown> {
  const token = flagString(ctx.flags, "token");
  const secret = flagString(ctx.flags, "secret");
  if (!token || !secret) throw new UsageError("请提供 --token 和 --secret（来自 oauth-url 的输出）");
  const verifier = flagString(ctx.flags, "verifier");
  const access = await ctx.client.accessToken(token, secret, verifier);
  return finalizeLogin(ctx, access.token, access.secret);
}

async function runWebLoginInteractive(ctx: CommandContext): Promise<unknown> {
  const { token, secret } = await ctx.client.requestToken("oob");
  const url = ctx.client.authorizeURL(token);
  process.stderr.write(`请在浏览器打开以下链接完成授权：\n${url}\n`);
  if (!process.stdin.isTTY) {
    return {
      authorize_url: url,
      request_token: token,
      request_token_secret: secret,
      next: "非交互环境：授权后运行 fanfou auth oauth-exchange --token ... --secret ... [--verifier ...]",
    };
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const verifier = (await rl.question("授权完成后粘贴 verifier（没有就直接回车）: ")).trim();
  rl.close();
  const access = await ctx.client.accessToken(token, secret, verifier || undefined);
  return finalizeLogin(ctx, access.token, access.secret);
}

function runLogout(ctx: CommandContext): unknown {
  clearProfile(ctx.profileName);
  return { ok: true, profile: ctx.profileName, message: "已退出登录" };
}

function runAuthStatus(ctx: CommandContext): unknown {
  const { name, profile } = resolveProfile(ctx.profileName);
  return {
    profile: name,
    authenticated: Boolean(profile.token && profile.tokenSecret),
    user: profile.user,
    consumerKey: profile.consumerKey,
    configDir: configDir(),
  };
}

function runProfilesList(): unknown {
  return listProfiles();
}

function runUseProfile(ctx: CommandContext): unknown {
  const name = requireArg(ctx, 0, "profile");
  const config = loadConfig();
  config.currentProfile = name;
  saveConfig(config);
  return { ok: true, currentProfile: name };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// ---- raw api command ----------------------------------------------------

async function runApi(ctx: CommandContext): Promise<unknown> {
  const method = requireArg(ctx, 0, "method").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new UsageError("method 必须是 GET 或 POST");
  const path = requireArg(ctx, 1, "path");
  const base = (flagString(ctx.flags, "base") as "api" | "oauth" | undefined) ?? "api";
  const query = parseKv(flagString(ctx.flags, "query"));
  const form = parseKv(flagString(ctx.flags, "form"));
  if (flagBool(ctx.flags, "raw")) {
    const { text, plan } = await ctx.client.request({ base, path, method, query, form });
    return ctx.dryRun ? { dryRun: true, request: plan } : text;
  }
  return ctx.client.requestJSON({ base, path, method, query, form });
}

// ---- command tree -------------------------------------------------------

export function buildRootCommand(): Command {
  const timeline: Command = {
    name: "timeline",
    summary: "时间线：关注/公开/某人/提到我",
    subcommands: [
      {
        name: "home",
        summary: "关注时间线（首页刷饭）",
        flags: TIMELINE_FLAGS,
        requiresAuth: true,
        run: runHome,
        examples: ["fanfou timeline home --count 10", "fanfou +timeline"],
      },
      { name: "public", summary: "公开时间线", flags: TIMELINE_FLAGS, run: runPublic },
      {
        name: "user",
        summary: "某个用户的消息时间线",
        flags: TIMELINE_FLAGS,
        requiresAuth: true,
        run: runUserTimeline,
        examples: ["fanfou timeline user --id someone --count 20"],
      },
      { name: "mentions", summary: "提到我的消息", flags: TIMELINE_FLAGS, requiresAuth: true, run: runMentions },
      {
        name: "context",
        summary: "一条消息的上下文时间线",
        args: [{ name: "status-id", description: "消息 id", required: true }],
        requiresAuth: true,
        run: (ctx) => ctx.client.contextTimeline(requireArg(ctx, 0, "status-id")),
      },
      { name: "photos", summary: "用户的照片时间线", flags: TIMELINE_FLAGS, requiresAuth: true, run: (ctx) => ctx.client.photoUserTimeline(timelineParams(ctx)) },
    ],
  };

  const status: Command = {
    name: "status",
    summary: "消息：查看/发布/回复/转发/删除",
    subcommands: [
      {
        name: "show",
        summary: "查看一条消息",
        args: [{ name: "status-id", description: "消息 id", required: true }],
        requiresAuth: true,
        run: (ctx) => ctx.client.showStatus(requireArg(ctx, 0, "status-id")),
      },
      {
        name: "post",
        summary: "发布一条消息（发饭）",
        args: [{ name: "text", description: "消息正文（≤140字）", required: true }],
        flags: [
          { name: "reply-to-status", type: "string", description: "回复的消息 id" },
          { name: "reply-to-user", type: "string", description: "回复的用户 id" },
          { name: "repost-status", type: "string", description: "转发的消息 id" },
          { name: "location", type: "string", description: "位置" },
        ],
        requiresAuth: true,
        mutates: true,
        run: runPost,
        examples: ['fanfou status post "今天天气不错"', 'fanfou +post "Hello 饭否"'],
      },
      {
        name: "reply",
        summary: "回复一条消息（自动补全 @用户 与 in_reply_to）",
        args: [
          { name: "status-id", description: "被回复的消息 id", required: true },
          { name: "text", description: "回复正文", required: true },
        ],
        flags: [{ name: "reply-to-user", type: "string", description: "覆盖回复的用户 id" }],
        requiresAuth: true,
        mutates: true,
        run: runReply,
        examples: ['fanfou status reply <id> "说得对"'],
      },
      {
        name: "repost",
        summary: "转发一条消息（不带正文则生成「转@用户 原文」）",
        args: [
          { name: "status-id", description: "被转发的消息 id", required: true },
          { name: "text", description: "转发附言（可选）" },
        ],
        requiresAuth: true,
        mutates: true,
        run: runRepost,
      },
      {
        name: "delete",
        summary: "删除自己的一条消息",
        args: [{ name: "status-id", description: "消息 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.destroyStatus(requireArg(ctx, 0, "status-id")),
      },
      {
        name: "photo",
        summary: "上传图片并发布消息",
        args: [
          { name: "image-path", description: "本地图片路径", required: true },
          { name: "text", description: "消息正文", required: true },
        ],
        flags: [{ name: "location", type: "string", description: "位置" }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) =>
          ctx.client.uploadPhoto(
            readUpload(requireArg(ctx, 0, "image-path"), "photo"),
            requireArg(ctx, 1, "text"),
            flagString(ctx.flags, "location"),
          ),
      },
    ],
  };

  const favorite: Command = {
    name: "favorite",
    summary: "收藏：列表/添加/移除",
    subcommands: [
      {
        name: "list",
        summary: "收藏列表",
        flags: [
          { name: "id", type: "string", description: "目标用户 id（默认自己）" },
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) =>
          ctx.client.favorites({
            id: flagString(ctx.flags, "id"),
            count: flagNumber(ctx.flags, "count"),
            page: flagNumber(ctx.flags, "page"),
          }),
      },
      {
        name: "add",
        summary: "收藏一条消息",
        args: [{ name: "status-id", description: "消息 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: runFavAdd,
      },
      {
        name: "remove",
        summary: "取消收藏",
        args: [{ name: "status-id", description: "消息 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.destroyFavorite(requireArg(ctx, 0, "status-id")),
      },
    ],
  };

  const user: Command = {
    name: "user",
    summary: "用户：资料/关注/粉丝/关注关系/拉黑",
    subcommands: [
      {
        name: "show",
        summary: "查看用户资料（缺省查看自己）",
        args: [{ name: "id", description: "用户 id（loginname），缺省为自己" }],
        requiresAuth: true,
        run: (ctx) => ctx.client.showUser(ctx.args[0] ?? flagString(ctx.flags, "id")),
        examples: ["fanfou user show", "fanfou user show someone"],
      },
      {
        name: "friends",
        summary: "某人的关注列表",
        flags: [
          { name: "id", type: "string", description: "用户 id（默认自己）" },
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) =>
          ctx.client.friends({ id: flagString(ctx.flags, "id"), count: flagNumber(ctx.flags, "count"), page: flagNumber(ctx.flags, "page") }),
      },
      {
        name: "followers",
        summary: "某人的粉丝列表",
        flags: [
          { name: "id", type: "string", description: "用户 id（默认自己）" },
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) =>
          ctx.client.followers({ id: flagString(ctx.flags, "id"), count: flagNumber(ctx.flags, "count"), page: flagNumber(ctx.flags, "page") }),
      },
      {
        name: "follow",
        summary: "关注用户",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.followUser(requireArg(ctx, 0, "id")),
      },
      {
        name: "unfollow",
        summary: "取消关注",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.unfollowUser(requireArg(ctx, 0, "id")),
      },
      {
        name: "search",
        summary: "搜索饭友",
        args: [{ name: "query", description: "关键词", required: true }],
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: runSearchUsers,
      },
      {
        name: "block",
        summary: "拉黑用户",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.blockUser(requireArg(ctx, 0, "id")),
      },
      {
        name: "unblock",
        summary: "取消拉黑",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.unblockUser(requireArg(ctx, 0, "id")),
      },
      {
        name: "blocks",
        summary: "黑名单列表",
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) => ctx.client.blockedUsers({ count: flagNumber(ctx.flags, "count"), page: flagNumber(ctx.flags, "page") }),
      },
      {
        name: "blocked",
        summary: "检查是否已拉黑某用户",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        run: async (ctx) => ({ id: ctx.args[0], blocked: await ctx.client.isBlocked(requireArg(ctx, 0, "id")) }),
      },
    ],
  };

  const friendship: Command = {
    name: "friendship",
    summary: "关注关系：请求/接受/拒绝/校验",
    subcommands: [
      {
        name: "requests",
        summary: "待处理的关注请求",
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) => ctx.client.friendshipRequests({ count: flagNumber(ctx.flags, "count"), page: flagNumber(ctx.flags, "page") }),
      },
      {
        name: "accept",
        summary: "接受关注请求",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.acceptFriendship(requireArg(ctx, 0, "id")),
      },
      {
        name: "deny",
        summary: "拒绝关注请求",
        args: [{ name: "id", description: "用户 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.denyFriendship(requireArg(ctx, 0, "id")),
      },
      {
        name: "exists",
        summary: "判断 A 是否关注了 B",
        args: [
          { name: "user-a", description: "用户 A", required: true },
          { name: "user-b", description: "用户 B", required: true },
        ],
        requiresAuth: true,
        run: async (ctx) => ({
          user_a: ctx.args[0],
          user_b: ctx.args[1],
          follows: await ctx.client.friendshipExists(requireArg(ctx, 0, "user-a"), requireArg(ctx, 1, "user-b")),
        }),
      },
    ],
  };

  const dm: Command = {
    name: "dm",
    summary: "私信：会话/收发/删除",
    subcommands: [
      {
        name: "list",
        summary: "会话列表",
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: (ctx) => ctx.client.conversationList({ count: flagNumber(ctx.flags, "count"), page: flagNumber(ctx.flags, "page") }),
      },
      {
        name: "thread",
        summary: "与某人的私信会话",
        args: [{ name: "user-id", description: "对方用户 id", required: true }],
        flags: TIMELINE_FLAGS,
        requiresAuth: true,
        run: (ctx) => ctx.client.conversation(requireArg(ctx, 0, "user-id"), timelineParams(ctx)),
      },
      { name: "inbox", summary: "收件箱", flags: TIMELINE_FLAGS, requiresAuth: true, run: (ctx) => ctx.client.inbox(timelineParams(ctx)) },
      { name: "sent", summary: "发件箱", flags: TIMELINE_FLAGS, requiresAuth: true, run: (ctx) => ctx.client.sent(timelineParams(ctx)) },
      {
        name: "send",
        summary: "发送私信",
        args: [
          { name: "user-id", description: "对方用户 id", required: true },
          { name: "text", description: "私信内容", required: true },
        ],
        flags: [{ name: "reply-to", type: "string", description: "回复的私信 id" }],
        requiresAuth: true,
        mutates: true,
        run: runDmSend,
      },
      {
        name: "delete",
        summary: "删除一条私信",
        args: [{ name: "id", description: "私信 id", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.deleteDirectMessage(requireArg(ctx, 0, "id")),
      },
    ],
  };

  const account: Command = {
    name: "account",
    summary: "账号：校验/通知数/资料/头像",
    subcommands: [
      { name: "verify", summary: "校验当前登录用户", requiresAuth: true, run: runMe },
      { name: "notification", summary: "未读通知计数", requiresAuth: true, run: (ctx) => ctx.client.notification() },
      {
        name: "update-profile",
        summary: "更新个人资料",
        flags: [
          { name: "name", type: "string", description: "昵称" },
          { name: "location", type: "string", description: "位置" },
          { name: "url", type: "string", description: "主页" },
          { name: "description", type: "string", description: "简介" },
        ],
        requiresAuth: true,
        mutates: true,
        run: (ctx) =>
          ctx.client.updateProfile({
            name: flagString(ctx.flags, "name"),
            location: flagString(ctx.flags, "location"),
            url: flagString(ctx.flags, "url"),
            description: flagString(ctx.flags, "description"),
          }),
      },
      {
        name: "update-avatar",
        summary: "更换头像",
        args: [{ name: "image-path", description: "本地图片路径", required: true }],
        requiresAuth: true,
        mutates: true,
        run: (ctx) => ctx.client.updateProfileImage(readUpload(requireArg(ctx, 0, "image-path"), "image")),
      },
    ],
  };

  const search: Command = {
    name: "search",
    summary: "搜索：公开消息/饭友",
    subcommands: [
      {
        name: "statuses",
        summary: "搜索公开消息",
        args: [{ name: "query", description: "关键词", required: true }],
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "since-id", type: "string", description: "起始 id" },
          { name: "max-id", type: "string", description: "结束 id" },
        ],
        run: runSearchStatuses,
      },
      {
        name: "users",
        summary: "搜索饭友",
        args: [{ name: "query", description: "关键词", required: true }],
        flags: [
          { name: "count", type: "number", description: "数量" },
          { name: "page", type: "number", description: "页码" },
        ],
        requiresAuth: true,
        run: runSearchUsers,
      },
    ],
  };

  const auth: Command = {
    name: "auth",
    summary: "登录鉴权：XAuth / OAuth 网页授权 / 多账号",
    subcommands: [
      {
        name: "login",
        summary: "用账号密码登录（XAuth），或加 --web 走网页授权",
        flags: [
          { name: "username", alias: "u", type: "string", description: "饭否用户名/邮箱" },
          { name: "password", alias: "p", type: "string", description: "密码" },
          { name: "password-stdin", type: "boolean", description: "从标准输入读取密码" },
          { name: "web", type: "boolean", description: "改用 OAuth 网页授权流程" },
        ],
        run: runLogin,
        examples: [
          'fanfou auth login -u myname -p "secret"',
          "FANFOU_USERNAME=... FANFOU_PASSWORD=... fanfou auth login",
          "fanfou auth login --web",
        ],
      },
      {
        name: "oauth-url",
        summary: "OAuth 第一步：获取授权链接与 request token",
        flags: [{ name: "callback", type: "string", description: "回调地址（默认 oob）" }],
        run: runOAuthUrl,
      },
      {
        name: "oauth-exchange",
        summary: "OAuth 第二步：用授权后的 request token 换取 access token",
        flags: [
          { name: "token", type: "string", description: "request token", required: true },
          { name: "secret", type: "string", description: "request token secret", required: true },
          { name: "verifier", type: "string", description: "授权后拿到的 verifier（如有）" },
        ],
        run: runOAuthExchange,
      },
      { name: "logout", summary: "退出当前 profile 的登录", run: runLogout },
      { name: "status", summary: "查看当前登录状态（不联网）", run: runAuthStatus },
      { name: "whoami", summary: "校验并返回当前登录用户", requiresAuth: true, run: runMe },
      { name: "profiles", summary: "列出所有账号 profile", run: runProfilesList },
      {
        name: "use",
        summary: "切换当前默认 profile",
        args: [{ name: "profile", description: "profile 名称", required: true }],
        run: runUseProfile,
      },
    ],
  };

  const api: Command = {
    name: "api",
    summary: "直连任意饭否 API 端点（底层逃生通道）",
    description:
      "对任意 Fanfou REST 端点发起已签名的请求。method 为 GET/POST，path 形如 statuses/home_timeline.json。",
    args: [
      { name: "method", description: "GET 或 POST", required: true },
      { name: "path", description: "API 路径，如 statuses/home_timeline.json", required: true },
    ],
    flags: [
      { name: "query", type: "string", description: "查询参数，k=v&k2=v2 形式" },
      { name: "form", type: "string", description: "POST 表单参数，k=v&k2=v2 形式" },
      { name: "base", type: "string", description: "api（默认）或 oauth" },
      { name: "raw", type: "boolean", description: "原样输出响应文本，不解析 JSON" },
    ],
    requiresAuth: true,
    mutates: true,
    run: runApi,
    examples: [
      "fanfou api GET statuses/home_timeline.json --query count=5",
      'fanfou api POST statuses/update.json --form "status=hi&source=fanfou-cli"',
    ],
  };

  // Shortcuts (layer 1): + prefixed convenience commands with smart defaults.
  const shortcuts: Command[] = [
    {
      name: "+timeline",
      summary: "快捷：关注时间线（默认 20 条）",
      flags: TIMELINE_FLAGS,
      requiresAuth: true,
      run: (ctx) => ctx.client.homeTimeline(timelineParams(ctx, { count: 20 })),
    },
    {
      name: "+post",
      summary: "快捷：发布一条消息",
      args: [{ name: "text", description: "消息正文", required: true }],
      requiresAuth: true,
      mutates: true,
      run: runPost,
    },
    {
      name: "+reply",
      summary: "快捷：回复一条消息",
      args: [
        { name: "status-id", description: "被回复的消息 id", required: true },
        { name: "text", description: "回复正文", required: true },
      ],
      requiresAuth: true,
      mutates: true,
      run: runReply,
    },
    {
      name: "+repost",
      summary: "快捷：转发一条消息",
      args: [
        { name: "status-id", description: "被转发的消息 id", required: true },
        { name: "text", description: "附言（可选）" },
      ],
      requiresAuth: true,
      mutates: true,
      run: runRepost,
    },
    { name: "+mentions", summary: "快捷：提到我的消息", flags: TIMELINE_FLAGS, requiresAuth: true, run: (ctx) => ctx.client.mentions(timelineParams(ctx, { count: 20 })) },
    { name: "+me", summary: "快捷：我的资料", requiresAuth: true, run: runMe },
    {
      name: "+search",
      summary: "快捷：搜索公开消息",
      args: [{ name: "query", description: "关键词", required: true }],
      run: runSearchStatuses,
    },
    {
      name: "+fav",
      summary: "快捷：收藏一条消息",
      args: [{ name: "status-id", description: "消息 id", required: true }],
      requiresAuth: true,
      mutates: true,
      run: runFavAdd,
    },
    {
      name: "+dm",
      summary: "快捷：发送私信",
      args: [
        { name: "user-id", description: "对方用户 id", required: true },
        { name: "text", description: "私信内容", required: true },
      ],
      requiresAuth: true,
      mutates: true,
      run: runDmSend,
    },
  ];

  return {
    name: "fanfou",
    summary: "面向大模型友好的饭否（Fanfou）命令行",
    description:
      "三层结构：① + 开头的快捷命令（高频，自带默认值）；② 资源子命令（timeline/status/user/dm/...）；③ api 直连任意端点。默认输出 JSON，便于程序与 Agent 解析。",
    subcommands: [auth, timeline, status, favorite, user, friendship, dm, account, search, api, ...shortcuts],
    examples: [
      "fanfou auth login -u <name> -p <pass>",
      "fanfou +timeline",
      'fanfou +post "Hello 饭否"',
      "fanfou timeline mentions --count 5 --format table",
      "fanfou api GET users/show.json --query id=someone",
    ],
  };
}
