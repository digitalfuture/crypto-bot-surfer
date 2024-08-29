import path from "node:path";
import { execSync } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

////
const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const comissionPercent = parseFloat(process.env.TEST_COMISSION_PERCENT);

////
const __filename = fileURLToPath(import.meta.url);
const __dirname = reportFileDir
  ? path.resolve(reportFileDir)
  : path.resolve(path.dirname(__filename), "../../report");
const filePath = path.join(__dirname, reportFileName);
const fileOptions = { flags: "a" };

let profitTotal = 0;
let lastPrice = 0;
let count = 0;

////
createTable();

////
function createTable() {
  const headers = [
    "Count",
    "Date",
    "BTC / USDT price",
    "Token name",
    "24h price change %",
    "Trade",
    "Trade price",
    "Comission",
    "Profit %",
    "Profit total %",
    "Market average",
  ];

  execSync(`rm -rf ${filePath}`);

  console.log("Report file erased");

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({ includeEndRowDelimiter: true });
  csvStream.pipe(stream);
  csvStream.write(headers);
  csvStream.end();

  console.log("Report file created:", filePath);
}

export function report({
  date,
  trade,
  symbol,
  price,
  priceChangePercent,
  btcUsdtPrice,
  marketAveragePrice,
}) {
  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({
    headers: false,
    includeEndRowDelimiter: true,
  });

  csvStream.pipe(stream);

  count++;

  const comission = (price * comissionPercent) / 100;

  if (trade === "SELL") {
    const onePercent = lastPrice / 100;
    const profitPercent = (price - lastPrice) / onePercent - comissionPercent;

    profitTotal += profitPercent;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Token name": symbol,
      "24h price change %": +priceChangePercent.toFixed(4),
      Trade: trade,
      "Trade price": +price.toFixed(4),
      Comission: +comission.toFixed(4),
      "Profit %": +profitPercent.toFixed(4),
      "Profit total %": +profitTotal.toFixed(4),
      "Market average": +marketAveragePrice.toFixed(4),
    });

    lastPrice = price;
  } else if (trade === "BUY") {
    profitTotal -= comissionPercent;
    const profitPercent = -comissionPercent;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Token name": symbol,
      "24h price change %": +priceChangePercent.toFixed(4),
      Trade: trade,
      "Trade price": +price.toFixed(4),
      Comission: +comission.toFixed(4),
      "Profit %": +profitPercent.toFixed(4),
      "Profit total %": +profitTotal.toFixed(4),
      "Market average": +marketAveragePrice.toFixed(4),
    });

    lastPrice = price;
  } else if (trade === "PASS") {
    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Token name": "",
      "24h price change %": +(priceChangePercent || 0).toFixed(4),
      Trade: "",
      "Trade price": "",
      Comission: 0,
      "Profit %": 0,
      "Profit total %": +profitTotal.toFixed(4),
      "Market average": +marketAveragePrice.toFixed(4),
    });
  }

  csvStream.end();
}
