import * as bottomGainerBasic from "./bottom-gainer-basic.js";
import * as topGainerTrailingStop from "./top-gainer-trailing-stop.js";
import * as bottomGainerTrailingStop from "./bottom-gainer-trailing-stop.js";
import * as bottomGainerTrailingStopBtcGainFilter from "./bottom-gainer-trailing-stop--btc-gain-filter.js";
import * as topGainerTrailingStopBtcGainFilter from "./top-gainer-trailing-stop--btc-gain-filter.js";

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
  case "bottom-gainer-trailing-stop--btc-gain-filter":
    getTradeSignals = bottomGainerTrailingStopBtcGainFilter.getTradeSignals;
    break;
  case "top-gainer-trailing-stop--btc-gain-filter":
    getTradeSignals = topGainerTrailingStopBtcGainFilter.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
