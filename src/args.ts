export type FlagValue = string | boolean;

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, FlagValue>;
}

const SHORT_ALIASES: Record<string, string> = {
  h: "help",
  o: "format",
  n: "dry-run",
  v: "verbose",
  q: "quiet",
};

/**
 * Minimal, predictable argument parser.
 * - `--key=value` and `--key value` both bind a value.
 * - `--flag` is boolean true when its name is in `booleanFlags` or no value follows.
 * - `+shortcut` and other bare tokens are positionals.
 * - `--` stops flag parsing; everything after is positional.
 */
export function parseArgs(argv: string[], booleanFlags: Set<string>): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (onlyPositionals) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const name = body;
      if (booleanFlags.has(name)) {
        flags.set(name, true);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !(next.startsWith("--") || next === "-")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
      continue;
    }
    // Only treat an exact single-letter known short (e.g. -h, -u, -o) as a flag.
    // Anything else starting with "-" is a positional — Fanfou ids often begin
    // with "-" (e.g. -A_ycI00_Kc), so we must not misread them as flags.
    const short = token.slice(1);
    if (token.startsWith("-") && short.length === 1 && short in SHORT_ALIASES) {
      const long = SHORT_ALIASES[short]!;
      if (booleanFlags.has(long)) {
        flags.set(long, true);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags.set(long, next);
          i++;
        } else {
          flags.set(long, true);
        }
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, flags };
}

export function flagString(flags: Map<string, FlagValue>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : "";
}

export function flagBool(flags: Map<string, FlagValue>, name: string): boolean {
  return flags.has(name) && flags.get(name) !== "false";
}

export function flagNumber(flags: Map<string, FlagValue>, name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
