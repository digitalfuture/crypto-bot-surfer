import * as bottomGainerBasic from "./bottom-gainer-basic.js";
import * as topGainerTrailingStop from "./top-gainer-trailing-stop.js";
import * as bottomGainerTrailingStop from "./bottom-gainer-trailing-stop.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "bottom-gainer-basic":
    getTradeSignals = bottomGainerBasic.getTradeSignals;
    break;
  case "bottom-gainer-trailing-stop":
    getTradeSignals = bottomGainerTrailingStop.getTradeSignals;
    break;
  case "top-gainer-trailing-stop":
    getTradeSignals = topGainerTrailingStop.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
