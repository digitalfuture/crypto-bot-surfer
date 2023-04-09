import * as indicatorDump from "./dump.js";
import * as indicatorMarketChange from "./market-change.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump":
    getTradeSignals = indicatorDump.getTradeSignals;
    break;
  case "market-change":
    getTradeSignals = indicatorMarketChange.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
