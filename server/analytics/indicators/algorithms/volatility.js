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
// Minimum price change percentage (GROWTH) required to generate a SELL signal
const minGrowthPercent = parseFloat(process.env.SYSTEM_PARAM_3);
// Minimum acceptable 24h volume in USDT for a token to be considered
const MIN_ACCEPTABLE_VOLUME_USDT = 100000; // 100,000 USDT

// --- Добавлено: Параметры для стратегии "рост -> шорт" ---
// Количество "вызовов" функции назад, чтобы сравнить цену для определения кандидатов на шорт
const GROWTH_LOOKBACK_CALLS =
  parseInt(process.env.GROWTH_LOOKBACK_CALLS, 10) || 12; // По умолчанию 12 вызовов
// --- Конец добавления ---

// --- Добавлено: Внутреннее состояние стратегии ---
// Счетчик вызовов функции getTradeSignals
let callCount = 0;
// История цен для расчета роста
// key: symbol, value: Array of { price: x, timestamp: y, call: z }
let priceHistory = {};
// --- Конец добавления ---

let lastPriceSnapshot = {};

export async function getTradeSignals(state = {}) {
  try {
    // --- Добавлено: Инкремент счетчика вызовов ---
    callCount++;
    const currentCall = callCount;
    // --- Конец добавления ---

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
    // 1. Сначала обновляем историю цен и формируем список кандидатов
    const rawTickerList = prevDayDataSpot
      .map((item) => {
        const { symbol: itemSymbol, lastPrice, volume } = item;
        const currentPrice = parseFloat(lastPrice);
        const vol = parseFloat(volume);

        // --- Добавлено: Обновление истории цен ---
        if (!priceHistory[itemSymbol]) {
          priceHistory[itemSymbol] = [];
        }
        priceHistory[itemSymbol].push({
          price: currentPrice,
          timestamp: now,
          call: currentCall, // Используем внутренний счетчик вызовов
        });

        // Ограничиваем размер истории, чтобы она не росла бесконечно
        // Храним немного больше, чем нужно для lookback, на случай пропусков
        if (priceHistory[itemSymbol].length > GROWTH_LOOKBACK_CALLS * 3) {
          priceHistory[itemSymbol].shift();
        }
        // --- Конец добавления ---

        // --- Изменено: Расчет роста за период ---
        let growthPercent = null;
        let deltaTimeMs = null;

        // Ищем запись из истории, которая была GROWTH_LOOKBACK_CALLS вызовов назад
        const pastEntry = priceHistory[itemSymbol]?.find(
          (entry) => entry.call === currentCall - GROWTH_LOOKBACK_CALLS
        );

        if (pastEntry && pastEntry.price !== undefined && pastEntry.price > 0) {
          growthPercent =
            ((currentPrice - pastEntry.price) / pastEntry.price) * 100;
          deltaTimeMs = now - pastEntry.timestamp;
        }
        // --- Конец изменения ---

        const primarySymbol = itemSymbol.slice(0, -secondarySymbol.length);

        // Обновляем lastPriceSnapshot для совместимости с отчетами и fallback-логикой
        const prevEntryForDelta = lastPriceSnapshot[itemSymbol];
        let deltaForReporting = null;
        if (prevEntryForDelta && prevEntryForDelta.price !== undefined) {
          deltaForReporting =
            ((currentPrice - prevEntryForDelta.price) /
              prevEntryForDelta.price) *
            100;
        }
        lastPriceSnapshot[itemSymbol] = {
          price: currentPrice,
          timestamp: now,
        };

        return {
          primarySymbol,
          secondarySymbol,
          symbol: itemSymbol,
          growthPercent: growthPercent, // Используем growthPercent вместо priceChangePercent
          deltaTimeMs: deltaTimeMs,
          isCalculatedGrowth: growthPercent !== null,
          lastPrice: currentPrice, // Spot price
          volume: vol,
          // Для совместимости и отчетов
          priceChangePercent: deltaForReporting,
        };
      })
      .filter(({ symbol }) => symbol.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) => !primarySymbol.includes("USD"))
      .filter(({ symbol }) => tradingTickersFutures.includes(symbol))
      .filter(({ isCalculatedGrowth }) => isCalculatedGrowth) // Фильтруем по наличию расчета роста
      .filter(({ volume }) => volume > MIN_ACCEPTABLE_VOLUME_USDT);

    // 2. Сортируем по убыванию роста (сначала самые растущие)
    const resolvedTickerList = rawTickerList
      .sort((a, b) => b.growthPercent - a.growthPercent) // Сортировка по убыванию роста
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
    let priceChangePercent = 0; // Для отчета, показывает изменение в момент сигнала

    if (!symbol) {
      console.log(`🔍 Resolved tokens: ${resolvedTickerList.length}`);
      console.log(
        "🔍 No active position. Searching for a short entry (based on highest growth)..."
      );

      // --- Изменено: Выбор токена на основе роста ---
      const tokenToConsider = resolvedTickerList[0]; // Токен с наивысшим ростом

      // Проверяем, достаточно ли высокий рост и превышает ли порог
      if (
        !tokenToConsider ||
        tokenToConsider.growthPercent < minGrowthPercent
      ) {
        // Используем minGrowthPercent
        console.log(
          `No suitable token found based on growth threshold. Best candidate ${tokenToConsider?.symbol || "N/A"} grew by ${tokenToConsider?.growthPercent?.toFixed(4) || "N/A"}%, threshold: ${minGrowthPercent}%`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: tokenToConsider?.priceChangePercent ?? 0, // Для отчета
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const token = tokenToConsider;
      // --- Конец изменения ---

      // Для отчета используем обычное изменение за последний шаг (уже рассчитано)
      priceChangePercent = token.priceChangePercent ?? 0;

      const futuresPriceForToken = futuresPriceMap.get(token.symbol);
      if (futuresPriceForToken === undefined || futuresPriceForToken <= 0) {
        console.warn(
          `Could not get futures price for ${token.symbol}. Skipping signal.`
        );
        return {
          symbol: null,
          price: null,
          priceChangePercent: priceChangePercent, // Передаем рассчитанное изменение
          signal: null,
          stopLoss: null,
          takeProfit: null,
          shortPrice: null,
        };
      }

      const candles = await getCandlestickData({
        symbol: token.symbol,
        interval,
        periods,
      });

      const volatility =
        candles.reduce((acc, [, , high, low, close]) => {
          return acc + Math.abs((high - low) / close);
        }, 0) / candles.length;

      price = futuresPriceForToken;
      // priceChangePercent уже рассчитан выше
      stopLoss = price * (1 + volatility * stopMultiplier);
      takeProfit = price * (1 - volatility * takeProfitMultiplier);
      shortPrice = price;
      symbol = token.symbol;
      signal = "SELL";
    } else {
      // Логика для открытой позиции остается прежней, но использует данные фьючерса
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
        // Fallback к данным спота, если основной список не содержит позицию
        const raw = prevDayDataSpot.find((t) => t.symbol === symbol);
        const lastPriceFallback = parseFloat(raw?.lastPrice || "0");

        if (lastPriceFallback > 0) {
          // Для отчета при fallback
          const prevEntry = lastPriceSnapshot[symbol];
          let fallbackDelta = 0;
          if (prevEntry && prevEntry.price !== undefined) {
            fallbackDelta =
              ((lastPriceFallback - prevEntry.price) / prevEntry.price) * 100;
          }

          currentTicker = {
            symbol,
            lastPrice: lastPriceFallback,
            priceChangePercent: fallbackDelta,
          };

          if (process.env.MODE === "DEVELOPMENT") {
            console.log(`⚠️ Fallback: ${symbol} restored from prevDayDataSpot`);
          }
          priceChangePercent = fallbackDelta;
        }
      }

      if (!currentTicker) {
        signal = "BUY";
        exitReason = "POSITION_NOT_FOUND";
      } else {
        // --- Изменено: Используем цену фьючерса для проверки TP/SL ---
        price =
          currentFuturesPrice !== undefined && currentFuturesPrice > 0
            ? currentFuturesPrice
            : currentTicker.lastPrice;
        // priceChangePercent для отчета по открытой позиции
        priceChangePercent = currentTicker.priceChangePercent ?? 0;
        // --- Конец изменения ---

        // Логика трейлинг-стопа (update stopLoss and shortPrice)
        // Используем цену фьючерса для расчетов
        if (price < shortPrice || shortPrice === null) {
          // Пересчет волатильности по споту (логика сигнала)
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
          const troughPrice = price; // <<<--- Цена фьючерса
          const newTrailingStop = troughPrice * (1 + dynamicFactor);

          stopLoss =
            stopLoss !== null
              ? Math.min(stopLoss, newTrailingStop)
              : newTrailingStop;
          shortPrice = troughPrice; // <<<--- Цена фьючерса
        }

        // Проверка на тейк-профит и стоп-лосс
        if (takeProfit !== null && price <= takeProfit) {
          signal = "BUY";
          exitReason = "TP"; // Take Profit
        } else if (stopLoss !== null && price >= stopLoss) {
          signal = "BUY";
          exitReason = "SL"; // Stop Loss
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
            priceChangePercent, // Отображаем изменение для отчета
            signal,
            exitReason,
            shortPrice,
            // Для отладки
            callCount: currentCall,
          },
          { depth: null, colors: true }
        )
      );
    }

    return {
      symbol,
      price,
      priceChangePercent, // Возвращаем изменение для отчета
      signal,
      stopLoss,
      takeProfit,
      shortPrice,
    };
  } catch (error) {
    throw { type: "Volatility Strategy Error", ...error, errorSrcData: error };
  }
}
