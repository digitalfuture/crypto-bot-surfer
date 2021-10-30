import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { getCandlestickData } from "../api/binance/info.js";
import { formatDate } from "../helpers/functions.js";

export async function prepareChartData({
  primarySymbol,
  secondarySymbol,
  interval,
  periods,
  priceChangePercent,
}) {
  const tickerName = primarySymbol + secondarySymbol;

  const candlestickData = await getCandlestickData({
    tickerName,
    interval,
    periods,
  });

  const xyData = candlestickData.map(([time, close]) => [
    time,
    parseFloat(close),
  ]);

  const priceData = xyData
    .map(([time, close]) => ({ x: time, y: close }))
    .slice(-45);

  const imageBuffer = await renderChart({
    primarySymbol,
    secondarySymbol,
    priceData,
    priceChangePercent,
  });

  return imageBuffer;
}

async function renderChart({
  primarySymbol,
  secondarySymbol,
  priceData,
  priceChangePercent,
}) {
  const width = 500;
  const height = 300;

  const chartCallback = (ChartJS) => {
    ChartJS.defaults.global.elements.rectangle.borderWidth = 2;
  };

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    chartCallback,
  });

  const plugin = {
    id: "custom_canvas_background_color",
    beforeDraw: (chart) => {
      const ctx = chart.canvas.getContext("2d");
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      2;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

  const configuration = {
    type: "line",
    data: {
      labels: priceData.map(({ x }) => x),
      datasets: [
        {
          label: `${primarySymbol} / ${secondarySymbol} ${
            priceChangePercent
              ? " - 24H GAIN:" + Math.round(priceChangePercent) + "%"
              : ""
          }`,
          data: priceData,
          borderColor: "grey",
          borderWidth: 2,
          lineTension: 0,
          fill: false,
          pointRadius: 1,
        },
      ],
    },
    options: {
      scales: {
        xAxes: [
          {
            ticks: {
              callback: (x) => formatDate(x),
            },
          },
        ],
      },
    },
    plugins: [plugin],
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration, "image/png");
}
