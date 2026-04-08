/**
 * Tool response projections.
 * Strips raw data (OHLCV candles, trade arrays, full PoolInfo) from tool responses
 * to reduce LLM token consumption while preserving all actionable information.
 */

import type { PoolInfo } from '../gecko/types.js';
import type { VerificationResult, MarketState, MarketRegime, ShortlistEntry, OrganicityVerdict, ComputedSignals, StoredMomentum, StoredVerificationResult } from '../types/v2.js';

// ── Full projected pool: 37 of 42 fields (for screen_tokens) ──────────

export type FullProjectedPoolInfo = Omit<PoolInfo, 'name' | 'socials' | 'websites' | 'priceNative' | 'baseTokenPriceUsd'> & {
  symbol: string;
  tokenAddress: string;
};

export function projectPoolInfoFull(p: PoolInfo): FullProjectedPoolInfo {
  const { name: _n, socials: _s, websites: _w, priceNative: _pn, baseTokenPriceUsd: _bp, baseTokenId: _bt, ...rest } = p;
  return { ...rest, symbol: p.name.split(' / ')[0] ?? p.name, tokenAddress: p.baseTokenId ?? '' };
}

// ── Compact pool: 20 fields (for find) ────────────────────────────────

export type CompactPoolInfo = {
  poolAddress: string;
  tokenAddress: string;
  symbol: string;
  dexId: string;
  tags: string[];
  reserveInUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume1hUsd: number;
  volume24hUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  buys1h: number;
  sells1h: number;
  buySellRatio: number;
  uniqueBuyers1h: number;
  lockedLiquidityPercent: number | null;
  boostTotalAmount: number;
  cto: boolean;
  createdAt: string;
};

export function projectPoolInfoCompact(p: PoolInfo): CompactPoolInfo {
  return {
    poolAddress: p.poolAddress,
    tokenAddress: p.baseTokenId ?? '',
    symbol: p.name.split(' / ')[0] ?? p.name,
    dexId: p.dexId,
    tags: p.tags,
    reserveInUsd: p.reserveInUsd,
    fdvUsd: p.fdvUsd,
    marketCapUsd: p.marketCapUsd,
    volume1hUsd: p.volume1hUsd,
    volume24hUsd: p.volume24hUsd,
    priceChange1h: p.priceChange1h,
    priceChange24h: p.priceChange24h,
    buys1h: p.buys1h,
    sells1h: p.sells1h,
    buySellRatio: p.buySellRatio,
    uniqueBuyers1h: p.uniqueBuyers1h,
    lockedLiquidityPercent: p.lockedLiquidityPercent,
    boostTotalAmount: p.boostTotalAmount,
    cto: p.cto,
    createdAt: p.createdAt,
  };
}

// ── Slim VerificationResult: drops raw OHLCV candles ─────────────────────

export function projectVerificationResult(r: VerificationResult): StoredVerificationResult {
  const { ohlcv: _dropped, ...momentumRest } = r.momentum;
  return { ...r, momentum: momentumRest };
}

// ── Market briefing: projected MarketState for read_briefing tool ─────────

export type MarketBriefing = {
  updatedAt: string;
  marketRegime: MarketRegime;
  tonPriceUsd: number;
  candidates: ShortlistEntry[];
  topLists: MarketState['topLists'];
  pendingVerifications: string[];
  openPositionReviews: MarketState['openPositionReviews'];
  cooldownTokens: MarketState['cooldownTokens'];
  apiUsage: MarketState['apiUsage'];
};

export function projectMarketState(s: MarketState): MarketBriefing {
  return {
    updatedAt: s.updatedAt,
    marketRegime: s.marketRegime,
    tonPriceUsd: s.tonPriceUsd,
    candidates: s.shortlist,
    topLists: {
      byVolume: s.topLists.byVolume.slice(0, 5),
      byLiquidity: s.topLists.byLiquidity.slice(0, 5),
      byFdv: s.topLists.byFdv.slice(0, 5),
      gainers1h: s.topLists.gainers1h.slice(0, 5),
      gainers24h: s.topLists.gainers24h.slice(0, 5),
      byTxCount: s.topLists.byTxCount.slice(0, 5),
    },
    pendingVerifications: s.pendingVerifications,
    openPositionReviews: s.openPositionReviews,
    cooldownTokens: s.cooldownTokens,
    apiUsage: s.apiUsage,
  };
}

// ── Slim review_position: strip verbose organicity signals ───────────────

export type SlimOrganicity = {
  verdict: OrganicityVerdict['verdict'];
  score: number;
  failedSignals: string[];
};

export function projectOrganicity(o: OrganicityVerdict): SlimOrganicity {
  return {
    verdict: o.verdict,
    score: o.score,
    failedSignals: o.signals.filter(s => !s.passed).map(s => s.name),
  };
}
