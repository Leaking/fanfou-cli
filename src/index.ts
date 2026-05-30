#!/usr/bin/env node
import { parseArgs, flagBool, flagString } from "./args.ts";
import { buildRootCommand } from "./commands.ts";
import { UsageError } from "./commands.ts";
import { FanfouClient, FanfouHttpError } from "./client.ts";
import { resolveProfile } from "./config.ts";
import {
  collectBooleanFlags,
  commandSchema,
  renderHelpText,
  resolveCommand,
  type CommandContext,
} from "./registry.ts";
import { isOutputFormat, printData, printError, type OutputFormat } from "./output.ts";

const VERSION = "0.1.0";

function resolveFormat(flags: Map<string, string | boolean>): OutputFormat {
  if (flagBool(flags, "json")) return "json";
  const explicit = flagString(flags, "format");
  if (explicit) {
    if (isOutputFormat(explicit)) return explicit;
    throw new UsageError(`未知的输出格式：${explicit}（可选 json|ndjson|table|raw）`);
  }
  return "json";
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = buildRootCommand();
  const booleanFlags = collectBooleanFlags(root);
  const { positionals, flags } = parseArgs(argv, booleanFlags);

  if (flagBool(flags, "version")) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  let format: OutputFormat;
  try {
    format = resolveFormat(flags);
  } catch (err) {
    printError({ type: "usage", message: (err as Error).message }, "json");
    return 2;
  }

  const { command, path, rest } = resolveCommand(root, positionals);
  const wantsHelp = flagBool(flags, "help");
  const hasRun = typeof command.run === "function";

  if (wantsHelp || !hasRun) {
    if (format === "json") {
      printData(commandSchema(command, path), "json");
    } else {
      process.stdout.write(renderHelpText(command, path) + "\n");
    }
    // No runnable command and no help requested = usage error exit code.
    return hasRun || wantsHelp ? 0 : positionals.length === 0 ? 0 : 2;
  }

  const dryRun = flagBool(flags, "dry-run");
  const profileName = flagString(flags, "profile") ?? "";
  const { name, profile } = resolveProfile(profileName || undefined);

  const client = new FanfouClient({
    consumerKey: profile.consumerKey!,
    consumerSecret: profile.consumerSecret!,
    token: profile.token,
    tokenSecret: profile.tokenSecret,
    dryRun,
  });

  if (command.requiresAuth && !client.isAuthenticated && !dryRun) {
    printError(
      {
        type: "auth_required",
        message: `命令 "${path.join(" ")}" 需要登录`,
        hint: "先运行：fanfou auth login -u <用户名> -p <密码>，或用 --dry-run 预览请求",
      },
      format,
    );
    return 3;
  }

  const ctx: CommandContext = {
    client,
    args: rest,
    flags,
    format,
    dryRun,
    profileName: name,
  };

  const result = await command.run!(ctx);
  printData(result, format);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const format: OutputFormat = "json";
    if (err instanceof UsageError) {
      printError({ type: "usage", message: err.message }, format);
      process.exit(2);
    }
    if (err instanceof FanfouHttpError) {
      printError(
        {
          type: "http_error",
          message: err.message.split("\n")[0] ?? err.message,
          status: err.status,
          body: err.body.slice(0, 1000),
        },
        format,
      );
      process.exit(1);
    }
    const baseMessage = (err as Error)?.message ?? String(err);
    const cause = (err as { cause?: unknown })?.cause;
    const causeMessage = cause instanceof Error ? cause.message : cause != null ? String(cause) : undefined;
    const message = causeMessage ? `${baseMessage} (cause: ${causeMessage})` : baseMessage;
    printError({ type: "error", message }, format);
    process.exit(1);
  });
