export function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

function parseInterval(interval) {
  const match = interval.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (value < 1 || value > 60) {
    throw new Error(`Invalid interval value: ${value}`);
  }
  if (unit !== "s" && unit !== "m" && unit !== "h") {
    throw new Error(`Invalid interval unit: ${unit}`);
  }
  const values = {
    s: value * 1000,
    m: value * 60 * 1000,
    h: value * 60 * 60 * 1000,
  };
  return values[unit];
}

export function getHeartbeatInterval(interval) {
  const intervalMs = parseInterval(interval);
  return intervalMs;
}

export function formatDate(timestamp) {
  const date = new Date(timestamp);

  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear().toString().slice(-2);
  // const hours = date.getHours().toString().padStart(2, "0");
  // const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${day}.${month}.${year}`;
}
