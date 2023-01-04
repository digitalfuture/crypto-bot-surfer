import startRealMode from "./realMode.js";
import startTestMode from "./testMode.js";

const isTestMode = JSON.parse(process.env.TEST_MODE);

if (isTestMode) {
  startTestMode();
} else {
  startRealMode();
}
