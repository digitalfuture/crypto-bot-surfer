export function evaluateStrategy(signals, candlestickData) {
  let totalProfit = 0;
  let totalLoss = 0;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  let initialCapital = 1000; // Initial capital

  signals.forEach((signal, index) => {
    if (index === 0) return; // Skip the first element

    const prevSignal = signals[index - 1];
    const currentPrice = candlestickData[index].close;
    const previousPrice = candlestickData[index - 1].close;

    if (prevSignal.isBuySignal && !signal.isSellSignal) {
      // Buy
      totalProfit += currentPrice - previousPrice;
    } else if (!prevSignal.isBuySignal && signal.isSellSignal) {
      // Sell
      totalLoss += previousPrice - currentPrice;
    }

    // Calculate drawdown
    const currentCapital = initialCapital + totalProfit - totalLoss;
    currentDrawdown = Math.max(
      currentDrawdown,
      initialCapital - currentCapital
    );
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
  });

  // Sharpe ratio
  const dailyReturns = signals.map((signal, index) => {
    if (index === 0) return 0; // Skip the first element
    const prevSignal = signals[index - 1];
    const currentPrice = candlestickData[index].close;
    const previousPrice = candlestickData[index - 1].close;
    if (prevSignal.isBuySignal && !signal.isSellSignal) {
      return (currentPrice - previousPrice) / previousPrice;
    } else if (!prevSignal.isBuySignal && signal.isSellSignal) {
      return (previousPrice - currentPrice) / previousPrice;
    }
    return 0;
  });

  const meanReturn =
    dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
      dailyReturns.length
  );
  const sharpeRatio = meanReturn / stdDev;

  // Profit factor
  const profitFactor = totalProfit / totalLoss;

  return {
    sharpeRatio,
    maxDrawdown,
    profitFactor,
  };
}
