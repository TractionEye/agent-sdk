// src/config.ts
import { readFileSync, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { homedir } from "os";
import { join } from "path";

// src/state/atomic.ts
import { writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
function atomicWriteJsonSync(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmp, filePath);
}

// src/config.ts
var DEFAULT_DATA_DIR = process.env["TRACTIONEYE_DATA_DIR"] ?? join(homedir(), ".tractioneye");
function configPath() {
  return join(DEFAULT_DATA_DIR, "config.json");
}
function briefingPath() {
  return join(DEFAULT_DATA_DIR, "briefing.json");
}
var STATE_DIR = join(DEFAULT_DATA_DIR, "state");
function stateDirPath() {
  return STATE_DIR;
}
function marketStatePath() {
  return join(STATE_DIR, "market_state.json");
}
function candidateRegistryPath() {
  return join(STATE_DIR, "candidate_registry.json");
}
function portfolioStatePath() {
  return join(STATE_DIR, "portfolio_state.json");
}
function playbooksPath() {
  return join(STATE_DIR, "playbooks.json");
}
function cooldownPath() {
  return join(STATE_DIR, "cooldown.json");
}
function evalReportPath() {
  return join(STATE_DIR, "eval_report.json");
}
function reflectionLogPath() {
  return join(STATE_DIR, "reflection_log.jsonl");
}
function evalTracesDir() {
  return join(STATE_DIR, "eval_traces");
}
function ensureDataDir() {
  mkdirSync2(DEFAULT_DATA_DIR, { recursive: true });
}
function ensureStateDir() {
  mkdirSync2(stateDirPath(), { recursive: true });
}
function readConfig() {
  try {
    const raw = readFileSync(configPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeConfig(config) {
  ensureDataDir();
  atomicWriteJsonSync(configPath(), config);
}
function updateConfig(patch) {
  const config = { ...readConfig(), ...patch };
  writeConfig(config);
  return config;
}
function readBriefing() {
  try {
    const raw = readFileSync(briefingPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var SESSION_LOCK_FILE = "agent-session.lock";
var DEFAULT_SESSION_TIMEOUT_MS = 5 * 6e4;
function sessionLockPath() {
  return join(DEFAULT_DATA_DIR, SESSION_LOCK_FILE);
}
function touchSessionLock() {
  ensureDataDir();
  writeFileSync2(sessionLockPath(), Date.now().toString(), "utf-8");
}
function isAgentSessionActive(timeoutMs = DEFAULT_SESSION_TIMEOUT_MS) {
  try {
    const raw = readFileSync(sessionLockPath(), "utf-8").trim();
    const lockTime = Number(raw);
    if (!Number.isFinite(lockTime)) return false;
    return Date.now() - lockTime < timeoutMs;
  } catch {
    return false;
  }
}

export {
  atomicWriteJsonSync,
  DEFAULT_DATA_DIR,
  configPath,
  briefingPath,
  stateDirPath,
  marketStatePath,
  candidateRegistryPath,
  portfolioStatePath,
  playbooksPath,
  cooldownPath,
  evalReportPath,
  reflectionLogPath,
  evalTracesDir,
  ensureDataDir,
  ensureStateDir,
  readConfig,
  writeConfig,
  updateConfig,
  readBriefing,
  sessionLockPath,
  touchSessionLock,
  isAgentSessionActive
};
