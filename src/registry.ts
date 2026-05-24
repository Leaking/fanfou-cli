import type { FanfouClient } from "./client.ts";
import type { FlagValue } from "./args.ts";
import type { OutputFormat } from "./output.ts";

export interface FlagSpec {
  name: string;
  alias?: string;
  type: "string" | "boolean" | "number";
  description: string;
  required?: boolean;
  default?: string | number | boolean;
}

export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface CommandContext {
  client: FanfouClient;
  args: string[];
  flags: Map<string, FlagValue>;
  format: OutputFormat;
  dryRun: boolean;
  profileName: string;
}

export interface Command {
  name: string;
  summary: string;
  description?: string;
  args?: ArgSpec[];
  flags?: FlagSpec[];
  examples?: string[];
  requiresAuth?: boolean;
  mutates?: boolean;
  run?: (ctx: CommandContext) => Promise<unknown> | unknown;
  subcommands?: Command[];
}

export const GLOBAL_BOOLEAN_FLAGS = ["help", "dry-run", "verbose", "quiet", "version", "json", "no-color"];

export function collectBooleanFlags(root: Command): Set<string> {
  const set = new Set<string>(GLOBAL_BOOLEAN_FLAGS);
  const walk = (cmd: Command): void => {
    for (const flag of cmd.flags ?? []) {
      if (flag.type === "boolean") {
        set.add(flag.name);
        if (flag.alias) set.add(flag.alias);
      }
    }
    for (const sub of cmd.subcommands ?? []) walk(sub);
  };
  walk(root);
  return set;
}

export interface Resolution {
  command: Command;
  path: string[];
  rest: string[];
}

export function resolveCommand(root: Command, positionals: string[]): Resolution {
  let command = root;
  const path: string[] = [];
  let i = 0;
  while (i < positionals.length) {
    const token = positionals[i]!;
    const next = command.subcommands?.find((c) => c.name === token);
    if (!next) break;
    command = next;
    path.push(token);
    i++;
  }
  return { command, path, rest: positionals.slice(i) };
}

export function commandSchema(command: Command, path: string[]): Record<string, unknown> {
  return {
    name: command.name,
    path: ["fanfou", ...path].join(" "),
    summary: command.summary,
    description: command.description,
    requiresAuth: command.requiresAuth ?? false,
    mutates: command.mutates ?? false,
    arguments: (command.args ?? []).map((a) => ({
      name: a.name,
      description: a.description,
      required: a.required ?? false,
      variadic: a.variadic ?? false,
    })),
    flags: (command.flags ?? []).map((f) => ({
      name: f.name,
      alias: f.alias,
      type: f.type,
      description: f.description,
      required: f.required ?? false,
      default: f.default,
    })),
    subcommands: (command.subcommands ?? []).map((s) => ({ name: s.name, summary: s.summary })),
    examples: command.examples ?? [],
  };
}

function usageLine(command: Command, path: string[]): string {
  const parts = ["fanfou", ...path];
  if (command.subcommands && command.subcommands.length > 0) parts.push("<command>");
  for (const arg of command.args ?? []) {
    const token = arg.variadic ? `${arg.name}...` : arg.name;
    parts.push(arg.required ? `<${token}>` : `[${token}]`);
  }
  if ((command.flags ?? []).length > 0) parts.push("[flags]");
  return parts.join(" ");
}

export function renderHelpText(command: Command, path: string[]): string {
  const lines: string[] = [];
  const title = path.length > 0 ? path.join(" ") : "fanfou";
  lines.push(`${title} — ${command.summary}`);
  lines.push("");
  if (command.description) {
    lines.push(command.description);
    lines.push("");
  }
  lines.push("Usage:");
  lines.push(`  ${usageLine(command, path)}`);

  if (command.args && command.args.length > 0) {
    lines.push("");
    lines.push("Arguments:");
    for (const arg of command.args) {
      const flag = arg.required ? " (required)" : "";
      lines.push(`  ${arg.name.padEnd(18)} ${arg.description}${flag}`);
    }
  }

  if (command.flags && command.flags.length > 0) {
    lines.push("");
    lines.push("Flags:");
    for (const flag of command.flags) {
      const alias = flag.alias ? `, -${flag.alias}` : "";
      const valueHint = flag.type === "boolean" ? "" : ` <${flag.type}>`;
      const head = `--${flag.name}${alias}${valueHint}`;
      const req = flag.required ? " (required)" : "";
      const def = flag.default !== undefined ? ` [default: ${flag.default}]` : "";
      lines.push(`  ${head.padEnd(26)} ${flag.description}${req}${def}`);
    }
  }

  if (command.subcommands && command.subcommands.length > 0) {
    lines.push("");
    lines.push("Commands:");
    for (const sub of command.subcommands) {
      lines.push(`  ${sub.name.padEnd(18)} ${sub.summary}`);
    }
  }

  if (command.examples && command.examples.length > 0) {
    lines.push("");
    lines.push("Examples:");
    for (const ex of command.examples) lines.push(`  ${ex}`);
  }

  lines.push("");
  lines.push("Global flags:");
  lines.push("  --format, -o <json|ndjson|table|raw>   Output format (default: json)");
  lines.push("  --profile <name>                       Account profile to use");
  lines.push("  --dry-run, -n                          Print the request without sending it");
  lines.push("  --help, -h                             Show help (add --format json for schema)");
  return lines.join("\n");
}
