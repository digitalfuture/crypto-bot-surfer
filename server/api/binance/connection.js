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

let binance;

if (useQueue) {
  const binanceProxy = new Proxy(new Binance().options(options), {
    construct(target, args) {
      const binanceInstance = new target(...args);

      return new Proxy(binanceInstance, {
        get(target, prop, receiver) {
          const origMethod = target[prop];

          if (typeof origMethod === "function") {
            return async function (...args) {
              const request = () => origMethod.apply(target, args);
              const task = JSON.stringify({ request, args });
              await axios.post(queueUrl, { task });

              return Promise.resolve();
            };
          } else {
            return origMethod;
          }
        },
      });
    },
  });

  binance = binanceProxy;

  console.log("Using Binance proxy with external queue service");
} else {
  binance = new Binance().options(options);

  console.log("Using direct Binance API");
}

export default binance;
