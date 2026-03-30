/**
 * Triple Barrier Position Manager (Section VI-A).
 * Replaces simple TP/SL with 4 barriers: SL, TP, trailing stop, time limit.
 * Evaluates ALL barriers every tick. Whichever fires first closes the position.
 *
 * API budget impact: ZERO — uses same price data already fetched by price sentry.
 */

import type { DexScreenerClient } from '../dexscreener/client.js';
import type { TokenPrice } from '../gecko/types.js';
import type { CloseType, TripleBarrierConfig } from '../types/v2.js';

export type BarrierPosition = {
  tokenAddress: string;
  poolAddress: string;
  symbol: string;
  entryPriceUsd: number;
  entryTimestamp: string;
  quantity: string;
  barriers: TripleBarrierConfig;
  /** Peak PnL % reached (for trailing stop tracking). */
  peakPnlPercent: number;
  /** Whether trailing stop has been activated. */
  trailingStopActivated: boolean;
  /** Whether partial TP has already fired. */
  partialTpTriggered: boolean;
};

export type BarrierEvent = {
  closeType: CloseType;
  tokenAddress: string;
  symbol: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  pnlPercent: number;
  sellPercent: number;
  reason: string;
};

export type BarrierTradeExecutor = (
  tokenAddress: string,
  action: 'SELL',
  sellPercent: number,
) => Promise<void>;

export type BarrierEventHandler = (event: BarrierEvent) => void;

const DEFAULT_INTERVAL_MS = 30_000; // 30 seconds per spec

export class BarrierManager {
  private positions = new Map<string, BarrierPosition>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly dex: DexScreenerClient,
    private readonly executeTradeCallback: BarrierTradeExecutor,
    private readonly onEvent?: BarrierEventHandler,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  /** Register a position with barriers. */
  addPosition(pos: BarrierPosition): void {
    this.positions.set(pos.tokenAddress, pos);
  }

  /** Remove a position from monitoring. */
  removePosition(tokenAddress: string): void {
    this.positions.delete(tokenAddress);
  }

  /** Get all tracked positions. */
  getPositions(): BarrierPosition[] {
    return Array.from(this.positions.values());
  }

  /** Get a single position. */
  getPosition(tokenAddress: string): BarrierPosition | undefined {
    return this.positions.get(tokenAddress);
  }

  /** Update barriers for an existing position. */
  updateBarriers(tokenAddress: string, barriers: TripleBarrierConfig): boolean {
    const pos = this.positions.get(tokenAddress);
    if (!pos) return false;
    pos.barriers = barriers;
    return true;
  }

  /** Start the barrier evaluation loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  /** Stop the barrier evaluation loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Single evaluation tick: fetch batch prices & check all barriers. */
  private async tick(): Promise<void> {
    if (this.positions.size === 0) return;

    const addresses = Array.from(this.positions.keys());
    let priceMap: Map<string, TokenPrice>;
    try {
      priceMap = await this.dex.getTokenPricesBatch(addresses);
    } catch {
      return; // Retry on next tick
    }

    for (const [addr, pos] of this.positions) {
      const priceInfo = priceMap.get(addr);
      if (!priceInfo?.priceUsd) continue;

      const currentPrice = priceInfo.priceUsd;
      const pnlPercent = ((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

      // Update peak PnL
      if (pnlPercent > pos.peakPnlPercent) {
        pos.peakPnlPercent = pnlPercent;
      }

      const event = this.evaluateBarriers(pos, currentPrice, pnlPercent);
      if (event) {
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, 'SELL', event.sellPercent);
        } catch {
          continue; // Retry on next tick
        }
        if (event.sellPercent >= 100) {
          this.positions.delete(addr);
        }
      }
    }
  }

  /**
   * Evaluate all barriers for a position.
   * Returns the first barrier that fires, or null if none.
   * Priority: stop_loss > trailing_stop > time_limit > take_profit > partial_tp
   */
  private evaluateBarriers(
    pos: BarrierPosition,
    currentPrice: number,
    pnlPercent: number,
  ): BarrierEvent | null {
    const b = pos.barriers;
    const base = {
      tokenAddress: pos.tokenAddress,
      symbol: pos.symbol,
      entryPriceUsd: pos.entryPriceUsd,
      currentPriceUsd: currentPrice,
      pnlPercent,
    };

    // 1. Stop Loss
    if (pnlPercent <= -b.stopLossPercent) {
      return {
        ...base,
        closeType: 'stop_loss',
        sellPercent: 100,
        reason: `PnL ${pnlPercent.toFixed(1)}% hit stop loss at -${b.stopLossPercent}%`,
      };
    }

    // 2. Trailing Stop
    if (b.trailingStop) {
      // Activate trailing stop when PnL reaches activation threshold
      if (!pos.trailingStopActivated && pnlPercent >= b.trailingStop.activationPercent) {
        pos.trailingStopActivated = true;
      }

      if (pos.trailingStopActivated) {
        const trailingStopLevel = pos.peakPnlPercent - b.trailingStop.deltaPercent;
        if (pnlPercent <= trailingStopLevel && trailingStopLevel > 0) {
          return {
            ...base,
            closeType: 'trailing_stop',
            sellPercent: 100,
            reason: `Trailing stop: peak ${pos.peakPnlPercent.toFixed(1)}%, stop at ${trailingStopLevel.toFixed(1)}%, current ${pnlPercent.toFixed(1)}%`,
          };
        }
      }
    }

    // 3. Time Limit
    if (b.timeLimitSeconds != null) {
      const holdMs = Date.now() - new Date(pos.entryTimestamp).getTime();
      if (holdMs >= b.timeLimitSeconds * 1000) {
        return {
          ...base,
          closeType: 'time_limit',
          sellPercent: 100,
          reason: `Position held for ${Math.round(holdMs / 60_000)} minutes, time limit is ${Math.round(b.timeLimitSeconds / 60)} minutes`,
        };
      }
    }

    // 4. Take Profit (full)
    if (pnlPercent >= b.takeProfitPercent) {
      return {
        ...base,
        closeType: 'take_profit',
        sellPercent: 100,
        reason: `PnL ${pnlPercent.toFixed(1)}% hit take profit at +${b.takeProfitPercent}%`,
      };
    }

    // 5. Partial Take Profit
    if (
      b.partialTp &&
      !pos.partialTpTriggered &&
      pnlPercent >= b.partialTp.triggerPercent
    ) {
      pos.partialTpTriggered = true;
      return {
        ...base,
        closeType: 'partial_tp',
        sellPercent: b.partialTp.sellPercent,
        reason: `Partial TP: PnL ${pnlPercent.toFixed(1)}% hit trigger at +${b.partialTp.triggerPercent}%, selling ${b.partialTp.sellPercent}%`,
      };
    }

    return null;
  }
}
