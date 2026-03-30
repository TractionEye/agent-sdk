import { RateLimiter, RequestPriority } from '../rate-limiter.js';
import type {
  GeckoTradesResponse,
  GeckoOhlcvResponse,
  GeckoTokenInfoResponse,
  GeckoPoolInfoResponse,
  OhlcvTimeframe,
  OhlcvResponse,
  OhlcvCandle,
  TradeInfo,
} from './types.js';
import type { GeckoTokenInfo, GeckoPoolInfo } from '../types/v2.js';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const NETWORK = 'ton';

/**
 * GeckoTerminal API client — OHLCV candles and trade history only.
 * Pool discovery, prices, and screening are handled by DexScreenerClient.
 */
export class GeckoTerminalClient {
  constructor(private readonly limiter: RateLimiter) {}

  // ---------- Trades & OHLCV ----------

  /** Fetch recent trades for a pool. */
  async getPoolTrades(
    poolAddress: string,
    options?: { tradeVolumeInUsdGreaterThan?: number },
    priority = RequestPriority.High,
  ): Promise<TradeInfo[]> {
    let path = `/networks/${NETWORK}/pools/${poolAddress}/trades`;
    if (options?.tradeVolumeInUsdGreaterThan != null) {
      path += `?trade_volume_in_usd_greater_than=${options.tradeVolumeInUsdGreaterThan}`;
    }
    const data = await this.get<GeckoTradesResponse>(path, priority);
    return data.data.map((t) => ({
      kind: t.attributes.kind,
      volumeInUsd: num(t.attributes.volume_in_usd),
      txFromAddress: t.attributes.tx_from_address,
      blockTimestamp: t.attributes.block_timestamp,
      fromTokenAmount: num(t.attributes.from_token_amount),
      toTokenAmount: num(t.attributes.to_token_amount),
      priceFromInUsd: num(t.attributes.price_from_in_usd),
      priceToInUsd: num(t.attributes.price_to_in_usd),
    }));
  }

  /** Fetch OHLCV candles for a pool (retries with cache-bust on empty response). */
  async getPoolOhlcv(
    poolAddress: string,
    timeframe: OhlcvTimeframe = 'day',
    limit = 30,
    priority = RequestPriority.High,
  ): Promise<OhlcvResponse> {
    const basePath = `/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`;
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const path = attempt === 0 ? basePath : `${basePath}&_cb=${Date.now()}`;
      const data = await this.get<GeckoOhlcvResponse>(path, priority);
      const ohlcvList = data.data.attributes.ohlcv_list;

      if (ohlcvList.length === 0 && attempt < maxAttempts - 1) {
        console.warn(
          `[gecko] OHLCV empty for ${poolAddress}, retrying with cache-bust (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }

      if (ohlcvList.length === 0) {
        console.warn(`[gecko] OHLCV still empty for ${poolAddress} after ${maxAttempts} attempts`);
      }

      const candles: OhlcvCandle[] = ohlcvList.map(
        ([timestamp, open, high, low, close, volume]) => ({
          timestamp,
          open,
          high,
          low,
          close,
          volume,
        }),
      );
      return { candles, meta: data.meta };
    }

    // Unreachable, but satisfies TypeScript
    return { candles: [], meta: {} as OhlcvResponse['meta'] };
  }

  // ---------- Token & Pool Info (v2) ----------

  /**
   * Fetch token safety + holder info from GeckoTerminal.
   * Endpoint: GET /networks/ton/tokens/{tokenAddress}/info
   * See SPEC-V2.md Section V.
   */
  async getTokenInfo(
    tokenAddress: string,
    priority = RequestPriority.High,
  ): Promise<GeckoTokenInfo> {
    const data = await this.get<GeckoTokenInfoResponse>(
      `/networks/${NETWORK}/tokens/${tokenAddress}/info`,
      priority,
    );
    const a = data.data.attributes;
    return {
      address: a.address,
      name: a.name ?? '',
      symbol: a.symbol ?? '',
      decimals: a.decimals ?? 9,
      gtScore: a.gt_score,
      gtScoreDetails: a.gt_score_details
        ? {
            pool: a.gt_score_details.pool,
            transaction: a.gt_score_details.transaction,
            creation: a.gt_score_details.creation,
            info: a.gt_score_details.info,
            holders: a.gt_score_details.holders,
          }
        : null,
      holders: a.holders
        ? {
            count: a.holders.count,
            distributionPercentage: {
              top10: num(a.holders.distribution_percentage.top_10),
              range11to30: num(a.holders.distribution_percentage['11_30']),
              range31to50: num(a.holders.distribution_percentage['31_50']),
              rest: num(a.holders.distribution_percentage.rest),
            },
          }
        : null,
      isHoneypot: a.is_honeypot,
      mintAuthority: a.mint_authority,
      freezeAuthority: a.freeze_authority,
      websites: a.websites ?? [],
      socials: [
        ...(a.twitter_handle ? [{ type: 'twitter', url: `https://twitter.com/${a.twitter_handle}` }] : []),
        ...(a.telegram_handle ? [{ type: 'telegram', url: `https://t.me/${a.telegram_handle}` }] : []),
        ...(a.discord_url ? [{ type: 'discord', url: a.discord_url }] : []),
      ],
    };
  }

  /**
   * Fetch pool details including unique buyers/sellers from GeckoTerminal.
   * Endpoint: GET /networks/ton/pools/{poolAddress}
   * See SPEC-V2.md Section V.
   */
  async getPoolInfo(
    poolAddress: string,
    priority = RequestPriority.High,
  ): Promise<GeckoPoolInfo> {
    const data = await this.get<GeckoPoolInfoResponse>(
      `/networks/${NETWORK}/pools/${poolAddress}`,
      priority,
    );
    const a = data.data.attributes;
    const pc = a.price_change_percentage;
    const vol = a.volume_usd;
    const txn = a.transactions;
    return {
      poolAddress: a.address,
      name: a.name,
      baseTokenPriceUsd: a.base_token_price_usd,
      reserveInUsd: num(a.reserve_in_usd),
      lockedLiquidityPercentage: a.locked_liquidity_percentage,
      fdvUsd: a.fdv_usd != null ? num(a.fdv_usd) : null,
      marketCapUsd: a.market_cap_usd != null ? num(a.market_cap_usd) : null,
      priceChange: {
        m5: num(pc.m5),
        m15: num(pc.m15),
        m30: num(pc.m30),
        h1: num(pc.h1),
        h6: num(pc.h6),
        h24: num(pc.h24),
      },
      volume: {
        m5: num(vol.m5),
        m15: num(vol.m15),
        m30: num(vol.m30),
        h1: num(vol.h1),
        h6: num(vol.h6),
        h24: num(vol.h24),
      },
      transactions: {
        m5: txn.m5,
        m15: txn.m15,
        m30: txn.m30,
        h1: txn.h1,
        h6: txn.h6,
        h24: txn.h24,
      },
      poolCreatedAt: a.pool_created_at,
    };
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
        const res = await fetch(`${GECKO_BASE}${path}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.status === 429) {
          this.on429Callback?.(path);
          const backoffMs = (attempt + 1) * 5_000;
          console.warn(`[gecko] 429 on ${path}, waiting ${backoffMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}: ${path}`);
        return res.json() as Promise<T>;
      }
      throw new Error(`GeckoTerminal 429: ${path} (exhausted ${maxRetries} retries)`);
    });
  }
}

// ---------- Helpers ----------

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

