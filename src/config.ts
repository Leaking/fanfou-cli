import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

export interface AuthProfile {
  consumerKey?: string;
  consumerSecret?: string;
  token?: string;
  tokenSecret?: string;
  user?: { id?: string; name?: string; screenName?: string };
}

interface ConfigFile {
  currentProfile: string;
  profiles: Record<string, AuthProfile>;
}

// Default consumer credentials shared with the existing Fanfou clients.
export const DEFAULT_CONSUMER_KEY = "175d9183cc2a7298abed2ca2280daa2a";
export const DEFAULT_CONSUMER_SECRET = "7c541eab37d4a8be432119c3fcf5c3a0";

export function configDir(): string {
  if (process.env.FANFOU_CONFIG_DIR) return process.env.FANFOU_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fanfou");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function emptyConfig(): ConfigFile {
  return { currentProfile: "default", profiles: {} };
}

export function loadConfig(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) return emptyConfig();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ConfigFile;
    if (!parsed.profiles) parsed.profiles = {};
    if (!parsed.currentProfile) parsed.currentProfile = "default";
    return parsed;
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: ConfigFile): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const path = configPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort */
  }
}

export function resolveProfileName(explicit?: string): string {
  return explicit || process.env.FANFOU_PROFILE || loadConfig().currentProfile || "default";
}

/** Merge stored profile with environment overrides; env always wins. */
export function resolveProfile(explicit?: string): { name: string; profile: AuthProfile } {
  const config = loadConfig();
  const name = resolveProfileName(explicit);
  const stored = config.profiles[name] ?? {};
  const profile: AuthProfile = {
    consumerKey: process.env.FANFOU_CONSUMER_KEY || stored.consumerKey || DEFAULT_CONSUMER_KEY,
    consumerSecret:
      process.env.FANFOU_CONSUMER_SECRET || stored.consumerSecret || DEFAULT_CONSUMER_SECRET,
    token: process.env.FANFOU_OAUTH_TOKEN || stored.token,
    tokenSecret: process.env.FANFOU_OAUTH_TOKEN_SECRET || stored.tokenSecret,
    user: stored.user,
  };
  return { name, profile };
}

export function saveProfile(name: string, profile: AuthProfile, setCurrent = true): void {
  const config = loadConfig();
  config.profiles[name] = { ...config.profiles[name], ...profile };
  if (setCurrent) config.currentProfile = name;
  saveConfig(config);
}

export function clearProfile(name: string): void {
  const config = loadConfig();
  delete config.profiles[name];
  if (config.currentProfile === name) config.currentProfile = "default";
  saveConfig(config);
}

export function listProfiles(): { current: string; names: string[] } {
  const config = loadConfig();
  return { current: config.currentProfile, names: Object.keys(config.profiles) };
}
