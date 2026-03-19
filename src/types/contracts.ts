export type TractionEyeClientConfig = {
  agentToken: string;
  baseUrl?: string;
};

export type StrategySummary = {
  strategyId: string;
  strategyName: string;
  pnlDayTon: string;
  pnlWeekTon: string;
  pnlMonthTon: string;
  pnlYearTon: string;
  tonInStrategy: string;
  totalWinRate: number;
  tradesPerWeek: number;
  maxDrawdown: number;
  lowBalanceState: boolean;
};

export type TokenSummary = {
  address: string;
  symbol: string;
  decimals: number;
  quantity: string;
  realizedPnlTon: string;
  unrealizedPnlTon: string;
  entryPriceTon?: string;
  currentValueTon?: string;
};

export type PortfolioSummary = {
  strategyId: string;
  totalRealizedPnlTon: string;
  totalUnrealizedPnlTon: string;
  tokens: TokenSummary[];
};

export type AvailableToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export type TradeAction = 'BUY' | 'SELL';
