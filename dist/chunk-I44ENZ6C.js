// src/verify/signals.ts
function computeSignals(pool, geckoPool) {
  let volumeAcceleration = null;
  const vol1h = pool?.volume1hUsd ?? geckoPool?.volume.h1 ?? 0;
  const vol6h = pool?.volume6hUsd ?? geckoPool?.volume.h6 ?? 0;
  if (vol6h >= 100) {
    volumeAcceleration = vol1h / (vol6h / 6);
  }
  let buyPressure = null;
  const buys1h = pool?.buys1h ?? geckoPool?.transactions.h1.buys ?? 0;
  const sells1h = pool?.sells1h ?? geckoPool?.transactions.h1.sells ?? 0;
  if (buys1h + sells1h >= 10) {
    buyPressure = buys1h / (buys1h + sells1h);
  }
  let buyerAcceleration = null;
  if (geckoPool) {
    const buyers1h = geckoPool.transactions.h1.buyers;
    const buyers6h = geckoPool.transactions.h6.buyers;
    if (buyers6h >= 6) {
      buyerAcceleration = buyers1h / (buyers6h / 6);
    }
  }
  return { volumeAcceleration, buyPressure, buyerAcceleration };
}
function buildConfidence(tokenInfo, geckoPool, signals, organicity) {
  const confirming = [];
  const contradicting = [];
  if (organicity.verdict === "organic") confirming.push("organic buyers");
  else if (organicity.verdict === "suspicious") contradicting.push("suspicious trading activity");
  else contradicting.push("wash trading detected");
  if (signals.volumeAcceleration != null) {
    if (signals.volumeAcceleration > 2) confirming.push("volume accelerating");
    else if (signals.volumeAcceleration < 0.5) contradicting.push("volume decelerating");
  }
  if (signals.buyPressure != null) {
    if (signals.buyPressure > 0.6) confirming.push("strong buy pressure");
    else if (signals.buyPressure < 0.4) contradicting.push("sell pressure dominant");
  }
  if (signals.buyerAcceleration != null) {
    if (signals.buyerAcceleration > 1.5) confirming.push("new buyers accelerating");
    else if (signals.buyerAcceleration < 0.5) contradicting.push("buyer interest fading");
  }
  if (tokenInfo?.gtScore != null) {
    if (tokenInfo.gtScore > 50) confirming.push(`gt_score ${tokenInfo.gtScore.toFixed(0)} > 50`);
    else if (tokenInfo.gtScore < 30) contradicting.push(`gt_score ${tokenInfo.gtScore.toFixed(0)} < 30`);
  }
  if (tokenInfo?.holders) {
    if (tokenInfo.holders.count >= 500) confirming.push(`${tokenInfo.holders.count} holders`);
    else if (tokenInfo.holders.count < 100) contradicting.push(`only ${tokenInfo.holders.count} holders`);
    if (tokenInfo.holders.distributionPercentage.top10 < 40) confirming.push("well-distributed holdings");
    else if (tokenInfo.holders.distributionPercentage.top10 > 60) contradicting.push("concentrated holdings");
  }
  if (geckoPool?.lockedLiquidityPercentage != null && geckoPool.lockedLiquidityPercentage > 50) {
    confirming.push("locked liquidity > 50%");
  } else if (geckoPool?.lockedLiquidityPercentage == null) {
    contradicting.push("no locked liquidity data");
  }
  const total = confirming.length + contradicting.length;
  const score = total > 0 ? Math.round(confirming.length / total * 100) : 50;
  return {
    score,
    confirmingSignals: confirming,
    contradictingSignals: contradicting
  };
}

export {
  computeSignals,
  buildConfidence
};
