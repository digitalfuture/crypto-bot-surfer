import {
  getPrevDayData,
  getTradingTickers,
} from "../../../api/binance/info.js";
import {
  getLastPrice,
  getCandlestickData,
  getMarketAverageOscillator,
} from "../../../api/binance/info.js";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const primarySymbol = process.env.PRIMARY_SYMBOL;
const secondarySymbol = process.env.SECONDARY_SYMBOL;
const ticker = primarySymbol + secondarySymbol;
const openai = new OpenAI({ apiKey });

/**
 * Fetch AI-generated trading signal using candlestick and volume data.
 * @param {string} ticker The trading ticker (e.g., BTCUSDT).
 * @param {Array} candlestickData Historical candlestick data with volume.
 */
async function getAISignal(ticker, candlestickData) {
  try {
    const candlestickSummary = candlestickData
      .map(({ time, open, high, low, close, volume }) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      }))
      .slice(-20); // Include only the last 20 candlesticks for analysis.

    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a trading assistant analyzing candlestick and volume data. Generate a BUY, SELL, or HOLD recommendation based on trends and momentum.",
        },
        {
          role: "user",
          content: `Analyze the following data for ${ticker} and provide a recommendation:\n\n${JSON.stringify(
            candlestickSummary
          )}`,
        },
      ],
    });

    const outputText = chatCompletion.choices[0].message.content.trim();

    const recommendation = {
      datetime: new Date().toISOString(),
      ticker,
      signal: /BUY/.test(outputText)
        ? "BUY"
        : /SELL/.test(outputText)
          ? "SELL"
          : "HOLD",
    };

    return recommendation;
  } catch (error) {
    throw { type: "Get AI Signal Error", ...error };
  }
}

/**
 * Main function to fetch market data, process it, and generate trading signals.
 */
export async function getTradeSignals() {
  try {
    const tradingTickers = await getTradingTickers();
    const priceListData = await getPrevDayData();
    const btcUsdtPrice = await getLastPrice("BTCUSDT");

    // Filter tickers to include only relevant ones.
    const tickerList = priceListData
      .map(({ symbol, priceChangePercent, lastPrice, volume }) => ({
        primarySymbol: symbol.split(secondarySymbol)[0],
        secondarySymbol,
        tickerName: symbol,
        priceChangePercent: parseFloat(priceChangePercent),
        lastPrice: parseFloat(lastPrice),
        volume,
      }))
      .filter(({ tickerName }) => tickerName.endsWith(secondarySymbol))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("DOWN"))
      .filter(({ primarySymbol }) => !primarySymbol.endsWith("UP"))
      .filter(({ primarySymbol }) =>
        tradingTickers.includes(primarySymbol + secondarySymbol)
      );

    const candlestickData = await getCandlestickData({
      tickerName: ticker,
      interval: process.env.HEARTBEAT_INTERVAL,
      periods: process.env.BACKTEST_PERIODS,
    });

    const transformedData = candlestickData.map(
      ([time, open, high, low, close, volume]) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      })
    );

    const { signal } = await getAISignal(ticker, transformedData);

    const tradingTicker = tickerList.find(
      (item) => item.primarySymbol === primarySymbol
    );

    const buyPrice = tradingTicker ? parseFloat(tradingTicker.lastPrice) : null;
    const isBuySignal = signal === "BUY";
    const isSellSignal = signal === "SELL";
    const sellPrice = buyPrice;

    const marketAveragePrice = getMarketAverageOscillator(tickerList);

    return {
      buyPrimarySymbol: primarySymbol,
      sellPrimarySymbol: primarySymbol,
      buyTickerName: ticker,
      sellTickerName: ticker,
      buyPrice,
      sellPrice,
      buyTickerPriceChangePercent: tradingTicker?.priceChangePercent,
      sellTickerPriceChangePercent: tradingTicker?.priceChangePercent,
      isBuySignal,
      isSellSignal,
      btcUsdtPrice,
      marketAveragePrice,
    };
  } catch (error) {
    throw { type: "Get Trade Signals Error", ...error };
  }
}
