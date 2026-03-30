import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RiskPolicy } from './types/v2.js';
import { atomicWriteJsonSync } from './state/atomic.js';

/** Default data directory for TractionEye config and briefing files. */
export const DEFAULT_DATA_DIR =
  process.env['TRACTIONEYE_DATA_DIR'] ?? join(homedir(), '.tractioneye');

/** Path to the unified config file. */
export function configPath(): string {
  return join(DEFAULT_DATA_DIR, 'config.json');
}

/** Path to the briefing file written by the daemon. */
export function briefingPath(): string {
  return join(DEFAULT_DATA_DIR, 'briefing.json');
}

// ── State file paths (Section X) ─────────────────────────────────────

const STATE_DIR = join(DEFAULT_DATA_DIR, 'state');

export function stateDirPath(): string {
  return STATE_DIR;
}

export function marketStatePath(): string {
  return join(STATE_DIR, 'market_state.json');
}

export function candidateRegistryPath(): string {
  return join(STATE_DIR, 'candidate_registry.json');
}

export function portfolioStatePath(): string {
  return join(STATE_DIR, 'portfolio_state.json');
}

export function playbooksPath(): string {
  return join(STATE_DIR, 'playbooks.json');
}

export function cooldownPath(): string {
  return join(STATE_DIR, 'cooldown.json');
}

export function evalReportPath(): string {
  return join(STATE_DIR, 'eval_report.json');
}

export function reflectionLogPath(): string {
  return join(STATE_DIR, 'reflection_log.jsonl');
}

export function evalTracesDir(): string {
  return join(STATE_DIR, 'eval_traces');
}

export type TpSlDefaults = {
  takeProfitPercent: number;
  stopLossPercent: number;
  partialTakeProfitPercent?: number;
  partialTakeProfitSellPercent?: number;
};

export type TpSlConfig = {
  defaults: TpSlDefaults;
  perToken?: Record<string, Partial<TpSlDefaults>>;
};

export type ScreeningFilterConfig = {
  [key: string]: unknown;
};

export type DaemonConfig = {
  agentToken?: string;
  sessionId?: string;
  openclawPath?: string;
  tpSl?: TpSlConfig;
  screening?: {
    intervalMs?: number;
    filter?: ScreeningFilterConfig;
  };
  riskPolicy?: RiskPolicy;
};

/** Ensure data directory exists. */
export function ensureDataDir(): void {
  mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
}

/** Ensure state subdirectory exists. */
export function ensureStateDir(): void {
  mkdirSync(stateDirPath(), { recursive: true });
}

/** Read the config file. Returns empty config if file doesn't exist. */
export function readConfig(): DaemonConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as DaemonConfig;
  } catch {
    return {};
  }
}

/** Write the config file (full replace). Uses atomic write for crash safety. */
export function writeConfig(config: DaemonConfig): void {
  ensureDataDir();
  atomicWriteJsonSync(configPath(), config);
}

/** Merge partial updates into the existing config and write. */
export function updateConfig(patch: Partial<DaemonConfig>): DaemonConfig {
  const config = { ...readConfig(), ...patch };
  writeConfig(config);
  return config;
}

/** Read the briefing file. Returns null if not found. */
export function readBriefing(): unknown {
  try {
    const raw = readFileSync(briefingPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Agent session lock ─────────────────────────────────────────────────

const SESSION_LOCK_FILE = 'agent-session.lock';
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60_000; // 5 minutes

/** Path to the agent session lock file. */
export function sessionLockPath(): string {
  return join(DEFAULT_DATA_DIR, SESSION_LOCK_FILE);
}

/** Touch the session lock file — signals that an agent is actively using the API. */
export function touchSessionLock(): void {
  ensureDataDir();
  writeFileSync(sessionLockPath(), Date.now().toString(), 'utf-8');
}

/** Check if an agent session is active (lock file exists and is recent). */
export function isAgentSessionActive(timeoutMs = DEFAULT_SESSION_TIMEOUT_MS): boolean {
  try {
    const raw = readFileSync(sessionLockPath(), 'utf-8').trim();
    const lockTime = Number(raw);
    if (!Number.isFinite(lockTime)) return false;
    return Date.now() - lockTime < timeoutMs;
  } catch {
    return false;
  }
}
