import child_process from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as csv from "fast-csv";

child_process.execSync("rm -rf report/*");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const filePath = path.join(__dirname, "../../report", "trades.csv");

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

export function report({ date, trade, ticker, price }) {
  Date.prototype.format = function () {
    return (
      this.getDate() +
      "-" +
      this.getMonth() +
      1 +
      "-" +
      this.getFullYear() +
      " " +
      this.getHours() +
      ":" +
      this.getMinutes() +
      ":" +
      this.getSeconds()
    );
  };

  const dateFormat = date.format();

  csvStream.write({ date: dateFormat, trade, ticker, price });
}
