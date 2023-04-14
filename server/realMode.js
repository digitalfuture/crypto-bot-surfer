import { sendMessage, sendImage } from "./api/telegram/telegram.js";
import { marketBuy, marketSell } from "./api/binance/trading.js";
import { prepareChartData } from "./analytics/charts.js";
import {
  getLastPrice,
  getSymbolBalance,
  getAccountBalances,
} from "./api/binance/info.js";
import { delay, getHeartbeatInterval } from "./helpers/functions.js";
import { getSignals } from "./analytics/indicators/index.js";

const secondarySymbol = process.env.SECONDARY_SYMBOL;
const interval = process.env.HEARTBEAT_INTERVAL;
const indicator = process.env.INDICATOR;
const minTradeUsdValue = parseFloat(process.env.MIN_TRADE_USD_VALUE);
const minChangePercent = parseFloat(process.env.MIN_CHANGE_PERCENT);
const isfixedValue = JSON.parse(process.env.USE_FIXED_TRADE_VALUE);
const fixedValue = parseFloat(process.env.FIXED_TRADE_VALUE);
const fixedPercent = parseFloat(process.env.FIXED_TRADE_PERCENT);
const appMode = process.env.MODE;
const heartbeatInterval = getHeartbeatInterval(interval);

let loopCount = 1;
let currentSymbols = [];
let currentSymbol = null;
let lastTrade = { symbol: secondarySymbol, price: 1 };
let lastCheck = { symbol: secondarySymbol, price: 1 };

export default async function start() {
  console.log("\nREAL mode is active");
  console.info(`${secondarySymbol} Bot started`);

  // Disable console output for PRODUCTION mode
  if (appMode === "PRODUCTION") console.info = () => {};

  try {
    await startServer();
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
        `<b>Unexpected Error:</b> Look server logs for details`
      );
    }
  }
}

async function startServer() {
  try {
    console.info("\n");
    console.info(`${secondarySymbol} Bot started`);

    console.info("Heartbeat interval:", interval);
    console.info("Using indicator:", indicator);

    let startMessage = `<b>${secondarySymbol} Surfer Bot started</b>\n\n`;
    startMessage += `<b>Chart Interval:</b> 1d\n`;
    startMessage += `<b>Hearbeat interval:</b> ${interval}\n`;
    await sendMessage(startMessage);

    await getStartupBalances();
    await startLoop();
  } catch (error) {
    throw { type: "Start Server Error", ...error, errorSrcData: error };
  }
}

