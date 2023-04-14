import * as indicatorDump from "./dump.js";
import * as indicatorPump from "./pump.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump":
    getTradeSignals = indicatorDump.getTradeSignals;
    break;
  case "pump":
    getTradeSignals = indicatorPump.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
