import { authorizationHeader, fanfouSignatureURL, percentEncode, type Pair } from "./oauth1.ts";

export type Json = any;

export type HttpMethod = "GET" | "POST";

export class FanfouHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "FanfouHttpError";
    this.status = status;
    this.body = body;
  }
}

export interface UploadFile {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface RequestOptions {
  base?: "api" | "oauth";
  path: string;
  method: HttpMethod;
  query?: Array<[string, string | undefined | null]>;
  form?: Array<[string, string | undefined | null]>;
  multipart?: Array<[string, string]>;
  file?: UploadFile;
  oauthExtra?: Pair[];
}

export interface RequestPlan {
  method: HttpMethod;
  url: string;
  query: Record<string, string>;
  form?: Record<string, string>;
  multipartFields?: Record<string, string>;
  file?: { fieldName: string; fileName: string; mimeType: string; bytes: number };
  authorization: string;
}

export interface ClientConfig {
  apiBaseURL?: string;
  oauthBaseURL?: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  dryRun?: boolean;
  userAgent?: string;
  source?: string;
  timeoutMs?: number;
}

function compact(pairs?: Array<[string, string | undefined | null]>): Pair[] {
  if (!pairs) return [];
  const out: Pair[] = [];
  for (const [k, v] of pairs) {
    if (v !== undefined && v !== null && v !== "") out.push([k, v]);
  }
  return out;
}

export class FanfouClient {
  private apiBaseURL: string;
  private oauthBaseURL: string;
  private consumerKey: string;
  private consumerSecret: string;
  private token?: string;
  private tokenSecret?: string;
  private dryRun: boolean;
  private userAgent: string;
  readonly source: string;
  private timeoutMs: number;

