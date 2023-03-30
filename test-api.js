import binance from "./server/api/binance/connection.js";

(async function () {
  try {
    const prices = await binance.prices();
    console.log(prices);
  } catch (err) {
    console.error(err);
  }
})();

// import {
//   getExchangeInfo,
//   // getPrevDayData,
//   // getTradingTickers,
// } from "./server/api/binance/info.js";
// import Binance from "node-binance-api";
// import util from "node:util";

// export const binance = new Binance().options({
//   APIKEY: process.env.BINANCE_APIKEY,
//   APISECRET: process.env.BINANCE_APISECRET,
//   test: true,
//   recWindow: 60000,
//   verbose: true,
//   useServerTime: true,
// });

// test();

// async function test() {
//   try {
//     await getInfo("BNBUSDT");
//     // testGetPrevDayData();
//     // marketBuy("MITHUSDT", 20);
//   } catch (error) {
//     const { statusCode, statusMessage, body, type, errorSrcData } = error;

//     if (statusCode) {
//       console.error(
//         `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
//           JSON.parse(body).msg
//         }`
//       );

//       console.info(
//         `\nError source data:`,
//         util.inspect(errorSrcData, {
//           showHidden: false,
//           depth: null,
//           colors: true,
//         })
//       );
//     } else {
//       console.info(
//         `\nUnexpected Error:`,
//         util.inspect(error, { showHidden: false, depth: null, colors: true })
//       );
//       console.info(
//         `\nError source data:`,
//         util.inspect(errorSrcData, {
//           showHidden: false,
//           depth: null,
//           colors: true,
//         })
//       );
//     }
//   }
// }

// // function delay(ms) {
// //   return new Promise((resolve) => setTimeout(() => resolve(), ms));
// // }

// async function getInfo(tickerName) {
//   try {
//     const data = await getExchangeInfo(tickerName);
//     console.info("\n");
//     console.info(
//       "Exchange info:",
//       util.inspect(data, {
//         showHidden: false,
//         depth: null,
//         colors: true,
//       })
//     );

//     console.info("\n");
//     console.info("tickerName:", tickerName);
//   } catch (error) {
//     throw {
//       type: "Get Exchange Info",
//       ...error,
//       errorSrcData: error,
//     };
//   }
// }

// // async function testGetPrevDayData() {
// //   try {
// //     const data = await getPrevDayData();
// //     const result = data.filter(ticker => ticker.symbol.endsWith('BNB'));

// //     // const result = await  getBalances();
// //     // const result = data.map(balance)

// //     // const result = await marketSell({ tickerName: "FTMUSDT", amount: 3.996});

// //     // console.info(result);
// //     console.info(result.length);
// //   } catch (error) {
// // throw { type: "Get Prev Day Data Error:", ...error, errorSrcData: error };
// // }

// // async function testGetExchangeInfo() {
// //   try {
// //     const data = await getExchangeInfo();
// //     const result = data;

// //     // const result = await  getBalances();
// //     // const result = data.map(balance)

// //     // const result = await marketSell({ tickerName: "FTMUSDT", amount: 3.996});

// //     // console.info(result);
// //     console.info(result);
// //   } catch (error) {
// //     const { statusCode, statusMessage, body, type, errorSrcData } = error;

// //     if (statusCode) {
// //       console.error(
// //         `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
// //           JSON.parse(body).msg
// //         }`
// //       );

// //       console.info(`Error source data:`, errorSrcData);
// //     } else {
// //       console.info(`\nUnexpected Error:`, error);
// //       console.info(`Error source data:`, errorSrcData);
// //     }
// //   }
// // }

// // async function marketBuy(tickerName, amount) {
// //   try {
// //     const data = await binance.marketBuy(tickerName, amount);
// //     console.info("data:", data);
// //   } catch (error) {
// //     throw { type: "Market Buy Error:", ...error, errorSrcData: error };
// //   }
// // }

// // async function marketSell({ tickerName, amount }) {
// //   try {
// //     delay(500);

// //     const { minOrderQuantity, minOrderValue, stepSize } = await getExchangeInfo(
// //       tickerName
// //     );

// //     const sellQuantity = await binance.roundStep(amount, stepSize);

// //     const data = await binance.marketSell(tickerName, sellQuantity);

// //     return data
// //   } catch (error) {
// //     throw { type: "Market Sell Error:", ...error, errorSrcData: error };
// //   }
// // }

// // async function getAccountBalances() {
// // try {
// //   const balances = await binance.balance();

// //   // console.info(balances);

// //   const result = [];

// //   for (const symbol in balances) {
// //     result.push({
// //       symbol,
// //       available: parseFloat(balances[symbol].available),
// //     });
// //   }

// //   return result
// //   } catch (error) {
// //     throw { type: "Get Account Balances Error:", ...error, errorSrcData: error };
// //   }
// // }

// // async function getBalances() {
// //   const balances = [];
// //   const accountBalances = await getAccountBalances();

// //   for (const balance of accountBalances) {
// //     if (balance.available === 0) continue;

// //     const { symbol, available } = balance;

// //     if (symbol === 'USDT') {
// //       const usdtRate = available;

// //       balances.push({ symbol, available, usdtRate });
// //     } else {
// //       const lastPrice = await getLastPrice(symbol + 'USDT');
// //       const usdtRate = available * lastPrice

// //       if (isNaN(usdtRate)) continue

// //       balances.push({ symbol, available, usdtRate });
// //     }
// //   }

// //   return balances.filter((balance) => balance.available > 0);
// // }

// // async function getLastPrice(tickerName) {
// //   await delay(500);

// //   const priceList = await binance.prices();
// //   const tickerPrice = parseFloat(priceList[tickerName]);

// //   return tickerPrice;
// // }

// // async function getPrevDayData() {
// //   try {
// //     const data = await binance.prevDay(false);

// //     console.info((data[0].closeTime - data[0].openTime) / 1000 / 60 / 60, 'hours');

// //     return data;
// //   } catch (error) {
// //     throw { type: "Get Prev Day Data", ...error, errorSrcData: error };
// //   }
// // }
