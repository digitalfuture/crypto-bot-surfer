export function delay(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function getHeartbeatInterval(interval) {
  const oneSecond = 1000;
  const oneMinute = 60000;
  const oneHour = oneMinute * 60;
  const oneDay = oneHour * 24;

  const intervalList = {
    "1s": oneSecond,
    "3s": oneSecond * 3,
    "5s": oneSecond * 5,
    "15s": oneSecond * 15,
    "30s": oneSecond * 30,
    "1m": oneMinute,
    "3m": oneMinute * 3,
    "5m": oneMinute * 5,
    "15m": oneMinute * 15,
    "30m": oneMinute * 30,
    "1h": oneHour,
    "2h": oneHour * 2,
    "4h": oneHour * 4,
    "6h": oneHour * 6,
    "8h": oneHour * 8,
    "12h": oneHour * 12,
    "1d": oneDay,
    "3d": oneDay * 3,
    "1w": oneDay * 7,
  };

  return intervalList[interval];
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

export function report() {}
