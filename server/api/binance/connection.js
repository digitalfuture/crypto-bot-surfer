import Binance from "node-binance-api";
import axios from "axios";

const useQueue = JSON.parse(process.env.USE_QUEUE);
const isTestMode = JSON.parse(process.env.TEST_MODE);
const queueUrl = process.env.QUEUE_URL;

const options = {
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  test: isTestMode,
  recvWindow: 60000,
  verbose: true,
  useServerTime: true,
};

function createBinanceInstance() {
  if (useQueue) {
    console.log("Queue URL:", queueUrl);

    const instance = new Binance().options(options);
    const queueAxios = axios.create({
      baseURL: queueUrl,
    });

    queueAxios.interceptors.request.use((config) => {
      return instance.queue(() => {
        return instance[config.method.toLowerCase()](config.url, config.data);
      });
    });

    return queueAxios;
  } else {
    return new Binance().options(options);
  }
}

const binance = createBinanceInstance();

export default binance;
