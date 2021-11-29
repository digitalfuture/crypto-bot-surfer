import Binance from "node-binance-api";

const BINANCE_APIKEY =
  "OujZyjVM12VHsGGHp4T8WcRojRPIRnR3YC5tmNItIRtbv27OiYMpYuSN4lLJcLJa";
const BINANCE_APISECRET =
  "L2b7IBjQTMUgxYdlmA7c82YVh7fWRlhjbJK1yqtVI5DxclI6ZoIvcAbtXJGw4DAh";

export const binance = new Binance().options({
  APIKEY: BINANCE_APIKEY,
  APISECRET: BINANCE_APISECRET,
  test: false,
  recWindow: 60000,
  verbose: true,
  useServerTime: true,
});

// testGetPrevDayData();
testGetExchangeInfo();


function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

// async function testGetPrevDayData() {
//   try {
//     const data = await getPrevDayData();
//     const result = data.filter(ticker => ticker.symbol.endsWith('BNB'));
    
//     // const result = await  getBalances();
//     // const result = data.map(balance)

//     // const result = await marketSell({ tickerName: "FTMUSDT", amount: 3.996});

//     // console.info(result);
//     console.info(result.length);
//   } catch (error) {
//     const { statusCode, statusMessage, body, type, errorSrcData } = error;
  
//     if (statusCode) {
//       console.error(
//         `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
//           JSON.parse(body).msg
//         }`
//       );
  
//       console.info(`Error source data:`, errorSrcData);
//     } else {
//       console.info(`\nUnexpected Error:`, error);
//       console.info(`Error source data:`, errorSrcData);
//     }
//   }
// }

async function testGetExchangeInfo() {
  try {
    const data = await getExchangeInfo();
    const result = data;
    
    // const result = await  getBalances();
    // const result = data.map(balance)

    // const result = await marketSell({ tickerName: "FTMUSDT", amount: 3.996});

    // console.info(result);
    console.info(result);
  } catch (error) {
    const { statusCode, statusMessage, body, type, errorSrcData } = error;
  
    if (statusCode) {
      console.error(
        `\nType: ${type || ""}\nStatus message: ${statusMessage || ""}\nBody: ${
          JSON.parse(body).msg
        }`
      );
  
      console.info(`Error source data:`, errorSrcData);
    } else {
      console.info(`\nUnexpected Error:`, error);
      console.info(`Error source data:`, errorSrcData);
    }
  }
}

// async function marketBuy() {
//   try {
//     const data = await binance.marketBuy("COCOSUSDT", 20);
//     console.info("data:", data);
//   } catch (error) {
//     throw { type: "Market Buy Error:", ...error, errorSrcData: error };
//   }
// }

// async function marketSell({ tickerName, amount }) {
//   try {
//     delay(250);
    
//     const { minOrderQuantity, minOrderValue, stepSize } = await getExchangeInfo(
//       tickerName
//     );
    
//     const sellQuantity = await binance.roundStep(amount, stepSize);

//     const data = await binance.marketSell(tickerName, sellQuantity);

//     return data
//   } catch (error) {
//     throw { type: "Market Sell Error:", ...error, errorSrcData: error };
//   }
// }

// async function getAccountBalances() {
// try {
//   const balances = await binance.balance();

//   // console.info(balances);

//   const result = [];

//   for (const symbol in balances) {
//     result.push({
//       symbol,
//       available: parseFloat(balances[symbol].available),
//     });
//   }

//   return result
//   } catch (error) {
//     throw { type: "Get Account Balances Error:", ...error, errorSrcData: error };
//   }
// }

// async function getBalances() {
//   const balances = [];
//   const accountBalances = await getAccountBalances();

//   for (const balance of accountBalances) {
//     if (balance.available === 0) continue;

//     const { symbol, available } = balance;

//     if (symbol === 'USDT') {
//       const usdtRate = available;

//       balances.push({ symbol, available, usdtRate });
//     } else {
//       const lastPrice = await getLastPrice(symbol + 'USDT');
//       const usdtRate = available * lastPrice

//       if (isNaN(usdtRate)) continue

//       balances.push({ symbol, available, usdtRate });
//     }
//   }

//   return balances.filter((balance) => balance.available > 0);
// }

// async function getLastPrice(tickerName) {
//   await delay(250);

//   const priceList = await binance.prices();
//   const tickerPrice = parseFloat(priceList[tickerName]);

//   return tickerPrice;
// }

// async function getPrevDayData() {
//   try {
//     const data = await binance.prevDay(false);

//     console.info((data[0].closeTime - data[0].openTime) / 1000 / 60 / 60, 'hours');

//     return data;
//   } catch (error) {
//     throw { type: "Get Prev Day Data", ...error, errorSrcData: error };
//   }
// }

async function getExchangeInfo(tickerName) {
  try {
    await delay(250);

    const data = await binance.exchangeInfo();
    console.info("\n");
    // console.info("Exchange info:", data);

    const limits = {};

    for (let obj of data.symbols) {
      let filters = { status: obj.status };

      for (let filter of obj.filters) {
        if (filter.filterType == "MIN_NOTIONAL") {
          filters.minNotional = filter.minNotional;
        } else if (filter.filterType == "PRICE_FILTER") {
          filters.minPrice = filter.minPrice;
          filters.maxPrice = filter.maxPrice;
          filters.tickSize = filter.tickSize;
        } else if (filter.filterType == "LOT_SIZE") {
          filters.stepSize = filter.stepSize;
          filters.minQty = filter.minQty;
          filters.maxQty = filter.maxQty;
        }
      }

      //filters.baseAssetPrecision = obj.baseAssetPrecision;
      //filters.quoteAssetPrecision = obj.quoteAssetPrecision;
      filters.orderTypes = obj.orderTypes;
      filters.icebergAllowed = obj.icebergAllowed;
      limits[obj.symbol] = filters;
    }

    const tickerLimits = limits[tickerName];
    const minOrderQuantity = parseFloat(tickerLimits.minQty);
    const minOrderValue = parseFloat(tickerLimits.minNotional);
    const stepSize = tickerLimits.stepSize;

    // console.info('\n')
    // console.info('tickerLimits:', tickerLimits)

    return {
      minOrderQuantity,
      minOrderValue,
      stepSize,
    };
  } catch (error) {
    throw { type: "Get Exchange Info", ...error, errorSrcData: error };
  }
}