import { sendMessage } from "./api/telegram/telegram.js";
// import { sendImage } from "./api/telegram/telegram.js";
// import { prepareChartData } from "./analytics/charts.js";
import { getLastPrice } from "./api/binance/info.js";
import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getTradeSignals } from "./analytics/indicators/top-gainer-trailing-stop-list.js";
import { report } from "./analytics/report.js";
import util from "node:util";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const minChangePercent = parseFloat(process.env.MIN_CHANGE_PERCENT);
const isfixedValue = JSON.parse(process.env.USE_FIXED_TRADE_VALUE);
const fixedValue = parseFloat(process.env.FIXED_TRADE_VALUE);
const fixedPercent = parseFloat(process.env.FIXED_TRADE_PERCENT);
const usedSymbolsLength = parseInt(process.env.USED_SYMBOLS_LENGTH);
const appMode = process.env.MODE;

const heartbeatInterval = getHeartbeatInterval(interval);

let loopCount = 1;

const balancesInit = [{ symbol: secondarySymbol, available: 100, usdtRate: 1 }];
let balances = balancesInit;
let currentSymbol = null;
let lastTrade = { symbol: secondarySymbol, price: 1 };
let lastCheck = { symbol: secondarySymbol, price: 1 };
const usedSymbols = [];

export default async function start() {
  console.log("\nTEST mode is active");
  // console.log("\nusedSymbolsLength:", usedSymbolsLength);

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

      console.info(
        `Error source data:`,
        util.inspect(errorSrcData, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );

      await sendMessage(`<b>${type || ""}:</b>\n${JSON.parse(body).msg}`);
    } else {
      console.info(
        `\nUnexpected Error:`,
        util.inspect(error, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );
      console.info(
        `Error source data:`,
        util.inspect(errorSrcData, {
          showHidden: false,
          depth: null,
          colors: true,
        })
      );

      await sendMessage(
        `<b>Unexpected Error:</b> Look at the server logs for details`
      );
    }
  }
}

async function startServer() {
  try {
    console.info("\n");
    console.info(`${secondarySymbol} Bot started`);
    console.info("Interval:", interval);

    const intervalString = interval.endsWith("s")
      ? heartbeatInterval / 1000 + "s"
      : heartbeatInterval / 1000 / 60 + "m";

    console.info("Heartbeat interval:", intervalString);

    let startMessage = `<b>${secondarySymbol} Bot started</b>\n\n`;
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
      // sellTickerPriceChangePercent,
      buyTickerPriceChangePercent,
      isSellSignal,
      isBuySignal,
    } = await getTradeSignals({
      secondarySymbol,
      currentSymbol,
      accountBalance: usdtRateTotalBalance,
      minOrderValue: isfixedValue
        ? fixedValue
        : (usdtRateTotalBalance / 100) * fixedPercent,
      minChangePercent,
      lastTrade,
      lastCheck,
      usedSymbols,
    });

    console.info("\n\nCurrent symbol:", currentSymbol);

    if (isSellSignal && currentSymbol) {
      console.info("\n");
      console.info("Sell condition:", true);

      // console.info(
      //   "usedSymbols.length === usedSymbolsLength:",
      //   usedSymbols.length === usedSymbolsLength
      // );

      if (usedSymbols.length === usedSymbolsLength) {
        usedSymbols.shift();
      }

      if (currentSymbol) {
        usedSymbols.push(currentSymbol);
        currentSymbol = null;
      }

      console.log("\nusedSymbols: after sell", usedSymbols);

      const newPrimarySymbolBalance = 0;

      lastCheck = { symbol: secondarySymbol, price: 1 };

      // const chart = await prepareChartData({
      //   primarySymbol: sellPrimarySymbol,
      //   secondarySymbol,
      //   interval: "1d",
      //   priceChangePercent: sellTickerPriceChangePercent,
      // });

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

      // await sendImage(chart);
      await sendMessage(message);
    } else if (isBuySignal && !currentSymbol) {
      console.info("\n");
      console.info("Buy condition:", true);

      const primarySymbolUsdtPrice = await getLastPrice(
        buyPrimarySymbol + "USDT"
      );

      // const chart = await prepareChartData({
      //   primarySymbol: buyPrimarySymbol,
      //   secondarySymbol,
      //   interval: "1d",
      //   priceChangePercent: buyTickerPriceChangePercent,
      // });

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

      currentSymbol = buyPrimarySymbol;
      lastTrade = { symbol: buyPrimarySymbol, price: buyPrice };
      lastCheck = lastTrade;

      console.info("\n\nNew current symbol:", currentSymbol);

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

      // await sendImage(chart);
      await sendMessage(message);
    } else {
      lastCheck = { symbol: sellPrimarySymbol, price: sellPrice };
    }

    console.info("\nlastCheck:", lastCheck);
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}