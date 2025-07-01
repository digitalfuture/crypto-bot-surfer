import * as volatility from "./algorithms/volatility.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "volatility":
    getTradeSignals = volatility.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
