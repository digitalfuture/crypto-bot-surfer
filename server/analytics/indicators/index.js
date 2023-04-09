import * as indicatorDump from "./dump.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump":
    getTradeSignals = indicatorDump.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
