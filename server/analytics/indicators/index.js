import * as dumpBasic from "./dump-basic.js";
import * as pumpBasic from "./pump-basic.js";
import * as dumpTrailing from "./dump-trailing.js";
import * as pumpTrailing from "./pump-trailing.js";
import * as dumpTrailingBtcFilter from "./dump-trailing--btc-filter.js";
import * as pumpTrailingBtcFilter from "./pump-trailing--btc-filter.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump-basic":
    getTradeSignals = dumpBasic.getTradeSignals;
    break;
  case "pump-basic":
    getTradeSignals = pumpBasic.getTradeSignals;
    break;
  case "dump-trailing":
    getTradeSignals = dumpTrailing.getTradeSignals;
    break;
  case "pump-trailing":
    getTradeSignals = pumpTrailing.getTradeSignals;
    break;
  case "dump-trailing--btc-filter":
    getTradeSignals = dumpTrailingBtcFilter.getTradeSignals;
    break;
  case "pump-trailing--btc-filter":
    getTradeSignals = pumpTrailingBtcFilter.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
