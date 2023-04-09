import * as indicatorDump from "./dump.js";
import * as indicatorMarketChange from "./market-average.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump":
    getTradeSignals = indicatorDump.getTradeSignals;
    break;
  case "market-average":
    getTradeSignals = indicatorMarketChange.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
