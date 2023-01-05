import { sendMessage, sendImage } from "./api/telegram/telegram.js";
import { prepareChartData } from "./analytics/charts.js";
import { getLastPrice } from "./api/binance/info.js";
import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getTradeSignals } from "./analytics/indicators/bottom-gainer-test.js";
// import { getTradeSignals } from "./analytics/indicators/top-gainer-test.js";
import { report } from "./analytics/report.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const minChangePercent = parseFloat(process.env.MIN_CHANGE_PERCENT);
const isfixedValue = JSON.parse(process.env.USE_FIXED_TRADE_VALUE);
const fixedValue = parseFloat(process.env.FIXED_TRADE_VALUE);
const fixedPercent = parseFloat(process.env.FIXED_TRADE_PERCENT);
const appMode = process.env.MODE;

const heartbeatInterval = getHeartbeatInterval(interval);

let loopCount = 1;

const balancesInit = [{ symbol: secondarySymbol, available: 100, usdtRate: 1 }];
let balances = balancesInit;
let currentSymbols = [];
let lastTrade = { symbol: "USDT", price: 1 };

export default async function start() {
  console.log("\nTEST mode is active");

  try {
    await startServer();
    await startLoop();
  } catch (error) {
    const { statusCode, statusMessage, body, type, errorSrcData } = error;

    if (statusCode) {
      console.error(
        `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
          JSON.parse(body).msg
        }`
      );

      console.info(`Error source data:`, errorSrcData);

      await sendMessage(`<b>${type || ""}:</b>\n${JSON.parse(body).msg}`);
    } else {
      console.info(`\nUnexpected Error:`, error);
      console.info(`Error source data:`, errorSrcData);

      await sendMessage(
        `<b>Unexpected Error:</b> Look at the server logs for details`
      );
    }
  }
}

async function startServer() {
  try {
    console.info("\n");
    console.info(`${secondarySymbol} Surfer Bot started`);
    console.info("Interval:", interval);

    const intervalString = interval.endsWith("s")
      ? heartbeatInterval / 1000 + "s"
      : heartbeatInterval / 1000 / 60 + "m";

    console.info("Heartbeat interval:", intervalString);

    let startMessage = `<b>${secondarySymbol} Surfer Bot started</b>\n\n`;
    startMessage += `<b>Chart Interval:</b> 1d\n`;
    startMessage += `<b>Hearbeat interval:</b> ${intervalString}\n`;

    await sendMessage(startMessage);
  } catch (error) {
    throw { type: "Start Server Error", ...error, errorSrcData: error };
  }
}

async function startLoop() {
  try {
    while (loopCount) {
      console.info("\n");
      console.info("-----------------------------------------------------");
      console.info("Loop start:", loopCount);

      if (appMode === "DEVELOPMENT") console.time("Loop Time");

      console.info("-----------------------------------------------------");

      await heartBeatLoop();

      console.info("\n");
      console.info("-----------------------------------------------------");
      console.info("Loop end:", loopCount);

      if (appMode === "DEVELOPMENT") console.timeEnd("Loop Time");

      console.info("-----------------------------------------------------");
      console.info("\n");

      await delay(heartbeatInterval);

      loopCount++;
    }
  } catch (error) {
    throw { type: "Start Loop Error", ...error, errorSrcData: error };
  }
}

async function heartBeatLoop() {
  try {
    let message = "";

    const accountBalances = balances;

    const usdtRateTotalBalance = accountBalances.reduce((sum, balance) => {
      sum += balance.usdtRate;
      return sum;
    }, 0);

    const {
      sellPrimarySymbol,
      buyPrimarySymbol,
      sellPrice,
      buyPrice,
      sellTickerPriceChangePercent,
      buyTickerPriceChangePercent,
      isSellSignal,
      isBuySignal,
    } = await getTradeSignals({
      secondarySymbol,
      currentSymbols: currentSymbols,
      accountBalance: usdtRateTotalBalance,
      minOrderValue: isfixedValue
        ? fixedValue
        : (usdtRateTotalBalance / 100) * fixedPercent,
      minChangePercent,
      lastTrade,
    });

    console.info("\n\nAccount balances:", balances);

    if (isSellSignal && currentSymbols.length > 0) {
      console.info("\n");
      console.info("Sell condition:", true);

      const newPrimarySymbolBalance = 0;

      currentSymbols = [];
      balances = balancesInit;

      const chart = await prepareChartData({
        primarySymbol: sellPrimarySymbol,
        secondarySymbol,
        interval: "1d",
        priceChangePercent: sellTickerPriceChangePercent,
      });

      console.info("\n\nNew account balances:", balances);

      message += `<b>${sellPrimarySymbol} price</b>: ${parseFloat(
        sellPrice
      )} ${secondarySymbol}\n`;
      message += `<b>Sold</b>: 1 ${sellPrimarySymbol}\n\n`;
      message += `<b>${sellPrimarySymbol} balance</b>: ${parseFloat(
        newPrimarySymbolBalance
      )}`;

      report({
        date: new Date(),
        trade: "SELL",
        symbol: sellPrimarySymbol,
        price: sellPrice,
        priceChangePercent: buyTickerPriceChangePercent,
      });

      await sendImage(chart);
      await sendMessage(message);
    } else if (isBuySignal && currentSymbols.length === 0) {
      console.info("\n");
      console.info("Buy condition:", true);

      const primarySymbolUsdtPrice = await getLastPrice(
        buyPrimarySymbol + "USDT"
      );

      const chart = await prepareChartData({
        primarySymbol: buyPrimarySymbol,
        secondarySymbol,
        interval: "1d",
        priceChangePercent: buyTickerPriceChangePercent,
      });

      const newPrimarySymbolBalance = 1;

      balances = [
        {
          symbol: buyPrimarySymbol,
          available: 1,
          usdtRate: primarySymbolUsdtPrice,
        },
        {
          symbol: secondarySymbol,
          available: 0,
          usdtRate: 1,
        },
      ];

      currentSymbols = [buyPrimarySymbol];
      lastTrade = { symbol: buyPrimarySymbol, price: buyPrice };

      console.info("\n\nNew account balances:", balances);

      message += `<b>${buyPrimarySymbol} price</b>: ${parseFloat(
        buyPrice
      )} ${secondarySymbol}\n`;
      message += `<b>Bought</b>: ${newPrimarySymbolBalance} ${buyPrimarySymbol}\n\n`;
      message += `<b>${buyPrimarySymbol} balance</b>: ${parseFloat(
        newPrimarySymbolBalance
      )}`;

      report({
        date: new Date(),
        trade: "BUY",
        symbol: buyPrimarySymbol,
        price: buyPrice,
        priceChangePercent: buyTickerPriceChangePercent,
      });

      await sendImage(chart);
      await sendMessage(message);
    } else {
      message += "<b>No trade signals</b>";
    }
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}
