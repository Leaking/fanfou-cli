import { createHmac, randomBytes } from "node:crypto";

export type Pair = [string, string];

export interface SignOptions {
  method: string;
  url: URL;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  /** Extra oauth_* / x_auth_* parameters that travel in the Authorization header. */
  extraParameters?: Pair[];
  /** application/x-www-form-urlencoded body parameters that join the signature base. */
  bodyParameters?: Pair[];
  /** Override the URL used to build the signature base string (Fanfou signs over http). */
  signatureURL?: URL;
  nonce?: string;
  timestampSeconds?: string;
}

/** RFC 3986 percent-encoding (unreserved set only). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function baseURLString(url: URL): string {
  const scheme = url.protocol.replace(/:$/, "");
  const host = url.hostname;
  let portPart = "";
  if (
    url.port &&
    !((scheme === "http" && url.port === "80") || (scheme === "https" && url.port === "443"))
  ) {
    portPart = `:${url.port}`;
  }
  const path = url.pathname && url.pathname.length > 0 ? url.pathname : "/";
  return `${scheme}://${host}${portPart}${path}`;
}

function queryPairs(url: URL): Pair[] {
  const pairs: Pair[] = [];
  for (const [name, value] of url.searchParams.entries()) {
    pairs.push([name, value]);
  }
  return pairs;
}

/**
 * Fanfou signs the base string with an http:// scheme even though requests go over
 * https. Mirror the iOS client's `fanfouSignatureURL` quirk so signatures validate.
 */
export function fanfouSignatureURL(url: URL): URL {
  if (url.protocol === "https:" && url.hostname.endsWith("fanfou.com")) {
    const copy = new URL(url.toString());
    copy.protocol = "http:";
    return copy;
  }
  return url;
}

export function sign(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", key).update(baseString, "utf8").digest("base64");
}

export function authorizationHeader(opts: SignOptions): string {
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const timestamp = opts.timestampSeconds ?? String(Math.floor(Date.now() / 1000));

  const oauthParameters: Pair[] = [
    ["oauth_consumer_key", opts.consumerKey],
    ["oauth_nonce", nonce],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", timestamp],
    ["oauth_version", "1.0"],
  ];

  if (opts.token && opts.token.length > 0) {
    oauthParameters.push(["oauth_token", opts.token]);
  }
  if (opts.extraParameters) {
    oauthParameters.push(...opts.extraParameters);
  }

  const allParameters: Pair[] = [
    ...oauthParameters,
    ...queryPairs(opts.url),
    ...(opts.bodyParameters ?? []),
  ];

  const encoded: Pair[] = allParameters.map(([k, v]) => [percentEncode(k), percentEncode(v)]);
  encoded.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const signingParameters = encoded.map(([k, v]) => `${k}=${v}`).join("&");

  const baseString = [
    opts.method.toUpperCase(),
    percentEncode(baseURLString(opts.signatureURL ?? opts.url)),
    percentEncode(signingParameters),
  ].join("&");

  const signature = sign(baseString, opts.consumerSecret, opts.tokenSecret ?? "");
  const headerParameters: Pair[] = [...oauthParameters, ["oauth_signature", signature]];

  return (
    "OAuth " +
    headerParameters.map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`).join(", ")
  );
}
