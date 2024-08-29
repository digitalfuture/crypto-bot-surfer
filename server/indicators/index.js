import * as indicatorDump from "./dump.js";
import * as indicatorFlat from "./flat.js";
import * as indicatorPump from "./pump.js";
import * as indicatorSimple from "./simple.js";
import * as indicatorExternal from "./external.js";
// import * as indicatorAi from "./ai.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "dump":
    getTradeSignals = indicatorDump.getTradeSignals;
    break;
  case "flat":
    getTradeSignals = indicatorFlat.getTradeSignals;
    break;
  case "pump":
    getTradeSignals = indicatorPump.getTradeSignals;
    break;
  case "simple":
    getTradeSignals = indicatorSimple.getTradeSignals;
    break;
  case "external":
    getTradeSignals = indicatorExternal.getTradeSignals;
    break;
  // case "ai":
  //   getTradeSignals = indicatorAi.getTradeSignals;
  //   break;
}

export const getSignals = getTradeSignals;