  constructor(config: ClientConfig) {
    this.apiBaseURL = config.apiBaseURL ?? "https://api.fanfou.com/";
    this.oauthBaseURL = config.oauthBaseURL ?? "https://fanfou.com/";
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.token = config.token;
    this.tokenSecret = config.tokenSecret;
    this.dryRun = config.dryRun ?? false;
    this.userAgent = config.userAgent ?? "fanfou-cli/0.1";
    this.source = config.source ?? "fanfou-cli";
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  get isAuthenticated(): boolean {
    return Boolean(this.token && this.tokenSecret);
  }

  private buildURL(base: string, path: string, query: Pair[]): URL {
    const url = new URL(path.replace(/^\//, ""), base);
    for (const [k, v] of query) url.searchParams.append(k, v);
    return url;
  }

  /** Builds the signed request description without performing it (used by --dry-run). */
  plan(opts: RequestOptions): RequestPlan {
    const base = opts.base === "oauth" ? this.oauthBaseURL : this.apiBaseURL;
    const query = compact(opts.query);
    const form = compact(opts.form);
    const url = this.buildURL(base, opts.path, query);
    const bodyForSignature = opts.file ? [] : form;
    const authorization = authorizationHeader({
      method: opts.method,
      url,
      consumerKey: this.consumerKey,
      consumerSecret: this.consumerSecret,
      token: this.token,
      tokenSecret: this.tokenSecret ?? "",
      extraParameters: opts.oauthExtra ?? [],
      bodyParameters: bodyForSignature,
      signatureURL: fanfouSignatureURL(url),
    });
    const plan: RequestPlan = {
      method: opts.method,
      url: url.toString(),
      query: Object.fromEntries(query),
      authorization,
    };
    if (opts.file) {
      plan.multipartFields = Object.fromEntries(compact(opts.multipart));
      plan.file = {
        fieldName: opts.file.fieldName,
        fileName: opts.file.fileName,
        mimeType: opts.file.mimeType,
        bytes: opts.file.data.length,
      };
    } else if (form.length > 0) {
      plan.form = Object.fromEntries(form);
    }
    return plan;
  }

  async request(opts: RequestOptions): Promise<{ status: number; text: string; plan: RequestPlan }> {
    const plan = this.plan(opts);
    if (this.dryRun) {
      return { status: 0, text: "", plan };
    }

    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
      Authorization: plan.authorization,
    };

    let body: string | FormData | undefined;
    if (opts.file) {
      const fd = new FormData();
      for (const [k, v] of compact(opts.multipart)) fd.append(k, v);
      fd.append(
        opts.file.fieldName,
        new Blob([new Uint8Array(opts.file.data)], { type: opts.file.mimeType }),
        opts.file.fileName,
      );
      body = fd;
    } else {
      const form = compact(opts.form);
      if (form.length > 0) {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
        body = form.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join("&");
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(plan.url, {
        method: opts.method,
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new FanfouHttpError(response.status, text);
    }
    return { status: response.status, text, plan };
  }

  async requestJSON(opts: RequestOptions): Promise<Json> {
    const { text, plan } = await this.request(opts);
    if (this.dryRun) return { dryRun: true, request: plan };
    if (!text) throw new Error("饭否没有返回内容 (empty response)");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`JSON 解析失败 (could not parse response):\n${text.slice(0, 300)}`);
    }
  }

  async requestText(opts: RequestOptions): Promise<string> {
    const { text } = await this.request(opts);
    return text;
  }

  // ---- OAuth / auth -----------------------------------------------------

  static parseTokenResponse(raw: string): { token: string; secret: string; extra: Record<string, string> } {
    const values: Record<string, string> = {};
    for (const component of raw.trim().split("&")) {
      const idx = component.indexOf("=");
      if (idx < 0) continue;
      const key = decodeURIComponent(component.slice(0, idx));
      const value = decodeURIComponent(component.slice(idx + 1));
      values[key] = value;
    }
    const token = values["oauth_token"] ?? "";
    const secret = values["oauth_token_secret"] ?? "";
    if (!token || !secret) throw new Error(`无效的 token 响应 (invalid token response): ${raw.slice(0, 200)}`);
    const extra: Record<string, string> = { ...values };
    delete extra["oauth_token"];
    delete extra["oauth_token_secret"];
    return { token, secret, extra };
  }

  /** XAuth: exchange username + password directly for an access token. */
  async xauthLogin(username: string, password: string): Promise<{ token: string; secret: string }> {
    const text = await this.requestText({
      base: "oauth",
      path: "oauth/access_token",
      method: "GET",
      oauthExtra: [
        ["x_auth_username", username],
        ["x_auth_password", password],
        ["x_auth_mode", "client_auth"],
      ],
    });
    const parsed = FanfouClient.parseTokenResponse(text);
    return { token: parsed.token, secret: parsed.secret };
  }

  /** OAuth step 1: obtain a temporary request token. */
  async requestToken(callback = "oob"): Promise<{ token: string; secret: string }> {
    const text = await this.requestText({
      base: "oauth",
      path: "oauth/request_token",
      method: "GET",
      oauthExtra: callback ? [["oauth_callback", callback]] : [],
    });
    const parsed = FanfouClient.parseTokenResponse(text);
    return { token: parsed.token, secret: parsed.secret };
  }

  authorizeURL(requestToken: string, callback?: string): string {
    const url = new URL("oauth/authorize", this.oauthBaseURL);
    url.searchParams.set("oauth_token", requestToken);
    if (callback) url.searchParams.set("oauth_callback", callback);
    return url.toString();
  }

  /** OAuth step 2: exchange an authorized request token for an access token. */
  async accessToken(
    requestToken: string,
    requestTokenSecret: string,
    verifier?: string,
  ): Promise<{ token: string; secret: string }> {
    const tmp = new FanfouClient({
      apiBaseURL: this.apiBaseURL,
      oauthBaseURL: this.oauthBaseURL,
      consumerKey: this.consumerKey,
      consumerSecret: this.consumerSecret,
      token: requestToken,
      tokenSecret: requestTokenSecret,
      dryRun: this.dryRun,
    });
    const text = await tmp.requestText({
      base: "oauth",
      path: "oauth/access_token",
      method: "GET",
      oauthExtra: verifier ? [["oauth_verifier", verifier]] : [],
    });
    const parsed = FanfouClient.parseTokenResponse(text);
    return { token: parsed.token, secret: parsed.secret };
  }

  // ---- Account ----------------------------------------------------------

  verifyCredentials(): Promise<Json> {
    return this.requestJSON({ path: "account/verify_credentials.json", method: "GET" });
  }

  notification(): Promise<Json> {
    return this.requestJSON({ path: "account/notification.json", method: "GET" });
  }

  updateProfile(fields: { name?: string; location?: string; url?: string; description?: string }): Promise<Json> {
    return this.requestJSON({
      path: "account/update_profile.json",
      method: "POST",
      form: [
        ["name", fields.name],
        ["location", fields.location],
        ["url", fields.url],
        ["description", fields.description],
      ],
    });
  }

  updateProfileImage(file: UploadFile): Promise<Json> {
    return this.requestJSON({
      path: "account/update_profile_image.json",
      method: "POST",
      file: { ...file, fieldName: "image" },
    });
  }

  // ---- Timelines --------------------------------------------------------

  private timeline(path: string, opts: TimelineParams): Promise<Json> {
    return this.requestJSON({
      path,
      method: "GET",
      query: [
        ["id", opts.id],
        ["since_id", opts.sinceId],
        ["max_id", opts.maxId],
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }

  homeTimeline(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("statuses/home_timeline.json", opts);
  }
  publicTimeline(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("statuses/public_timeline.json", opts);
  }
  userTimeline(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("statuses/user_timeline.json", opts);
  }
  mentions(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("statuses/mentions.json", opts);
  }
  contextTimeline(id: string): Promise<Json> {
    return this.requestJSON({ path: "statuses/context_timeline.json", method: "GET", query: [["id", id]] });
  }
  photoUserTimeline(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("photos/user_timeline.json", opts);
  }

  // ---- Search -----------------------------------------------------------

  searchPublicTimeline(q: string, opts: TimelineParams = {}): Promise<Json> {
    return this.requestJSON({
      path: "search/public_timeline.json",
      method: "GET",
      query: [
        ["q", q],
        ["since_id", opts.sinceId],
        ["max_id", opts.maxId],
        ["count", opts.count != null ? String(opts.count) : undefined],
      ],
    });
  }

  searchUsers(q: string, opts: { count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "search/users.json",
      method: "GET",
      query: [
        ["q", q],
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }

  // ---- Statuses ---------------------------------------------------------

  showStatus(id: string): Promise<Json> {
    return this.requestJSON({ path: "statuses/show.json", method: "GET", query: [["id", id]] });
  }

  updateStatus(opts: {
    status: string;
    inReplyToStatusId?: string;
    inReplyToUserId?: string;
    repostStatusId?: string;
    location?: string;
  }): Promise<Json> {
    return this.requestJSON({
      path: "statuses/update.json",
      method: "POST",
      form: [
        ["status", opts.status],
        ["in_reply_to_status_id", opts.inReplyToStatusId],
        ["in_reply_to_user_id", opts.inReplyToUserId],
        ["repost_status_id", opts.repostStatusId],
        ["location", opts.location],
        ["source", this.source],
      ],
    });
  }

  uploadPhoto(file: UploadFile, status: string, location?: string): Promise<Json> {
    return this.requestJSON({
      path: "photos/upload.json",
      method: "POST",
      multipart: [
        ["status", status],
        ["location", location ?? ""],
        ["source", this.source],
      ],
      file: { ...file, fieldName: "photo" },
    });
  }

  destroyStatus(id: string): Promise<Json> {
    return this.requestJSON({ path: "statuses/destroy.json", method: "POST", form: [["id", id]] });
  }

  // ---- Users & relationships -------------------------------------------

  showUser(id?: string): Promise<Json> {
    return this.requestJSON({ path: "users/show.json", method: "GET", query: [["id", id]] });
  }

  friends(opts: { id?: string; count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "users/friends.json",
      method: "GET",
      query: [
        ["id", opts.id],
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }

  followers(opts: { id?: string; count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "users/followers.json",
      method: "GET",
      query: [
        ["id", opts.id],
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }

  followUser(id: string): Promise<Json> {
    return this.requestJSON({ path: "friendships/create.json", method: "POST", form: [["id", id]] });
  }
  unfollowUser(id: string): Promise<Json> {
    return this.requestJSON({ path: "friendships/destroy.json", method: "POST", form: [["id", id]] });
  }

  async friendshipExists(userA: string, userB: string): Promise<boolean> {
    const text = await this.requestText({
      path: "friendships/exists.json",
      method: "GET",
      query: [
        ["user_a", userA],
        ["user_b", userB],
      ],
    });
    return text.trim().toLowerCase() === "true";
  }

  friendshipRequests(opts: { count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "friendships/requests.json",
      method: "GET",
      query: [
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }
  acceptFriendship(id: string): Promise<Json> {
    return this.requestJSON({ path: "friendships/accept.json", method: "POST", form: [["id", id]] });
  }
  denyFriendship(id: string): Promise<Json> {
    return this.requestJSON({ path: "friendships/deny.json", method: "POST", form: [["id", id]] });
  }

  // ---- Blocks -----------------------------------------------------------

  blockedUsers(opts: { count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "blocks/blocking.json",
      method: "GET",
      query: [
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }
  blockUser(id: string): Promise<Json> {
    return this.requestJSON({ path: "blocks/create.json", method: "POST", form: [["id", id]] });
  }
  unblockUser(id: string): Promise<Json> {
    return this.requestJSON({ path: "blocks/destroy.json", method: "POST", form: [["id", id]] });
  }
  async isBlocked(id: string): Promise<boolean> {
    try {
      await this.requestJSON({ path: "blocks/exists.json", method: "GET", query: [["id", id]] });
      return true;
    } catch (err) {
      if (err instanceof FanfouHttpError && (err.status === 403 || err.status === 404)) return false;
      throw err;
    }
  }

  // ---- Favorites --------------------------------------------------------

  favorites(opts: { id?: string; count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "favorites.json",
      method: "GET",
      query: [
        ["id", opts.id],
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }
  createFavorite(statusId: string): Promise<Json> {
    return this.requestJSON({ path: `favorites/create/${statusId}.json`, method: "POST" });
  }
  destroyFavorite(statusId: string): Promise<Json> {
    return this.requestJSON({ path: `favorites/destroy/${statusId}.json`, method: "POST" });
  }

  // ---- Direct messages --------------------------------------------------

  conversationList(opts: { count?: number; page?: number } = {}): Promise<Json> {
    return this.requestJSON({
      path: "direct_messages/conversation_list.json",
      method: "GET",
      query: [
        ["count", opts.count != null ? String(opts.count) : undefined],
        ["page", opts.page != null ? String(opts.page) : undefined],
      ],
    });
  }
  conversation(id: string, opts: TimelineParams = {}): Promise<Json> {
    return this.requestJSON({
      path: "direct_messages/conversation.json",
      method: "GET",
      query: [
        ["id", id],
        ["since_id", opts.sinceId],
        ["max_id", opts.maxId],
        ["count", opts.count != null ? String(opts.count) : undefined],
      ],
    });
  }
  inbox(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("direct_messages/inbox.json", opts);
  }
  sent(opts: TimelineParams = {}): Promise<Json> {
    return this.timeline("direct_messages/sent.json", opts);
  }
  sendDirectMessage(opts: { user: string; text: string; inReplyToId?: string }): Promise<Json> {
    return this.requestJSON({
      path: "direct_messages/new.json",
      method: "POST",
      form: [
        ["user", opts.user],
        ["text", opts.text],
        ["in_reply_to_id", opts.inReplyToId],
      ],
    });
  }
  deleteDirectMessage(id: string): Promise<Json> {
    return this.requestJSON({ path: "direct_messages/destroy.json", method: "POST", form: [["id", id]] });
  }
}

export interface TimelineParams {
  id?: string;
  sinceId?: string;
  maxId?: string;
  count?: number;
  page?: number;
}
