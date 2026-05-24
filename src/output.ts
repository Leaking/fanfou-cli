export type OutputFormat = "json" | "ndjson" | "table" | "raw";

export function isOutputFormat(value: string): value is OutputFormat {
  return value === "json" || value === "ndjson" || value === "table" || value === "raw";
}

function asArray(data: unknown): unknown[] | null {
  return Array.isArray(data) ? data : null;
}

function truncate(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** Best-effort one-line summary for a Fanfou status or user object. */
function summarizeRow(item: unknown): string | null {
  if (item == null || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  // Status-like
  if (typeof o["text"] === "string" && o["user"] && typeof o["user"] === "object") {
    const user = o["user"] as Record<string, unknown>;
    const name = (user["name"] as string) ?? (user["id"] as string) ?? "?";
    const id = (o["id"] as string) ?? "";
    const created = (o["created_at"] as string) ?? "";
    const fav = o["favorited"] ? " ★" : "";
    return `${id}\t@${name}${fav}\t${truncate(o["text"] as string, 70)}\t${created}`;
  }
  // Direct message-like
  if (typeof o["text"] === "string" && (o["sender_id"] || o["sender"])) {
    const sender = (o["sender"] as Record<string, unknown> | undefined)?.["name"] ?? o["sender_id"];
    const id = (o["id"] as string) ?? "";
    return `${id}\t@${sender}\t${truncate(o["text"] as string, 70)}`;
  }
  // User-like
  if (typeof o["id"] === "string" && (o["screen_name"] || o["name"])) {
    const followers = o["followers_count"] ?? "";
    const statuses = o["statuses_count"] ?? "";
    return `${o["id"]}\t${o["name"] ?? ""}\tfollowers=${followers}\tstatuses=${statuses}`;
  }
  return null;
}

function renderTable(data: unknown): string {
  const arr = asArray(data);
  if (arr) {
    const lines = arr.map((item) => summarizeRow(item) ?? JSON.stringify(item));
    return lines.join("\n");
  }
  return summarizeRow(data) ?? JSON.stringify(data, null, 2);
}

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "ndjson": {
      const arr = asArray(data);
      if (arr) return arr.map((item) => JSON.stringify(item)).join("\n");
      return JSON.stringify(data);
    }
    case "table":
      return renderTable(data);
    case "raw":
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }
}

export function printData(data: unknown, format: OutputFormat): void {
  if (data === undefined) return;
  const out = formatOutput(data, format);
  if (out.length > 0) process.stdout.write(out + "\n");
}

export interface CliErrorShape {
  type: string;
  message: string;
  status?: number;
  body?: string;
  hint?: string;
}

export function printError(error: CliErrorShape, format: OutputFormat): void {
  if (format === "table" || format === "raw") {
    let line = `错误 (${error.type}): ${error.message}`;
    if (error.hint) line += `\n提示: ${error.hint}`;
    process.stderr.write(line + "\n");
  } else {
    process.stderr.write(JSON.stringify({ error }, null, 2) + "\n");
  }
}
