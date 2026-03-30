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

  /**
   * Batch price query — up to 30 addresses per request.
   * Uses /latest/dex/tokens/{addr1,addr2,...addr30}.
   * Critical for position monitoring: 8 positions = 1 request instead of 8.
   * See SPEC-V2.md Section XIII.
   */
  async getTokenPricesBatch(
    addresses: string[],
    priority = RequestPriority.Critical,
  ): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    if (addresses.length === 0) return result;

    // Process in chunks of 30
    for (let i = 0; i < addresses.length; i += 30) {
      const chunk = addresses.slice(i, i + 30);
      const joined = chunk.join(',');
      const data = await this.get<{ pairs: DexPair[] | null }>(
        `/latest/dex/tokens/${joined}`,
        priority,
      );
      const pairs = (data.pairs ?? []).filter((p) => p.chainId === 'ton');

      // Group by base token, pick highest liquidity pair for each
      const byToken = new Map<string, DexPair>();
      for (const pair of pairs) {
        const addr = pair.baseToken.address;
        const existing = byToken.get(addr);
        if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
          byToken.set(addr, pair);
        }
      }

      for (const addr of chunk) {
        const pair = byToken.get(addr);
        if (pair) {
          const priceNum = Number(pair.priceUsd);
          result.set(addr, {
            address: addr,
            priceUsd: Number.isFinite(priceNum) ? priceNum : null,
            symbol: pair.baseToken.symbol,
          });
        } else {
          result.set(addr, { address: addr, priceUsd: null, symbol: '' });
        }
      }
    }
    return result;
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
    type BoostEntry = { chainId: string; tokenAddress: string; url: string; totalAmount?: number; amount?: number };
    const boosts = await this.get<BoostEntry[]>(`/token-boosts/latest/v1`, priority);
    const tonBoosts = (Array.isArray(boosts) ? boosts : []).filter(
      (b) => b.chainId === 'ton',
    );
    if (tonBoosts.length === 0) {
      return this.getTopPools(priority);
    }
    // Build boost amount lookup: tokenAddress -> totalAmount
    const boostAmounts = new Map<string, number>();
    for (const b of tonBoosts) {
      const current = boostAmounts.get(b.tokenAddress) ?? 0;
      boostAmounts.set(b.tokenAddress, current + (b.totalAmount ?? b.amount ?? 0));
    }
    // Fetch pairs for up to 5 boosted tokens to avoid N+1 request explosion
    const pools: PoolInfo[] = [];
    for (const boost of tonBoosts.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(boost.tokenAddress, priority);
      if (tokenPools.length > 0) {
        const pool = tokenPools[0];
        pool.boostTotalAmount = boostAmounts.get(boost.tokenAddress) ?? 0;
        pools.push(pool);
      }
    }
    return pools;
  }

  /** Newly profiled tokens on TON. */
  async getNewPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    type ProfileEntry = { chainId: string; tokenAddress: string; url: string; description?: string };
    const profiles = await this.get<ProfileEntry[]>(`/token-profiles/latest/v1`, priority);
    const tonProfiles = (Array.isArray(profiles) ? profiles : []).filter(
      (p) => p.chainId === 'ton',
    );
    // Fetch pairs for up to 5 new tokens to avoid N+1 request explosion
    const pools: PoolInfo[] = [];
    for (const profile of tonProfiles.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(profile.tokenAddress, priority);
      if (tokenPools.length > 0) {
        const pool = tokenPools[0];
        // CTO detection: profile description containing "CTO" or "community takeover"
        const desc = (profile.description ?? '').toLowerCase();
        if (desc.includes('cto') || desc.includes('community takeover')) {
          pool.cto = true;
        }
        pools.push(pool);
      }
    }
    return pools;
  }

  // ---------- 429 Callback (v2) ----------

  private on429Callback?: (path: string) => void;

  /** Register a callback for 429 responses (used by QuotaManager). */
  setOn429Callback(cb: (path: string) => void): void {
    this.on429Callback = cb;
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
          this.on429Callback?.(path);
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
  const buys24 = pair.txns?.h24?.buys ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  const buys1h = pair.txns?.h1?.buys ?? 0;
  const sells1h = pair.txns?.h1?.sells ?? 0;
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
    transactions24h: buys24 + sells24,
    buys24h: buys24,
    sells24h: sells24,
    // Unique buyers/sellers: 0 from DexScreener (only available via GeckoTerminal)
    uniqueBuyers1h: 0,
    uniqueBuyers6h: 0,
    uniqueBuyers24h: 0,
    uniqueSellers1h: 0,
    uniqueSellers6h: 0,
    uniqueSellers24h: 0,
    buySellRatio: sells24 > 0 ? buys24 / sells24 : buys24 > 0 ? Infinity : 0,
    createdAt: pair.pairCreatedAt != null ? new Date(pair.pairCreatedAt).toISOString() : '',
    baseTokenId: pair.baseToken.address,
    tags: [],

    // v2 fields
    dexId: pair.dexId ?? '',
    priceNative: pair.priceNative ?? '0',
    buys5m: pair.txns?.m5?.buys ?? 0,
    sells5m: pair.txns?.m5?.sells ?? 0,
    buys1h,
    sells1h,
    buys6h: pair.txns?.h6?.buys ?? 0,
    sells6h: pair.txns?.h6?.sells ?? 0,
    volume5mUsd: pair.volume?.m5 ?? 0,
    socials: pair.info?.socials?.map((s) => ({ type: s.type, url: s.url })) ?? [],
    websites: pair.info?.websites?.map((w) => w.url) ?? [],
    boostTotalAmount: 0,
    cto: false,
  };
}
