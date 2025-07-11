import path from "node:path";
import { execSync } from "child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "@fast-csv/format";

const reportFileDir = process.env.REPORT_FILE_DIR;
const reportFileName = process.env.REPORT_FILE_NAME;
const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT); // commission percent from env

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
    "Trade price",
    "Comission",
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

  const commission = (price * commissionPercent) / 100; // calculate commission amount
  let profitPercent = 0;

  if (trade === "SELL") {
    // Opening short position: profit is negative commission only
    profitPercent = -commissionPercent;
    profitTotalPercent += profitPercent;

    entryPrice = price;
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
      "Profit total %": profitTotalPercent.toFixed(8),
    });
  } else if (trade === "BUY") {
    if (lastTradeType === "SELL") {
      // Closing short position: calculate net profit accounting commission on open and close
      const grossProfitPercent = ((entryPrice - price) / entryPrice) * 100;
      const totalCommissionPercent = commissionPercent * 2;

      profitPercent = grossProfitPercent - totalCommissionPercent;
      profitTotalPercent += profitPercent;

      entryPrice = price;
      lastTradeType = trade;

      csvStream.write({
        Count: count,
        Date: date.toISOString(),
        "Token name": primarySymbol,
        "Price change %": priceChangePercent.toFixed(8),
        Trade: trade,
        "Trade price": price.toFixed(8),
        Comission: (commission * 2).toFixed(8),
        "Profit %": profitPercent.toFixed(8),
        "Profit total %": profitTotalPercent.toFixed(8),
      });
    } else {
      // HOLD — calculate current profit without commission
      if (lastTradeType === "SELL") {
        profitPercent = ((entryPrice - price) / entryPrice) * 100;
      } else if (lastTradeType === "BUY") {
        profitPercent = ((price - entryPrice) / entryPrice) * 100;
      } else {
        profitPercent = 0;
      }

      // Don't add profitPercent to profitTotalPercent on HOLD, just show current profit
      csvStream.write({
        Count: count,
        Date: date.toISOString(),
        "Token name": primarySymbol || "",
        "Price change %": priceChangePercent.toFixed(8),
        Trade: primarySymbol ? "HOLD" : "",
        "Trade price": primarySymbol ? price.toFixed(8) : "",
        Comission: 0,
        "Profit %": primarySymbol ? profitPercent.toFixed(8) : 0,
        "Profit total %": profitTotalPercent.toFixed(8), // total profit unchanged on HOLD
      });
    }
  } else if (trade === "PASS") {
    // Update price for HOLD calculations; profit is zero
    entryPrice = price;
    lastTradeType = "PASS";

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
    // HOLD — calculate current profit without commission
    if (lastTradeType === "SELL") {
      profitPercent = ((entryPrice - price) / entryPrice) * 100;
    } else if (lastTradeType === "BUY") {
      profitPercent = ((price - entryPrice) / entryPrice) * 100;
    } else {
      profitPercent = 0;
    }

    // НЕ добавляем profitPercent к profitTotalPercent при HOLD
    // Просто показываем текущий нереализованный профит

    csvStream.write({
      Count: count,
      Date: date.toISOString(),
      "Token name": primarySymbol || "",
      "Price change %": priceChangePercent.toFixed(8),
      Trade: primarySymbol ? "HOLD" : "",
      "Trade price": primarySymbol ? price.toFixed(8) : "",
      Comission: 0,
      "Profit %": primarySymbol ? profitPercent.toFixed(8) : 0,
      "Profit total %": profitTotalPercent.toFixed(8), // total profit без изменений
    });
  }

  csvStream.end();
}
