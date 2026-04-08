# TractionEye Agent Kit

AI-агентский SDK для автоматической спот-торговли на TON DEX.

## Стек

- **Язык:** TypeScript 5.4.5, strict mode
- **Сборка:** tsup (ESM + CJS + .d.ts)
- **Runtime:** Node.js, pm2 (daemon)
- **GitHub:** github.com/TractionEye/TractionEye-Agent-kit (ветка main)
- **Git workflow:** PR -> merge в main

## Архитектура (v2)

### 16 Agent Tools
12 базовых + verify_candidate, review_position, record_reflection, read_risk_policy, read_api_budget
(analyze_pool удалён 2026-04-05 — deprecated, жрал токены)

### Dual-API стратегия
- **DexScreener** — discovery, prices, batch до 30 tokens/req
- **GeckoTerminal** — verify, safety, OHLCV, trades

### Safety Gates (КРИТИЧНО — НЕ ОСЛАБЛЯТЬ)
- **10 hard rejects:** honeypot, mint/freeze authority, wash trading, cooldown и др.
- **7 penalties:** multiplicative scoring
- LLM не может обойти — это жёсткие программные ограничения

### Triple Barrier
SL + TP + trailing stop + time limit + partial TP. Ставятся **атомарно** с покупкой — не разделять эти операции.

### Daemon v2 (pm2)
4 microcycles:
- price sentry — 30s
- scout — 3min
- thesis light — 60s
- thesis deep — 10min

Event bus. BarrierManager (замена старого PositionManager).

### State Layer
Путь: `~/.tractioneye/state/`
- market_state.json, candidate_registry.json, portfolio_state.json
- playbooks.json, cooldown.json, reflection_log.jsonl
- **Atomic writes only** (write to tmp -> rename)

### Eval
7-day sliding window. Close type histogram, archetype stats, profit factor, thesis exit rate.

## Структура src/

```
src/
  client.ts, config.ts, index.ts, logger.ts, rate-limiter.ts
  tools/           — 16 agent tools + projection.ts (LLM response projections)
  safety/          — safety gates, penalties
  screening/       — скрининг кандидатов
  position/        — BarrierManager, triple barrier
  state/           — state layer, atomic writes
  dexscreener/     — DexScreener API клиент
  gecko/           — GeckoTerminal API клиент
  verify/          — верификация токенов
  eval/            — оценка производительности
  simulation/      — симуляция стратегий
  quota/           — API budget management
  http/            — HTTP client
  types/           — TypeScript типы
```

## Projection Layer (tools/projection.ts)

Two-tier система проекций для контроля LLM token consumption:

### Pool projections
- `projectPoolInfoFull` — 42 → 37 полей (для `screen_tokens`). Убраны: name, socials[], websites[], priceNative, baseTokenPriceUsd. Все торговые данные сохранены.
- `projectPoolInfoCompact` — 42 → 20 полей (для `find`). Lookup-level: достаточно чтобы решить "верифицировать ли".

### Other projections
- `projectVerificationResult` — убираются raw OHLCV candles, остаются числовые метрики: volumeRatio1h/5h, priceChange1h/5h, avgCandleRange1h/5h, buyPressure
- `projectMarketState` — MarketState → MarketBriefing (shortlist + top-5 lists + regime)
- `projectOrganicity` — verdict + score + failedSignals only

### Tool descriptions
Все 16 tool descriptions сокращены до 1 предложения (~300 tokens экономии на каждый LLM вызов).

### topLists
Ограничены до top-5 (было top-10) в daemon и в projectMarketState.

**Правило:** Новые tools ДОЛЖНЫ возвращать computed summaries, НЕ raw data. Проекция на границе tool handler. НЕ удалять торговые данные — удалять только подтверждённо неиспользуемые поля.

## Screening defaults (TON DEX)

- minLiquidityUsd: 1000
- minVolume: 300-500 (по архетипу)

## Связи с другими проектами

- **Trust API** (`~/trust_api/sdk/`) — серверная часть SDK, см. `~/trust_api/CLAUDE.md`
- **Storm SDK** (`~/storm-sdk/`) — аналогичный SDK для фьючерсов, см. `~/storm-sdk/CLAUDE.md`
- Вызывает внешние API: DexScreener, GeckoTerminal — лимиты см. `~/.claude/projects/-home-voxdecaelo/memory/reference_api_providers.md`

## Команды

```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Daemon
npm run daemon:start    # запуск через pm2
npm run daemon:stop     # остановка
npm run daemon:status   # статус
```

## Связанные документы

- Корневой контекст: `~/CLAUDE.md`
- Storm SDK (фьючерсы): `~/storm-sdk/CLAUDE.md`
- Trust API (серверная часть): `~/trust_api/CLAUDE.md`
- Архитектура v2: `~/.claude/projects/-home-voxdecaelo/memory/project_sdk_architecture.md`
- API провайдеры: `~/.claude/projects/-home-voxdecaelo/memory/reference_api_providers.md`
