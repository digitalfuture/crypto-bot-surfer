import * as dumpBasic from "./dump-basic.js";
import * as dumpTrailing from "./dump-trailing.js";
import * as dumpTrailingBtcFilter from "./dump-trailing--btc-filter.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump-basic":
    getTradeSignals = dumpBasic.getTradeSignals;
    break;
  case "dump-trailing":
    getTradeSignals = dumpTrailing.getTradeSignals;
    break;
  case "dump-trailing--btc-filter":
    getTradeSignals = dumpTrailingBtcFilter.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
