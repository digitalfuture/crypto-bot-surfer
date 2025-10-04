// report.js

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

const onlyCleanBalance = process.env.CLEAN_BALANCE_ONLY === "true";
const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT);

const __filename = fileURLToPath(import.meta.url);
const __dirname = reportFileDir
  ? path.resolve(reportFileDir)
  : path.resolve(path.dirname(__filename), "../../report");
const filePath = path.join(__dirname, reportFileName);
const crashReportPath = path.join(__dirname, "crash-report.log"); // 🆕 путь к краш-логу
const fileOptions = { flags: "a" };

let profitTotalPercent = 0;
let entryPrice = 0;
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
    "Price",
    "Commission",
    "Profit %",
    "Profit total %",
  ];

  if (onlyCleanBalance) return;

  try {
    fs.rmSync(filePath, { force: true });
    console.log("Report file erased");
  } catch (err) {
    console.warn("Could not remove old report file:", err.message);
  }

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({ includeEndRowDelimiter: true });
  csvStream.pipe(stream);
  csvStream.write(headers);
  csvStream.end();

  console.log("Report file created:", filePath);
}

export function report({ date, trade, symbol, price, priceChangePercent }) {
  count++;

  const commission = (price * commissionPercent) / 100;
  let profitPercent = 0;

  if (trade === "SELL") {
    profitPercent = -commissionPercent;
    profitTotalPercent += profitPercent;
    entryPrice = price;
    lastTradeType = "SELL";
  } else if (trade === "BUY") {
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

  if (trade !== "SELL" && trade !== "BUY") return;

  const stream = fs.createWriteStream(filePath, fileOptions);
  const csvStream = format({ headers: false, includeEndRowDelimiter: true });
  csvStream.pipe(stream);

  csvStream.write({
    Count: count,
    Date: date.toISOString(),
    "Token name": symbol,
    "Price change %": priceChangePercent?.toFixed(8),
    Trade: trade,
    Price: price.toFixed(8),
    Commission:
      trade === "SELL" ? commission.toFixed(8) : (commission * 2).toFixed(8),
    "Profit %": profitPercent.toFixed(8),
    "Profit total %": profitTotalPercent.toFixed(8),
  });

  csvStream.end();
}

export function crashReport(error, context = {}) {
  const timestamp = new Date().toISOString();
  const message = error?.message || "Unknown error";
  const stack = error?.stack || "No stack trace";

  const report = {
    timestamp,
    message,
    stack,
    context,
  };

  const logEntry =
    `[${report.timestamp}] CRASH REPORT\n` +
    `Message: ${report.message}\n` +
    `Context: ${JSON.stringify(report.context, null, 2)}\n` +
    `Stack:\n${report.stack}\n\n` +
    "=".repeat(80) +
    "\n\n";

  try {
    fs.appendFileSync(crashReportPath, logEntry, "utf8");
    console.error("Crash report saved to:", crashReportPath);
  } catch (writeErr) {
    console.error("Failed to write crash report:", writeErr);
  }
}
