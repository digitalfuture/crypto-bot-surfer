import Binance from "node-binance-api";

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
  binance._makeRequest = async function (
    path,
    data = {},
    method = "GET",
    headers = {}
  ) {
    const response = await fetch(`${queueUrl}/queue/binance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, data, method, headers }),
    });
    const result = await response.json();
    return result;
  };
}

export default binance;
