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

let profitTotalPercent = 0;
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
    "Market average",
    "Token name",
    "Price change %",
    "Trade",
    "Trade price",
    "Comission",
    "Profit %",
    "Profit total %",
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
    profitTotalPercent -= comission;
    const profitPercent = -comission;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Market average": +marketAveragePrice.toFixed(8),
      "Token name": symbol,
      "Price change %": +priceChangePercent,
      Trade: trade,
      "Trade price": +price,
      Comission: +comission.toFixed(8),
      "Profit %": +profitPercent.toFixed(8),
      "Profit total %": +profitTotalPercent.toFixed(8),
    });

    lastPrice = price;
  } else if (trade === "BUY") {
    const onePercent = lastPrice / 100;
    const profit = price - lastPrice - comission;
    const profitPercent = profit / onePercent;

    profitTotalPercent += profitPercent;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Market average": +marketAveragePrice.toFixed(8),
      "Token name": symbol,
      "Price change %": +priceChangePercent,
      Trade: trade,
      "Trade price": +price,
      Comission: +comission.toFixed(8),
      "Profit %": +profitPercent.toFixed(8),
      "Profit total %": +profitTotalPercent.toFixed(8),
    });

    lastPrice = price;
  } else {
    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Market average": +marketAveragePrice.toFixed(8),
      "Token name": "",
      "Price change %": +(priceChangePercent || 0),
      Trade: "",
      "Trade price": "",
      Comission: 0,
      Profit: 0,
      "Profit total": +profitTotalPercent.toFixed(8),
    });
  }

  csvStream.end();
}
