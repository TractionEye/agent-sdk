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
