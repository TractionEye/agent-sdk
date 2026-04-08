/**
 * verify_candidate pipeline (Section XI).
 * Replaces analyze_pool with 4-call GeckoTerminal verification.
 * Includes 5-minute TTL cache to avoid redundant calls.
 */

import type { GeckoTerminalClient } from '../gecko/client.js';
import type { OhlcvCandle, TradeInfo } from '../gecko/types.js';
import type {
  GeckoTokenInfo,
  GeckoPoolInfo,
  VerificationResult,
  OrganicityVerdict,
} from '../types/v2.js';
import { checkOrganicity } from '../safety/organicity.js';
import { computeSignals, buildConfidence } from './signals.js';

const VERIFY_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

type CacheEntry = {
  tokenInfo: GeckoTokenInfo;
  poolInfo: GeckoPoolInfo;
  timestamp: number;
};

/** In-memory verify cache. Key = tokenAddress. */
const verifyCache = new Map<string, CacheEntry>();

/** Get cached verify data if still valid. */
export function getCachedVerifyData(tokenAddress: string): CacheEntry | null {
  const entry = verifyCache.get(tokenAddress);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > VERIFY_CACHE_TTL_MS) {
    verifyCache.delete(tokenAddress);
    return null;
  }
  return entry;
}

/** Clear expired entries from cache. */
export function cleanVerifyCache(): void {
  const now = Date.now();
  for (const [key, entry] of verifyCache) {
    if (now - entry.timestamp > VERIFY_CACHE_TTL_MS) {
      verifyCache.delete(key);
    }
  }
}

/**
 * Run the full 4-call verify pipeline.
 * 1. getTokenInfo(tokenAddress) -> safety + holders
 * 2. getPoolInfo(poolAddress) -> liquidity, unique buyers/sellers, volume
 * 3. getPoolTrades(poolAddress) -> trade flow, wallet concentration
 * 4. getPoolOhlcv(poolAddress) -> price structure
 *
 * @returns VerificationResult with safety, organicity, momentum, execution data
 */
