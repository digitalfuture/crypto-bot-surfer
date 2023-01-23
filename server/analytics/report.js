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

const csvStream = csv.format({ headers: true });

const file = fs.createWriteStream(filePath, { flags: "a" });
csvStream.pipe(file).on("end", () => process.exit());

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
      "Token name": "",
      "24h price change %": +(priceChangePercent || 0).toFixed(4),
      Trade: "",
      "Trade price": "",
      Comission: 0,
      "Profit %": 0,
      "Profit total %": +profitTotal.toFixed(4),
    });
  }
}
