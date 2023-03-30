import path from "node:path";
import { execSync } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

////
const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const reportFileNew = JSON.parse(process.env.REPORT_FILE_NEW);
const comissionPercent = parseFloat(process.env.COMISSION_PERCENT);

////
const fileName = `${reportFileName}.csv`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = reportFileDir
  ? reportFileDir
  : path.dirname(__filename) + "../../../report";
const filePath = path.join(__dirname, fileName);
const fileOptions = { flags: "a" };

let profitTotal = 0;
let lastPrice;
let count = 0;

////
if (reportFileNew) {
  createTable();
}

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

function formatDate(date) {
  const result =
    date.getFullYear() +
    "-" +
    date.getMonth() +
    1 +
    "-" +
    date.getDate() +
    " " +
    date.getHours().toString().padStart(2, 0) +
    ":" +
    date.getMinutes().toString().padStart(2, 0) +
    ":" +
    date.getSeconds().toString().padStart(2, 0);

  return result;
}

export function report({
  date,
  trade,
  symbol,
  price,
  priceChangePercent,
  btcUsdtPrice,
}) {
  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({
    headers: false,
    includeEndRowDelimiter: true,
  });

  csvStream.pipe(stream);

  count++;

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
      Date: date.toISOString(),
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
      Date: date.toISOString(),
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
      Date: date.toISOString(),
      "BTC / USDT price": btcUsdtPrice,
      "Token name": "",
      "24h price change %": +(priceChangePercent || 0).toFixed(4),
      Trade: "",
      "Trade price": "",
      Comission: 0,
      "Profit %": 0,
      "Profit total %": +profitTotal.toFixed(4),
    });
  }

  csvStream.end();
}
