// strategies/volatility/getTradeSignals.js
import util from "node:util";
import {
  getCandlestickData,
  getTradingTickersFutures,
  getPrevDayData,
  getPrevDayDataFutures,
} from "../../../api/binance/info.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.BACKTEST_INTERVAL;
const periods = parseInt(process.env.BACKTEST_PERIODS, 10);
// Multiplier for calculating Stop-Loss (SL = price * (1 + volatility * SYSTEM_PARAM_1))
const stopMultiplier = parseFloat(process.env.SYSTEM_PARAM_1);
// Multiplier for calculating Take-Profit (TP = price * (1 - volatility * SYSTEM_PARAM_2))
const takeProfitMultiplier = parseFloat(process.env.SYSTEM_PARAM_2);
// Minimum price change percentage required to generate a SELL signal
const minPriceChangePercent = parseFloat(process.env.SYSTEM_PARAM_3);
// Minimum acceptable 24h volume in USDT for a token to be considered
const MIN_ACCEPTABLE_VOLUME_USDT = 100000; // 100,000 USDT

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    const now = Date.now();
    const tradingTickersFutures = await getTradingTickersFutures();
    const prevDayDataSpot = await getPrevDayData();
    const prevDayDataFuturesRaw = await getPrevDayDataFutures();

    const futuresPriceMap = new Map();
    if (prevDayDataFuturesRaw && Array.isArray(prevDayDataFuturesRaw)) {
      prevDayDataFuturesRaw.forEach((item) => {
        if (item.symbol && item.symbol.endsWith(secondarySymbol)) {
          futuresPriceMap.set(item.symbol, parseFloat(item.lastPrice));
        }
      });
    }

    let {
      symbol = null,
      stopLoss = null,
      shortPrice = null,
      takeProfit = null,
    } = state;

    // --- Изменено: Логика формирования и оценки кандидатов ---
    // 1. Сначала формируем базовый список кандидатов
    const rawTickerList = prevDayDataSpot
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const price = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        const prevEntry = lastPriceSnapshot[itemSymbol];
        let delta = null;
        let deltaTimeMs = null;

        if (prevEntry && prevEntry.price !== undefined) {
          delta = ((price - prevEntry.price) / prevEntry.price) * 100;
          deltaTimeMs = now - prevEntry.timestamp;
        }

        lastPriceSnapshot[itemSymbol] = {
          price: price,
          timestamp: now,
        };

        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

        return {
          primarySymbol,
          secondarySymbol,
          symbol: itemSymbol,
          priceChangePercent: delta,
          deltaTimeMs: deltaTimeMs,
          isCalculatedDelta: delta !== null,
          lastPrice: price, // Spot price
          volume: vol,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedDelta }) => isCalculatedDelta)
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT);

    // 2. Рассчитываем "рейтинг" для каждого кандидата
    const ratedTickerList = rawTickerList.map((item) => {
      const { priceChangePercent, volume, lastPrice } = item;

      // Базовый скор: отрицательное значение priceChangePercent (падение)
      // Умножаем на объем для приоритета более ликвидных
      // Делим на цену, чтобы избежать слишком сильной предвзятости к дорогим токенам
      // Используем Math.abs для корректной работы с отрицательными значениями
      let score = 0;
      if (priceChangePercent !== null && priceChangePercent < 0) {
        // Основной компонент: скорость падения * объем / цена
        score = (Math.abs(priceChangePercent) * volume) / lastPrice;

        // Дополнительный компонент: если падение достаточно сильное, увеличиваем скор
        // Это имитирует идею "падает быстрее всех и значительно"
        if (Math.abs(priceChangePercent) > minPriceChangePercent) {
          score *= 1.5; // Бонус за превышение порога
        }
      }

      return {
        ...item,
        score: score,
      };
    });

    // 3. Сортируем по убыванию рейтинга и берем топ
    const resolvedTickerList = ratedTickerList
      .sort((a, b) => b.score - a.score)
      .slice(0, 250); // Ограничиваем для производительности

    // --- Конец изменения ---

    if (!resolvedTickerList.length) {
      return {
        symbol: null,
        price: null,
        priceChangePercent: 0,
        signal: null,
        stopLoss: null,
        takeProfit: null,
        shortPrice: null,
      };
    }

    let signal = null;
    let exitReason = null;
    let price = null;
    let priceChangePercent = 0;

    if (!symbol) {
      console.log(`🔍 Resolved tokens: ${resolvedTickerList.length}`);
      console.log("🔍 No active position. Searching for a short entry...");

      // --- Изменено: Выбор токена на основе рейтинга ---
      const tokenToConsider = resolvedTickerList[0]; // Токен с наивысшим рейтингом

      // Проверяем, достаточно ли высокий рейтинг (падение + объем + цена)
      // И превышает ли падение наш минимальный порог
      if (
        !tokenToConsider ||
        tokenToConsider.score <= 0 ||
        tokenToConsider.priceChangePercent > 0 || // Убеждаемся, что это падение
        Math.abs(tokenToConsider.priceChangePercent) < minPriceChangePercent
      ) {
        console.log(
          `No suitable token found based on rating or threshold. Best candidate ${tokenToConsider?.symbol || "N/A"} changed by ${tokenToConsider?.priceChangePercent?.toFixed(4) || "N/A"}%, score: ${tokenToConsider?.score?.toFixed(2) || "N/A"}`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: 0,
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const token = tokenToConsider;
      // --- Конец изменения ---

      const { symbol: tokenSymbol, priceChangePercent: tokenDelta } = token;

      const futuresPriceForToken = futuresPriceMap.get(tokenSymbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${tokenSymbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: 0,
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const candles = await getCandlestickData({
        symbol: tokenSymbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      price = futuresPriceForToken;
      priceChangePercent = tokenDelta;
      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      shortPrice = price;
      symbol = tokenSymbol;
      signal = "SELL";
    } else {
      // Логика для открытой позиции остается прежней
      let currentTicker = resolvedTickerList.find(
        (ticker) => ticker.symbol === symbol
      );

      const currentFuturesPrice = futuresPriceMap.get(symbol);
      if (currentFuturesPrice === undefined || currentFuturesPrice <= 0) {
        console.warn(
          `Could not get futures price for open position ${symbol}.`
        );
      }

      if (!currentTicker) {
        const raw = prevDayDataSpot.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");

        if (lastPriceFallback > 0) {
          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: 0,
          };

          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`⚠️ Fallback: ${symbol} restored from prevDayDataSpot`);
          }
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice;
        priceChangePercent = currentTicker.priceChangePercent;

        if (price < shortPrice || shortPrice === null) {
          const candles = await getCandlestickData({
            symbol,
            interval,
            periods,
          });

          const volatility =
            candles.reduce((acc, [, , high, low, close]) => {
              return acc + Math.abs((high - low) / close);
            }, 0) / candles.length;

          const dynamicFactor = stopMultiplier * volatility * 1.2;
          const troughPrice = price;
          const newTrailingStop = troughPrice * (1 + dynamicFactor);

          stopLoss =
            stopLoss !== null
              ? Math.min(stopLoss, newTrailingStop)
              : newTrailingStop;
          shortPrice = troughPrice;
        }

        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP";
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL";
        }
      }
    }

    if (process.env.MODE === "DEVELOPMENT") {
      console.log("Trade Signal: ");
      console.log(
        util.inspect(
          {
            symbol,
            price,
            stopLoss,
            takeProfit,
            priceChangePercent,
            signal,
            exitReason,
            shortPrice,
          },
          { depth: null, colors: true }
        )
      );
    }

    return {
      symbol,
      price,
      priceChangePercent,
      signal,
      stopLoss,
      takeProfit,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
