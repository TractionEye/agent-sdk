import { RateLimiter, RequestPriority } from '../rate-limiter.js';
import type {
  GeckoTradesResponse,
  GeckoOhlcvResponse,
  OhlcvTimeframe,
  OhlcvResponse,
  OhlcvCandle,
  TradeInfo,
} from './types.js';

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

  // ---------- Internal ----------

  private get<T>(path: string, priority: RequestPriority): Promise<T> {
    return this.limiter.schedule(priority, async () => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(`${GECKO_BASE}${path}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.status === 429) {
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

