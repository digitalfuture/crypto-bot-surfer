// connection.js

import Binance from "node-binance-api";

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  useServerTime: true,
  recvWindow: 60000,
  verbose: false,
  family: 0,
});

export default binance;
