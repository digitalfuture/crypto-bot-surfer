// connection.js

import Binance from "node-binance-api";

const isTestMode = JSON.parse(process.env.TEST_MODE);

const options = {
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  test: isTestMode,
  recvWindow: 60000,
  verbose: true,
  useServerTime: true,
  family: 0,
};

const binance = new Binance().options(options);

export default binance;
