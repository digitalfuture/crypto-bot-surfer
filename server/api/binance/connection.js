// connection.js

import Binance from "node-binance-api";

// const isTestMode = JSON.parse(process.env.TEST_MODE);

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  useServerTime: true,
  recvWindow: 60000,
  verbose: false,
  family: 0,
});

// if (!isTestMode) {
//   const exchangeInfo = await binance.futuresExchangeInfo();
//   const symbols = exchangeInfo.symbols
//     .filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL")
//     .map((s) => s.symbol);

//   for (const symbol of symbols) {
//     try {
//       await binance.futuresMarginType(symbol, "ISOLATED");
//       // console.log(`Set ISOLATED margin for ${symbol}`);

//       await binance.futuresLeverage(symbol, 1);
//       // console.log(`Set ISOLATED margin for ${symbol}`);
//     } catch (error) {
//       if (error.body && error.body.includes("No need to change margin type")) {
//         throw {
//           type: `Already ISOLATED: ${symbol}`,
//           ...error,
//           errorSrcData: error,
//         };
//       } else {
//         throw {
//           type: `Error setting margin for ${symbol}:`,
//           ...error,
//           errorSrcData: error,
//         };
//       }
//     }
//   }
// }

export default binance;
