export { PositionManager } from './manager.js';
export type { TradeExecutor, PositionEventHandler } from './manager.js';
export type {
  PositionConfig,
  MonitorConfig,
  TrackedPosition,
  PositionEvent,
} from './types.js';

// v2: Triple Barrier
export { BarrierManager } from './barrier.js';
export type {
  BarrierPosition,
  BarrierEvent,
  BarrierTradeExecutor,
  BarrierEventHandler,
} from './barrier.js';
