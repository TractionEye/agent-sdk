import { RateLimiter, RequestPriority } from '../rate-limiter.js';
import type { PoolInfo, TokenPrice } from '../gecko/types.js';
import type {
  DexPair,
  DexSearchResponse,
  DexTokenResponse,
  DexPairsResponse,
} from './types.js';

const DEX_BASE = 'https://api.dexscreener.com';

/** DexScreener API client for TON network with built-in rate limiting. */
export class DexScreenerClient {
  constructor(private readonly limiter: RateLimiter) {}

  // ---------- Pool search ----------

  /** Search pools by keyword, filtered to TON chain. */
  async searchPools(query: string, priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<DexSearchResponse>(
      `/latest/dex/search?q=${encodeURIComponent(query)}`,
      priority,
    );
    if (!data.pairs) return [];
    return data.pairs
      .filter((p) => p.chainId === 'ton')
      .map(mapPairToPoolInfo);
  }

  /** Fetch all pairs for a token address on TON. */
  async getTokenPairs(tokenAddress: string, priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<DexTokenResponse>(
      `/latest/dex/tokens/${tokenAddress}`,
      priority,
    );
    if (!data.pairs) return [];
    return data.pairs
      .filter((p) => p.chainId === 'ton')
      .map(mapPairToPoolInfo);
  }

  /** Fetch a single pair by address on TON. */
  async getPair(pairAddress: string, priority = RequestPriority.Low): Promise<PoolInfo | null> {
    const data = await this.get<DexPairsResponse>(
      `/latest/dex/pairs/ton/${pairAddress}`,
      priority,
    );
    if (!data.pair) return null;
    return mapPairToPoolInfo(data.pair);
  }

  // ---------- Token price ----------

  /** Fetch price for a single token (picks highest-liquidity pair). */
  async getTokenPrice(
    tokenAddress: string,
    priority = RequestPriority.Critical,
  ): Promise<TokenPrice> {
    const pools = await this.getTokenPairs(tokenAddress, priority);
    if (pools.length === 0) {
      return { address: tokenAddress, priceUsd: null, symbol: '' };
    }
    // Pick pair with highest liquidity (reserveInUsd)
    const best = pools.reduce((a, b) => (b.reserveInUsd > a.reserveInUsd ? b : a));
    const priceNum = Number(best.baseTokenPriceUsd);
    return {
      address: tokenAddress,
      priceUsd: Number.isFinite(priceNum) ? priceNum : null,
      symbol: best.name.split(' / ')[0] ?? '',
    };
  }

  /** Fetch prices for multiple tokens sequentially. */
  async getTokenPrices(
    addresses: string[],
    priority = RequestPriority.Critical,
  ): Promise<TokenPrice[]> {
    const results: TokenPrice[] = [];
    for (const addr of addresses) {
      results.push(await this.getTokenPrice(addr, priority));
    }
    return results;
  }

  // ---------- Discovery ----------

  /** Top pools on TON sorted by 24h volume. */
  async getTopPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<DexSearchResponse>(
      `/latest/dex/search?q=TON`,
      priority,
    );
    if (!data.pairs) return [];
    return data.pairs
      .filter((p) => p.chainId === 'ton')
      .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
      .map(mapPairToPoolInfo);
  }

  /** Trending (boosted) pools on TON. Falls back to getTopPools if none found. */
  async getTrendingPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    type BoostEntry = { chainId: string; tokenAddress: string; url: string };
    const boosts = await this.get<BoostEntry[]>(`/token-boosts/latest/v1`, priority);
    const tonBoosts = (Array.isArray(boosts) ? boosts : []).filter(
      (b) => b.chainId === 'ton',
    );
    if (tonBoosts.length === 0) {
      return this.getTopPools(priority);
    }
    // Fetch pairs for up to 5 boosted tokens to avoid N+1 request explosion
    const pools: PoolInfo[] = [];
    for (const boost of tonBoosts.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(boost.tokenAddress, priority);
      if (tokenPools.length > 0) pools.push(tokenPools[0]);
    }
    return pools;
  }

  /** Newly profiled tokens on TON. */
  async getNewPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    type ProfileEntry = { chainId: string; tokenAddress: string; url: string };
    const profiles = await this.get<ProfileEntry[]>(`/token-profiles/latest/v1`, priority);
    const tonProfiles = (Array.isArray(profiles) ? profiles : []).filter(
      (p) => p.chainId === 'ton',
    );
    // Fetch pairs for up to 5 new tokens to avoid N+1 request explosion
    const pools: PoolInfo[] = [];
    for (const profile of tonProfiles.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(profile.tokenAddress, priority);
      if (tokenPools.length > 0) pools.push(tokenPools[0]);
    }
    return pools;
  }

  // ---------- Internal ----------

  private get<T>(path: string, priority: RequestPriority): Promise<T> {
    return this.limiter.schedule(priority, async () => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(`${DEX_BASE}${path}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.status === 429) {
          const backoffMs = (attempt + 1) * 3_000;
          console.warn(`[dexscreener] 429 on ${path}, waiting ${backoffMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}: ${path}`);
        return res.json() as Promise<T>;
      }
      throw new Error(`DexScreener 429: ${path} (exhausted ${maxRetries} retries)`);
    });
  }
}

// ---------- Helpers ----------

function mapPairToPoolInfo(pair: DexPair): PoolInfo {
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  return {
    poolAddress: pair.pairAddress,
    name: `${pair.baseToken.symbol} / ${pair.quoteToken.symbol}`,
    baseTokenPriceUsd: pair.priceUsd ?? '0',
    reserveInUsd: pair.liquidity?.usd ?? 0,
    fdvUsd: pair.fdv ?? null,
    marketCapUsd: pair.marketCap ?? null,
    lockedLiquidityPercent: null,
    volume24hUsd: pair.volume?.h24 ?? 0,
    volume6hUsd: pair.volume?.h6 ?? 0,
    volume1hUsd: pair.volume?.h1 ?? 0,
    priceChange5m: pair.priceChange?.m5 ?? 0,
    priceChange15m: 0,
    priceChange30m: 0,
    priceChange1h: pair.priceChange?.h1 ?? 0,
    priceChange6h: pair.priceChange?.h6 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    transactions24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    uniqueBuyers1h: 0,
    uniqueBuyers6h: 0,
    uniqueBuyers24h: 0,
    uniqueSellers1h: 0,
    uniqueSellers6h: 0,
    uniqueSellers24h: 0,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? Infinity : 0,
    createdAt: pair.pairCreatedAt != null ? new Date(pair.pairCreatedAt).toISOString() : '',
    baseTokenId: pair.baseToken.address,
    tags: [],
  };
}
