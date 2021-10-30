import Binance from "node-binance-api";

export default new Binance().options({
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  test: JSON.parse(process.env.TEST_MODE),
  recvWindow: 60000,
  verbose: true,
  useServerTime: true,
});