export async function verifyCandidate(
  gecko: GeckoTerminalClient,
  tokenAddress: string,
  poolAddress: string,
  dexId: string,
  poolCreatedAt?: string,
): Promise<VerificationResult> {
  const startTime = Date.now();
  let geckoCallsUsed = 0;

  // Check cache for tokenInfo + poolInfo
  const cached = getCachedVerifyData(tokenAddress);

  let tokenInfo: GeckoTokenInfo;
  let poolInfo: GeckoPoolInfo;

  if (cached) {
    tokenInfo = cached.tokenInfo;
    poolInfo = cached.poolInfo;
  } else {
    // Call 1: getTokenInfo
    tokenInfo = await gecko.getTokenInfo(tokenAddress);
    geckoCallsUsed++;

    // Call 2: getPoolInfo
    poolInfo = await gecko.getPoolInfo(poolAddress);
    geckoCallsUsed++;

    // Cache for 5 minutes
    verifyCache.set(tokenAddress, {
      tokenInfo,
      poolInfo,
      timestamp: Date.now(),
    });
  }

  // Call 3: getPoolTrades
  const trades: TradeInfo[] = await gecko.getPoolTrades(poolAddress);
  geckoCallsUsed++;

  // Call 4: getPoolOhlcv
  const ohlcvResp = await gecko.getPoolOhlcv(poolAddress, 'hour', 30);
  geckoCallsUsed++;

  // ---- Anti-wash check (mandatory) ----
  const organicity: OrganicityVerdict = checkOrganicity(poolInfo, trades);

  // ---- Momentum analysis ----
  const candles = ohlcvResp.candles;
  const buyPressureVal = poolInfo.transactions.h1.buys + poolInfo.transactions.h1.sells > 0
    ? poolInfo.transactions.h1.buys / (poolInfo.transactions.h1.buys + poolInfo.transactions.h1.sells)
    : 0;

  // ---- Computed signals ----
  const signals = computeSignals(null, poolInfo);

  // ---- Confidence summary ----
  const confidence = buildConfidence(tokenInfo, poolInfo, signals, organicity);

  // ---- Safety verdict ----
  const safetyReasons: string[] = [];
  let safetyVerdict: 'pass' | 'reject' | 'warning' = 'pass';

  if (tokenInfo.isHoneypot === 'yes') {
    safetyVerdict = 'reject';
    safetyReasons.push('Confirmed honeypot');
  }
  if (tokenInfo.mintAuthority != null) {
    safetyVerdict = 'reject';
    safetyReasons.push('Mint authority exists');
  }
  if (tokenInfo.freezeAuthority != null) {
    safetyVerdict = 'reject';
    safetyReasons.push('Freeze authority exists');
  }
  if (organicity.verdict === 'wash') {
    safetyVerdict = 'reject';
    safetyReasons.push('Wash trading confirmed');
  }
  if (poolInfo.reserveInUsd < 500) {
    safetyVerdict = 'reject';
    safetyReasons.push(`Liquidity too low: $${poolInfo.reserveInUsd.toFixed(0)}`);
  }

  if (safetyVerdict === 'pass') {
    if (tokenInfo.isHoneypot === 'unknown') {
      safetyVerdict = 'warning';
      safetyReasons.push('Honeypot status unknown');
    }
    if (organicity.verdict === 'suspicious') {
      safetyVerdict = 'warning';
      safetyReasons.push('Suspicious trading activity');
    }
  }

  // ---- Execution analysis ----
  let priceImpactEstimate: 'low' | 'medium' | 'high' = 'low';
  if (poolInfo.reserveInUsd < 5000) priceImpactEstimate = 'high';
  else if (poolInfo.reserveInUsd < 20000) priceImpactEstimate = 'medium';

  // ---- Pool age ----
  let poolAge = '';
  if (poolCreatedAt) {
    const ageMs = Date.now() - new Date(poolCreatedAt).getTime();
    const hours = Math.floor(ageMs / 3_600_000);
    const days = Math.floor(hours / 24);
    poolAge = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
  }

  return {
    safety: {
      verdict: safetyVerdict,
      reasons: safetyReasons,
      isHoneypot: tokenInfo.isHoneypot,
      mintAuthority: tokenInfo.mintAuthority != null,
      freezeAuthority: tokenInfo.freezeAuthority != null,
      gtScore: tokenInfo.gtScore,
    },
    organicity,
    momentum: {
      buyPressure: buyPressureVal,
      volumeRatio1h: computeVolumeRatio(candles, 1),
      volumeRatio5h: computeVolumeRatio(candles, 5),
      priceChange1h: computePriceChange(candles, 1),
      priceChange5h: computePriceChange(candles, 5),
      avgCandleRange1h: computeAvgCandleRange(candles, 1),
      avgCandleRange5h: computeAvgCandleRange(candles, 5),
      ohlcv: candles,
    },
    execution: {
      reserveInUsd: poolInfo.reserveInUsd,
      lockedLiquidityPercent: poolInfo.lockedLiquidityPercentage,
      priceImpactEstimate,
    },
    computedSignals: signals,
    confidence,
    meta: {
      poolAddress,
      tokenAddress,
      dexId,
      poolAge,
      geckoCallsUsed,
      timestamp: new Date().toISOString(),
    },
  };
}

// ---- Helpers ----

function computeVolumeRatio(candles: OhlcvCandle[], recentCount: number): number {
  if (candles.length < recentCount + 1) return 1;
  const recent = candles.slice(-recentCount);
  const earlier = candles.slice(0, -recentCount);
  if (earlier.length === 0) return 1;
  const recentAvg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const earlierAvg = earlier.reduce((s, c) => s + c.volume, 0) / earlier.length;
  if (earlierAvg < 1) return 1;
  return Math.round((recentAvg / earlierAvg) * 100) / 100;
}

function computePriceChange(candles: OhlcvCandle[], count: number): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-count);
  const first = slice[0].close;
  const last = slice[slice.length - 1].close;
  if (first === 0) return 0;
  return Math.round(((last - first) / first) * 10000) / 100;
}

function computeAvgCandleRange(candles: OhlcvCandle[], count: number): number {
  const slice = candles.slice(-count);
  if (slice.length === 0) return 0;
  const ranges = slice.map(c => c.close > 0 ? ((c.high - c.low) / c.close) * 100 : 0);
  return Math.round((ranges.reduce((s, r) => s + r, 0) / ranges.length) * 100) / 100;
}
