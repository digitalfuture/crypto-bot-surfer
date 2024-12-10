import * as indicatorExternalFile from "./algorithms/external-file.js";
import * as indicatorPump from "./algorithms/pump.js";
import * as indicatorPsar from "./algorithms/psar.js";
import * as indicatorDoubleEma from "./algorithms/double-ema.js";
import * as indicatorVolumeMomentum from "./algorithms/volume-momentum.js";
import * as indicatorRegression from "./algorithms/regression.js";
import * as indicatorRsi from "./algorithms/rsi.js";
import * as indicatorAi from "./ai.js";

const indicatorName = process.env.INDICATOR;

let getTradeSignals;

switch (indicatorName) {
  case "external":
    getTradeSignals = indicatorExternalFile.getTradeSignals;
    break;
  case "pump":
    getTradeSignals = indicatorPump.getTradeSignals;
    break;
  case "psar":
    getTradeSignals = indicatorPsar.getTradeSignals;
    break;
  case "double-ema":
    getTradeSignals = indicatorDoubleEma.getTradeSignals;
    break;
  case "volume-momentum":
    getTradeSignals = indicatorVolumeMomentum.getTradeSignals;
    break;
  case "regression":
    getTradeSignals = indicatorRegression.getTradeSignals;
    break;
  case "rsi":
    getTradeSignals = indicatorRsi.getTradeSignals;
    break;
  case "ai":
    getTradeSignals = indicatorAi.getTradeSignals;
    break;
}

export const getSignals = getTradeSignals;
