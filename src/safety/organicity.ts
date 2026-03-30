/**
 * Anti-Wash Detection (Section VII).
 * Mandatory step in verify_candidate. Without passing, a candidate cannot be verified.
 */

import type { TradeInfo } from '../gecko/types.js';
import type { GeckoPoolInfo } from '../types/v2.js';
import type { OrganicityVerdict, OrganicitySignal } from '../types/v2.js';

/**
 * Check organicity of trading activity for a pool.
 *
 * @param poolInfo - Pool info from GeckoTerminal (for unique buyer/seller counts)
 * @param trades - Recent trade history from GeckoTerminal (for wallet analysis)
 * @returns OrganicityVerdict with signals and verdict
 */
export function checkOrganicity(
  poolInfo: GeckoPoolInfo,
  trades: TradeInfo[],
): OrganicityVerdict {
  const signals: OrganicitySignal[] = [];

  const txn1h = poolInfo.transactions.h1;

  // Signal 1: Buyer diversity ratio (h1)
  // unique_buyers / total_buys >= 0.2
  const buyerDiversity = txn1h.buys > 0 ? txn1h.buyers / txn1h.buys : 0;
  signals.push({
    name: 'buyer_diversity_ratio_h1',
    value: buyerDiversity,
    threshold: 0.2,
    passed: buyerDiversity >= 0.2,
  });

  // Signal 2: Seller diversity ratio (h1)
  // unique_sellers / total_sells >= 0.15
  const sellerDiversity = txn1h.sells > 0 ? txn1h.sellers / txn1h.sells : 1;
  signals.push({
    name: 'seller_diversity_ratio_h1',
    value: sellerDiversity,
    threshold: 0.15,
    passed: sellerDiversity >= 0.15,
  });

  // Signal 3: Buy-sell wallet overlap
  // If >50% of wallets both buy AND sell, it's wash
  const buyWallets = new Set<string>();
  const sellWallets = new Set<string>();
  for (const trade of trades) {
    if (trade.kind === 'buy') {
      buyWallets.add(trade.txFromAddress);
    } else {
      sellWallets.add(trade.txFromAddress);
    }
  }
  const allWallets = new Set([...buyWallets, ...sellWallets]);
  let overlapCount = 0;
  for (const w of allWallets) {
    if (buyWallets.has(w) && sellWallets.has(w)) overlapCount++;
  }
  const overlapRatio = allWallets.size > 0 ? overlapCount / allWallets.size : 0;
  signals.push({
    name: 'buy_sell_wallet_overlap',
    value: overlapRatio,
    threshold: 0.5,
    passed: overlapRatio < 0.5,  // PASS if overlap < 50%
  });

  // Signal 4: Top-3 wallet concentration
  // If top 3 wallets = >70% of volume, suspicious
  const walletVolume = new Map<string, number>();
  let totalVolume = 0;
  for (const trade of trades) {
    const current = walletVolume.get(trade.txFromAddress) ?? 0;
    walletVolume.set(trade.txFromAddress, current + trade.volumeInUsd);
    totalVolume += trade.volumeInUsd;
  }
  const sortedWallets = [...walletVolume.entries()].sort((a, b) => b[1] - a[1]);
  const top3Volume = sortedWallets.slice(0, 3).reduce((sum, [, v]) => sum + v, 0);
  const top3Ratio = totalVolume > 0 ? top3Volume / totalVolume : 0;
  signals.push({
    name: 'top3_wallet_concentration',
    value: top3Ratio,
    threshold: 0.7,
    passed: top3Ratio < 0.7,  // PASS if top 3 < 70%
  });

  // Signal 5: Minimum absolute unique buyers (h1)
  // At least 5 unique buyer wallets
  signals.push({
    name: 'min_unique_buyers_h1',
    value: txn1h.buyers,
    threshold: 5,
    passed: txn1h.buyers >= 5,
  });

  // Verdict logic
  const failedCount = signals.filter((s) => !s.passed).length;
  let verdict: OrganicityVerdict['verdict'];
  if (failedCount === 0) {
    verdict = 'organic';
  } else if (failedCount <= 2) {
    verdict = 'suspicious';
  } else {
    verdict = 'wash';
  }

  // Score: 100 if all pass, reduced by ~20 per failure
  const score = Math.max(0, Math.round(100 - (failedCount / signals.length) * 100));

  return { verdict, score, signals };
}
