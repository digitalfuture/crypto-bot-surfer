import Binance from "node-binance-api";
import axios from "axios";

const useQueue = JSON.parse(process.env.USE_QUEUE);
const isTestMode = JSON.parse(process.env.TEST_MODE);
const queueUrl = process.env.QUEUE_URL;

console.log("Queue URL:", queueUrl);

const options = {
  APIKEY: process.env.BINANCE_APIKEY,
  APISECRET: process.env.BINANCE_APISECRET,
  test: isTestMode,
  recvWindow: 60000,
  verbose: true,
  useServerTime: true,
};

let binance = new Binance().options(options);

if (useQueue) {
  axios.interceptors.request.use(async (config) => {
    try {
      const response = await axios.post(queueUrl, {
        task: config,
      });

      return response.data;
    } catch (error) {
      console.error(error);
      return Promise.reject(error);
    }
  });
}

export default binance;
