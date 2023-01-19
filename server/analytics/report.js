import child_process from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as csv from "fast-csv";

const reportFileName = process.env.REPORT_FILE_NAME;
const comissionPercent = parseFloat(process.env.COMISSION_PERCENT);

const fileName = `${reportFileName}.csv`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const filePath = path.join(__dirname, "../../report", fileName);

child_process.execSync(`rm -rf ${filePath}`);

const file = fs.createWriteStream(filePath);

const csvStream = csv.format({ headers: true });
csvStream.pipe(file).on("end", () => process.exit());

function exitHandler(options, exitCode) {
  csvStream.end();

  if (options.cleanup) console.log("clean");
  if (exitCode || exitCode === 0) console.log(exitCode);
  if (options.exit) process.exit();
}

function setupExit() {
  //do something when app is closing
  process.on("exit", exitHandler.bind(null, { cleanup: true }));

  //catches ctrl+c event
  process.on("SIGINT", exitHandler.bind(null, { exit: true }));

  // catches "kill pid" (for example: nodemon restart)
  process.on("SIGUSR1", exitHandler.bind(null, { exit: true }));
  process.on("SIGUSR2", exitHandler.bind(null, { exit: true }));

  //catches uncaught exceptions
  process.on("uncaughtException", exitHandler.bind(null, { exit: true }));
}

setupExit();

let profitTotal = 0;
let lastPrice;
let count = 0;

export function report({
  date,
  trade,
  symbol,
  price,
  priceChangePercent,
  btcUsdtPrice,
}) {
  Date.prototype.format = function () {
    return (
      this.getDate() +
      "-" +
      this.getMonth() +
      1 +
      "-" +
      this.getFullYear() +
      " " +
      this.getHours().toString().padStart(2, 0) +
      ":" +
      this.getMinutes().toString().padStart(2, 0) +
      ":" +
      this.getSeconds().toString().padStart(2, 0)
    );
  };

  count++;

  const dateFormat = date.format();

  const onePercent = lastPrice / 100;
  const comission = price * comissionPercent;

  if (trade === "SELL") {
    const profitPercent =
      lastPrice !== undefined
        ? (price - lastPrice) / onePercent - comissionPercent
        : -comissionPercent;

    console.log("profitTotal:", profitTotal);

    profitTotal += profitPercent;

    csvStream.write({
      Count: count,
      Date: dateFormat,
      "BTC / USDT price": btcUsdtPrice,
      "Token name": symbol,
      "24h price change %": +priceChangePercent.toFixed(4),
      Trade: trade,
      "Trade price": +price.toFixed(4),
      Comission: +comission.toFixed(4),
      "Profit %": +profitPercent.toFixed(4),
      "Profit total %": +profitTotal.toFixed(4),
    });

    lastPrice = price;
  } else if (trade === "BUY") {
    profitTotal -= comissionPercent;
    const profitPercent = -comissionPercent;

    csvStream.write({
      Count: count,
      Date: dateFormat,
      "BTC / USDT price": btcUsdtPrice,
      "Token name": symbol,
      "24h price change %": +priceChangePercent.toFixed(4),
      Trade: trade,
      "Trade price": +price.toFixed(4),
      Comission: +comission.toFixed(4),
      "Profit %": +profitPercent.toFixed(4),
      "Profit total %": +profitTotal.toFixed(4),
    });

    lastPrice = price;
  } else {
    csvStream.write({
      Count: count,
      Date: dateFormat,
      "BTC / USDT price": btcUsdtPrice,
      "Token name": symbol,
      "24h price change %": +(priceChangePercent || 0).toFixed(4),
      Trade: trade,
      "Trade price": +(price || 0).toFixed(4),
      Comission: 0,
      "Profit %": 0,
      "Profit total %": +profitTotal.toFixed(4),
    });
  }
}
