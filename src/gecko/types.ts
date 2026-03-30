// ---- Shared SDK-level market data types ----

export type PoolInfo = {
  poolAddress: string;
  name: string;
  baseTokenPriceUsd: string;
  reserveInUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  lockedLiquidityPercent: number | null;
  volume24hUsd: number;
  volume6hUsd: number;
  volume1hUsd: number;
  priceChange5m: number;
  priceChange15m: number;
  priceChange30m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  transactions24h: number;
  buys24h: number;
  sells24h: number;
  uniqueBuyers1h: number;
  uniqueBuyers6h: number;
  uniqueBuyers24h: number;
  uniqueSellers1h: number;
  uniqueSellers6h: number;
  uniqueSellers24h: number;
  buySellRatio: number;
  createdAt: string;
  baseTokenId?: string;
  /** Tags indicating how this pool was discovered (e.g. 'top_volume', 'trending_1h', 'new'). */
  tags: string[];

  // ---- v2 fields (Section V) ----

  /** DEX identifier (e.g. 'stonfi', 'dedust'). From DexScreener dexId. */
  dexId: string;
  /** Token price relative to TON. From DexScreener priceNative. */
  priceNative: string;
  /** Buys in last 5 minutes. */
  buys5m: number;
  /** Sells in last 5 minutes. */
  sells5m: number;
  /** Buys in last 1 hour. */
  buys1h: number;
  /** Sells in last 1 hour. */
  sells1h: number;
  /** Buys in last 6 hours. */
  buys6h: number;
  /** Sells in last 6 hours. */
  sells6h: number;
  /** 5-minute volume in USD. */
  volume5mUsd: number;
  /** Social links from token info. */
  socials: { type: string; url: string }[];
  /** Website URLs from token info. */
  websites: string[];
  /** Total boost amount (from /token-boosts endpoint). 0 if not boosted. */
  boostTotalAmount: number;
  /** Community Takeover token (from /token-profiles endpoint). */
  cto: boolean;
};

export type TokenPrice = {
  address: string;
  priceUsd: number | null;
  symbol: string;
};

// ---- Trades endpoint ----

export type GeckoTradeAttributes = {
  kind: 'buy' | 'sell';
  volume_in_usd: string;
  tx_from_address: string;
  block_timestamp: string;
  from_token_amount: string;
  to_token_amount: string;
  price_from_in_usd: string;
  price_to_in_usd: string;
  block_number: number;
  tx_hash: string;
};

export type GeckoTradeData = {
  id: string;
  type: string;
  attributes: GeckoTradeAttributes;
};

export type GeckoTradesResponse = {
  data: GeckoTradeData[];
};

export type TradeInfo = {
  kind: 'buy' | 'sell';
  volumeInUsd: number;
  txFromAddress: string;
  blockTimestamp: string;
  fromTokenAmount: number;
  toTokenAmount: number;
  priceFromInUsd: number;
  priceToInUsd: number;
};

// ---- OHLCV endpoint ----

export type OhlcvCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OhlcvMeta = {
  base: { name: string; symbol: string; address: string };
  quote: { name: string; symbol: string };
};

export type GeckoOhlcvResponse = {
  data: {
    attributes: {
      ohlcv_list: [number, number, number, number, number, number][];
    };
  };
  meta: {
    base: { name: string; symbol: string; address: string };
    quote: { name: string; symbol: string };
  };
};

export type OhlcvResponse = {
  candles: OhlcvCandle[];
  meta: OhlcvMeta;
};

export type OhlcvTimeframe = 'day' | 'hour' | 'minute';

// ---- Token Info endpoint (v2) ----

export type GeckoTokenInfoResponse = {
  data: {
    id: string;
    type: string;
    attributes: {
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      gt_score: number | null;
      gt_score_details: {
        pool: number;
        transaction: number;
        creation: number;
        info: number;
        holders: number;
      } | null;
      holders: {
        count: number;
        distribution_percentage: {
          top_10: string;
          '11_30': string;
          '31_50': string;
          rest: string;
        };
        last_updated: string;
      } | null;
      is_honeypot: 'yes' | 'unknown' | null;
      mint_authority: string | null;
      freeze_authority: string | null;
      websites: string[] | null;
      discord_url: string | null;
      telegram_handle: string | null;
      twitter_handle: string | null;
      description: string | null;
    };
  };
};

// ---- Pool Info endpoint (v2) ----

type GeckoTxnPeriod = {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
};

export type GeckoPoolInfoResponse = {
  data: {
    id: string;
    type: string;
    attributes: {
      address: string;
      name: string;
      pool_name: string;
      base_token_price_usd: string;
      reserve_in_usd: string;
      locked_liquidity_percentage: number | null;
      fdv_usd: string | null;
      market_cap_usd: string | null;
      price_change_percentage: {
        m5: string;
        m15: string;
        m30: string;
        h1: string;
        h6: string;
        h24: string;
      };
      volume_usd: {
        m5: string;
        m15: string;
        m30: string;
        h1: string;
        h6: string;
        h24: string;
      };
      transactions: {
        m5: GeckoTxnPeriod;
        m15: GeckoTxnPeriod;
        m30: GeckoTxnPeriod;
        h1: GeckoTxnPeriod;
        h6: GeckoTxnPeriod;
        h24: GeckoTxnPeriod;
      };
      pool_created_at: string;
    };
    relationships: {
      base_token: { data: { id: string; type: string } };
      quote_token: { data: { id: string; type: string } };
      dex: { data: { id: string; type: string } };
    };
  };
};
