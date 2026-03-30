/**
 * Safety Gate (Section VI).
 * Deterministic checks that run BEFORE trade execution.
 * LLM cannot bypass, override, or disable these gates.
 */

import type { GeckoTokenInfo, GeckoPoolInfo } from '../types/v2.js';
import type { OrganicityVerdict } from '../types/v2.js';
import type {
  SafetyRejectId,
  PenaltyId,
  SafetyCheckResult,
  RiskPolicy,
  CooldownEntry,
} from '../types/v2.js';
import type { PortfolioSummary } from '../types/contracts.js';

export type SafetyContext = {
  tokenInfo: GeckoTokenInfo | null;
  poolInfo: GeckoPoolInfo | null;
  organicity: OrganicityVerdict | null;
  portfolio: PortfolioSummary;
  riskPolicy: RiskPolicy;
  cooldownMap: Map<string, CooldownEntry>;
  tokenAddress: string;
  isTradeable: boolean;
  poolAge: number;     // age in minutes
  cto: boolean;
};

/**
 * Run all safety gate checks. Returns verdict with rejects and penalties.
 * If any hard reject fires, the trade is impossible.
 * Penalties reduce position size multiplicatively.
 */
export function checkSafety(ctx: SafetyContext): SafetyCheckResult {
  const rejects: SafetyCheckResult['rejects'] = [];
  const penalties: SafetyCheckResult['penalties'] = [];

  // ---- Hard Rejects ----

  // HONEYPOT: tokenInfo.isHoneypot === 'yes'
  if (ctx.tokenInfo?.isHoneypot === 'yes') {
    rejects.push({ id: 'HONEYPOT', reason: 'Token is confirmed honeypot — cannot sell' });
  }

  // MINT_AUTHORITY: tokenInfo.mintAuthority !== null
  if (ctx.tokenInfo?.mintAuthority != null) {
    rejects.push({ id: 'MINT_AUTHORITY', reason: `Owner can mint tokens (authority: ${ctx.tokenInfo.mintAuthority})` });
  }

  // FREEZE_AUTHORITY: tokenInfo.freezeAuthority !== null
  if (ctx.tokenInfo?.freezeAuthority != null) {
    rejects.push({ id: 'FREEZE_AUTHORITY', reason: `Owner can freeze tokens (authority: ${ctx.tokenInfo.freezeAuthority})` });
  }

  // DUPLICATE_POSITION: Token already in portfolio
  const hasPosition = ctx.portfolio.tokens.some(
    (t) => t.address === ctx.tokenAddress && Number(t.quantity) > 0,
  );
  if (hasPosition) {
    rejects.push({ id: 'DUPLICATE_POSITION', reason: 'Token already in portfolio' });
  }

  // POSITION_CAP: Open positions >= maxOpenPositions
  const openPositions = ctx.portfolio.tokens.filter((t) => Number(t.quantity) > 0).length;
  if (openPositions >= ctx.riskPolicy.maxOpenPositions) {
    rejects.push({ id: 'POSITION_CAP', reason: `Open positions (${openPositions}) >= max (${ctx.riskPolicy.maxOpenPositions})` });
  }

  // EXPOSURE_CAP: Total exposure > maxTotalExposurePercent
  // This is checked at buy time based on proposed trade size — checked externally

  // NOT_TRADEABLE: findToken() === null
  if (!ctx.isTradeable) {
    rejects.push({ id: 'NOT_TRADEABLE', reason: 'Token not available on TractionEye' });
  }

  // ZERO_LIQUIDITY: geckoPool.reserveInUsd < 500
  if (ctx.poolInfo != null && ctx.poolInfo.reserveInUsd < 500) {
    rejects.push({ id: 'ZERO_LIQUIDITY', reason: `Pool liquidity too low: $${ctx.poolInfo.reserveInUsd.toFixed(0)}` });
  }

  // WASH_CONFIRMED: organicity.verdict === "wash"
  if (ctx.organicity?.verdict === 'wash') {
    rejects.push({ id: 'WASH_CONFIRMED', reason: 'Volume is fake (wash trading confirmed)' });
  }

  // COOLDOWN: Token exited by SL/thesis/safety within cooldownAfterExitMinutes
  const cooldownEntry = ctx.cooldownMap.get(ctx.tokenAddress);
  if (cooldownEntry) {
    const exitTime = new Date(cooldownEntry.exitTimestamp).getTime();
    const cooldownMs = ctx.riskPolicy.cooldownAfterExitMinutes * 60_000;
    if (Date.now() - exitTime < cooldownMs) {
      const cooldownUntil = new Date(exitTime + cooldownMs).toISOString();
      rejects.push({ id: 'COOLDOWN', reason: `Token in cooldown until ${cooldownUntil} (exited by ${cooldownEntry.closeType})` });
    }
  }

  // ---- Structural Penalties ----

  // HIGH_CONCENTRATION: holders.top_10 > 50%
  if (ctx.tokenInfo?.holders != null) {
    const top10 = ctx.tokenInfo.holders.distributionPercentage.top10;
    if (top10 > ctx.riskPolicy.maxTop10HoldersPercent) {
      penalties.push({ id: 'HIGH_CONCENTRATION', multiplier: 0.5, reason: `Top 10 holders own ${top10.toFixed(1)}%` });
    }
  }

  // LOW_HOLDERS: holders.count < minHoldersCount
  if (ctx.tokenInfo?.holders != null && ctx.tokenInfo.holders.count < ctx.riskPolicy.minHoldersCount) {
    penalties.push({ id: 'LOW_HOLDERS', multiplier: 0.7, reason: `Only ${ctx.tokenInfo.holders.count} holders` });
  }

  // LOW_LOCKED_LIQUIDITY: lockedLiquidity !== null && < 30%
  // Note: null = WARNING "data unavailable", 0 = also WARNING (not reject) per verification results
  if (ctx.poolInfo?.lockedLiquidityPercentage != null && ctx.poolInfo.lockedLiquidityPercentage > 0) {
    if (ctx.poolInfo.lockedLiquidityPercentage < 30) {
      penalties.push({ id: 'LOW_LOCKED_LIQUIDITY', multiplier: 0.6, reason: `Locked liquidity ${ctx.poolInfo.lockedLiquidityPercentage.toFixed(1)}% < 30%` });
    }
  }

  // TOO_FRESH: Pool age < 30 minutes
  if (ctx.poolAge < 30) {
    penalties.push({ id: 'TOO_FRESH', multiplier: 0.5, reason: `Pool is only ${ctx.poolAge} minutes old` });
  }

  // CTO_TOKEN: cto === true
  if (ctx.cto) {
    penalties.push({ id: 'CTO_TOKEN', multiplier: 0.8, reason: 'Community takeover token' });
  }

  // HONEYPOT_UNKNOWN: isHoneypot === 'unknown'
  if (ctx.tokenInfo?.isHoneypot === 'unknown') {
    penalties.push({ id: 'HONEYPOT_UNKNOWN', multiplier: 0.9, reason: 'Cannot confirm token is safe (honeypot status unknown)' });
  }

  // SUSPICIOUS_ORGANICITY: organicity.verdict === "suspicious"
  if (ctx.organicity?.verdict === 'suspicious') {
    penalties.push({ id: 'SUSPICIOUS_ORGANICITY', multiplier: 0.5, reason: 'Suspicious trading activity detected' });
  }

  // Calculate final multiplier (penalties stack multiplicatively)
  const finalMultiplier = penalties.reduce((mult, p) => mult * p.multiplier, 1);

  // Determine verdict
  let verdict: SafetyCheckResult['verdict'];
  if (rejects.length > 0) {
    verdict = 'reject';
  } else if (penalties.length > 0) {
    verdict = 'warning';
  } else {
    verdict = 'pass';
  }

  return { verdict, rejects, penalties, finalMultiplier };
}
