import path from "node:path";
import { execSync } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const comissionPercent = parseFloat(process.env.TEST_COMISSION_PERCENT);

const __filename = fileURLToPath(import.meta.url);
const __dirname = reportFileDir
  ? path.resolve(reportFileDir)
  : path.resolve(path.dirname(__filename), "../../report");
const filePath = path.join(__dirname, reportFileName);
const fileOptions = { flags: "a" };

let profitTotalPercent = 0;
let lastTradePrice = 0;
let lastTradeType = null;
let count = 0;

createTable();

function createTable() {
  const headers = [
    "Count",
    "Date",
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
  primarySymbol,
  price,
  priceChangePercent,
}) {
  console.log("Report data:", {
    date,
    trade,
    primarySymbol,
    price,
    priceChangePercent,
  });

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({
    headers: false,
    includeEndRowDelimiter: true,
  });

  csvStream.pipe(stream);

  count++;
  const commission = price ? (price * comissionPercent) / 100 : 0;

  if (trade === "SELL" || trade === "BUY") {
    let profitPercent = 0;

    if (trade === "BUY" && lastTradeType === "SELL") {
      const onePercent = lastTradePrice / 100;
      const profit = lastTradePrice - price - commission;
      profitPercent = profit / onePercent;
      profitTotalPercent += profitPercent;
    } else {
      profitPercent = -commission / (price / 100);
      profitTotalPercent += profitPercent;
    }

    lastTradePrice = price;
    lastTradeType = trade;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "Token name": primarySymbol,
      "Price change %": priceChangePercent.toFixed(8),
      Trade: trade,
      "Trade price": price.toFixed(8),
      Comission: commission.toFixed(8),
      "Profit %": profitPercent.toFixed(8),
      "Profit total %": +profitTotalPercent.toFixed(8),
    });
  } else if (trade === "PASS") {
    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "Token name": primarySymbol || "",
      "Price change %": priceChangePercent.toFixed(8),
      Trade: "PASS",
      "Trade price": price ? price.toFixed(8) : "",
      Comission: 0,
      "Profit %": 0,
      "Profit total %": profitTotalPercent.toFixed(8),
    });
  } else {
    const onePercent = lastTradePrice / 100;
    const profit = lastTradePrice - price;
    const profitPercent = profit / onePercent;
    profitTotalPercent += primarySymbol ? profitPercent : 0;

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "Token name": primarySymbol || "",
      "Price change %": priceChangePercent.toFixed(8),
      Trade: primarySymbol ? "HOLD" : "",
      "Trade price": primarySymbol ? price.toFixed(8) : "",
      Comission: 0,
      "Profit %": primarySymbol ? profitPercent.toFixed(8) : 0,
      "Profit total %": profitTotalPercent.toFixed(8),
    });
  }

  csvStream.end();
}
