import path from "node:path";
import { execSync } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT);

const __filename = fileURLToPath(import.meta.url);
const __dirname = reportFileDir
  ? path.resolve(reportFileDir)
  : path.resolve(path.dirname(__filename), "../../report");
const filePath = path.join(__dirname, reportFileName);
const fileOptions = { flags: "a" };

let profitTotalPercent = 0; // accumulated total profit percent
let entryPrice = 0; // entry price of the position
let lastTradeType = null; // last trade type (BUY or SELL)
let count = 0; // row counter

createTable();

function createTable() {
  const headers = [
    "Count",
    "Date",
    "Token name",
    "Price change %",
    "Trade",
    "Price",
    "Commission",
    "Profit %",
    "Profit total %",
  ];

  execSync(`rm -rf ${filePath}`); // remove old report file
  console.log("Report file erased");

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({ includeEndRowDelimiter: true });
  csvStream.pipe(stream);
  csvStream.write(headers);
  csvStream.end();

  console.log("Report file created:", filePath);
}

export function report({ date, trade, symbol, price, priceChangePercent }) {
  console.log("Report data:", {
    date,
    trade,
    symbol,
    price,
    priceChangePercent,
  });

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({ headers: false, includeEndRowDelimiter: true });
  csvStream.pipe(stream);

  count++;

  const commission = (price * commissionPercent) / 100;
  let profitPercent = 0;

  if (trade === "SELL") {
    // Opening short: считаем только комиссию как убыток
    profitPercent = -commissionPercent;
    profitTotalPercent += profitPercent;

    entryPrice = price;
    lastTradeType = "SELL";
  } else if (trade === "BUY") {
    // Closing short: считаем прибыль с учетом комиссий на открытие и закрытие
    const grossProfitPercent = ((entryPrice - price) / entryPrice) * 100;
    const totalCommissionPercent = commissionPercent * 2;
    profitPercent = grossProfitPercent - totalCommissionPercent;
    profitTotalPercent += profitPercent;

    entryPrice = price;
    lastTradeType = "BUY";
  } else if (trade === "PASS") {
    entryPrice = price;
    lastTradeType = "PASS";
  } else if (trade === "HOLD") {
    if (lastTradeType === "SELL") {
      profitPercent = ((entryPrice - price) / entryPrice) * 100;
    } else if (lastTradeType === "BUY") {
      profitPercent = ((price - entryPrice) / entryPrice) * 100;
    } else {
      profitPercent = 0;
    }
  } else {
    if (lastTradeType === "SELL") {
      profitPercent = ((entryPrice - price) / entryPrice) * 100;
    } else if (lastTradeType === "BUY") {
      profitPercent = ((price - entryPrice) / entryPrice) * 100;
    } else {
      profitPercent = 0;
    }
  }

  csvStream.write({
    Count: count,
    Date: date.toISOString(),
    "Token name": symbol || "",
    "Price change %": priceChangePercent?.toFixed(8) || "0",
    Trade: trade || "",
    Price: price ? price.toFixed(8) : "",
    Commission:
      trade === "SELL"
        ? commission.toFixed(8)
        : trade === "BUY"
          ? (commission * 2).toFixed(8)
          : "0",
    "Profit %": profitPercent.toFixed(8),
    "Profit total %": profitTotalPercent.toFixed(8),
  });

  csvStream.end();
}