async function getStartupBalances() {
  try {
    const balances = await getBalances();

    const filteredBalances = balances.filter(({ usdtRate }) => {
      // ToDo: use min value from Binance instead of fixed number
      return usdtRate > minTradeUsdValue;
    });

    console.info("\nAccount Balances:", filteredBalances);

    const currentSymbols = filteredBalances
      .map((balance) => balance.symbol)
      .filter((symbol) => symbol !== secondarySymbol);

    console.info("\ncurrentSymbols:", currentSymbols);
    console.info("\nSelected currentSymbol", currentSymbol);

    let message = `<b>Current account balances:</b>\n\n`;

    let sum = 0;

    for (const balance of balances) {
      sum += balance.usdtRate;
      message += `<b>${balance.available} ${
        balance.symbol
      }</b> = ${balance.usdtRate.toFixed(2)} USDT \n`;
    }

    message += `\n<b>USDT rate total balance:</b> ${sum.toFixed(2)} USDT \n`;

    await sendMessage(message);
  } catch (error) {
    throw { type: "Get Startup Balances Error", ...error, errorSrcData: error };
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

    const accountBalances = await getBalances();

    const usdtRateTotalBalance = accountBalances.reduce((sum, balance) => {
      sum += balance.usdtRate;
      return sum;
    }, 0);

    const {
      sellPrimarySymbol,
      buyPrimarySymbol,
      sellTickerName,
      buyTickerName,
      sellPrice,
      buyPrice,
      sellTickerPriceChangePercent,
      buyTickerPriceChangePercent,
      isSellSignal,
      isBuySignal,
    } = await getSignals({
      secondarySymbol,
      currentSymbol,
      accountBalance: usdtRateTotalBalance,
      minOrderValue: isfixedValue
        ? fixedValue
        : (usdtRateTotalBalance / 100) * fixedPercent,
      minChangePercent,
      lastTrade,
      lastCheck,
    });

    const secondarySymbolUsdtPrice =
      secondarySymbol === "USDT"
        ? 1
        : await getLastPrice(secondarySymbol + "USDT");

    if (isSellSignal) {
      console.info("\n");
      console.info("\n\nCheck", sellTickerName);
      console.info("Sell condition:", isSellSignal);

      message += "<b>Sell signal</b>\n\n";

      const { quantity, status, srcData, result } = await marketSell({
        primarySymbol: sellPrimarySymbol,
        secondarySymbol,
        tickerName: sellTickerName,
      });

      if (!result) {
        console.info(`No trade result`);
        return;
      }

      console.info(`Trade result:`, status);

      if (status !== "FILLED" || isNaN(quantity)) {
        console.info(`Unexpected result. Response data:`, srcData);
        message += `Unexpected result. Check server logs for details.\n`;

        await sendMessage(message);
        return;
      }

      const chart = await prepareChartData({
        primarySymbol: sellPrimarySymbol,
        secondarySymbol,
        interval: "1d",
        priceChangePercent: sellTickerPriceChangePercent,
      });

      const newPrimarySymbolBalance = await getSymbolBalance(sellPrimarySymbol);
      const newSecondarySymbolBalance = await getSymbolBalance(secondarySymbol);
      const primarySymbolUsdtPrice = await getLastPrice(
        sellPrimarySymbol + "USDT"
      );

      if (currentSymbol) {
        currentSymbol = null;
      }

      lastCheck = { symbol: secondarySymbol, price: 1 };

      const accountBalances = await getBalances();

      console.info("accountBalance:", accountBalances);

      const usdtRateTotalBalance = accountBalances.reduce((sum, balance) => {
        sum += balance.usdtRate;
        return sum;
      }, 0);

      console.info("New balance:\n");
      console.info(`${newPrimarySymbolBalance} ${sellPrimarySymbol}`);
      console.info(`${newSecondarySymbolBalance} ${secondarySymbol}`);
      console.info(`${sellPrimarySymbol} price: ${primarySymbolUsdtPrice}`);
      console.info(`${secondarySymbol} price: ${secondarySymbolUsdtPrice}`);

      console.info(
        `USDT rate total balance: ${usdtRateTotalBalance.toFixed(2)}`
      );

      message += `<b>${sellPrimarySymbol} price</b>: ${parseFloat(
        sellPrice
      )} ${secondarySymbol}\n`;
      message += `<b>Sold</b>: ${quantity} ${sellPrimarySymbol}\n\n`;
      message += `<b>${sellPrimarySymbol} balance</b>: ${parseFloat(
        newPrimarySymbolBalance
      )}\n`;
      message += `<b>${secondarySymbol} balance</b>: ${newSecondarySymbolBalance}\n\n`;
      message += `<b>USDT rate total balance</b>: ${usdtRateTotalBalance.toFixed(
        2
      )}`;

      console.info("Trade accomplished");

      await sendImage(chart);
      await sendMessage(message);
    } else if (isBuySignal) {
      console.info("\n");
      console.info("\n\nCheck", buyTickerName);
      console.info("Buy condition:", isBuySignal);

      message += `<b>Buy signal</b>\n\n`;

      const primarySymbolUsdtPrice = await getLastPrice(
        buyPrimarySymbol + "USDT"
      );
      const secondarySymbolBalance = await getSymbolBalance(secondarySymbol);

      const { quantity, status, srcData, result } = await marketBuy({
        primarySymbol: buyPrimarySymbol,
        secondarySymbol,
        tickerName: buyTickerName,
        secondarySymbolBalance,
      });

      console.info("\n");
      console.info(`status:`, status);
      console.info(`quantity:`, quantity);
      console.info(`result:`, result);

      if (!result) {
        console.info(`No trade result.`);
        return;
      }

      if (status !== "FILLED" || isNaN(quantity)) {
        console.info(`Unexpected result. Response data:`, srcData);
        message += `Unexpected result. Check server logs for details.\n`;

        await sendMessage(message);

        return;
      }

      const chart = await prepareChartData({
        primarySymbol: buyPrimarySymbol,
        secondarySymbol,
        interval: "1d",
        priceChangePercent: buyTickerPriceChangePercent,
      });

      currentSymbols.push(buyPrimarySymbol);

      const newPrimarySymbolBalance = await getSymbolBalance(buyPrimarySymbol);
      const newSecondarySymbolBalance = await getSymbolBalance(secondarySymbol);

      const accountBalances = await getBalances();

      console.info("accountBalances:", accountBalances);

      const usdtRateTotalBalance = accountBalances.reduce((sum, balance) => {
        sum += balance.usdtRate;
        return sum;
      }, 0);

      currentSymbol = buyPrimarySymbol;
      lastTrade = { symbol: buyPrimarySymbol, price: buyPrice };
      lastCheck = lastTrade;

      console.info("\n\nNew current symbol:", currentSymbol);

      console.info("New balances");
      console.info(`${newPrimarySymbolBalance} ${buyPrimarySymbol}`);
      console.info(`${newSecondarySymbolBalance} ${secondarySymbol}`);
      console.info(`${buyPrimarySymbol} price: ${primarySymbolUsdtPrice}`);
      console.info(`${secondarySymbol} price: ${secondarySymbolUsdtPrice}`);

      console.info(`USDT rate total balance: ${usdtRateTotalBalance}`);

      message += `<b>${buyPrimarySymbol} price</b>: ${parseFloat(
        buyPrice
      )} ${secondarySymbol}\n`;
      message += `<b>Bought</b>: ${quantity} ${buyPrimarySymbol}\n\n`;
      message += `<b>${buyPrimarySymbol} balance</b>: ${parseFloat(
        newPrimarySymbolBalance
      )}\n`;
      message += `<b>${secondarySymbol} balance</b>: ${parseFloat(
        newSecondarySymbolBalance
      )}\n\n`;
      message += `<b>USDT rate total balance</b>: ${usdtRateTotalBalance.toFixed(
        2
      )}`;

      console.info("Trade accomplished");

      await sendImage(chart);
      await sendMessage(message);
    } else {
      // message += "<b>No trade signals</b>";
      // await sendMessage(message);

      lastCheck = { symbol: sellPrimarySymbol, price: sellPrice };
    }
  } catch (error) {
    throw { type: "Heartbeat Loop Error", ...error, errorSrcData: error };
  }
}

async function getBalances() {
  try {
    const balances = [];
    const accountBalances = await getAccountBalances();

    for (const balance of accountBalances) {
      if (balance.available === 0) continue;

      const { symbol, available } = balance;

      if (symbol === "USDT") {
        const usdtRate = available;

        balances.push({ symbol, available, usdtRate });
      } else {
        const lastPrice = await getLastPrice(symbol + "USDT");
        const usdtRate = available * lastPrice;

        if (isNaN(usdtRate)) continue;

        balances.push({ symbol, available, usdtRate });
      }
    }

    return balances
      .filter((balance) => balance.available > 0)
      .sort((a, b) => b.usdtRate - a.usdtRate);
  } catch (error) {
    throw { type: "Get Balances Error", ...error, errorSrcData: error };
  }
}
