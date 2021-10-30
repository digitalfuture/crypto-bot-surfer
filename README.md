# **crypto bot-2** automatic trading system for Binance Crypto exchange

### Be sure you have [Node.js](https://nodejs.org/) installed

### Set up environment variables in your system or by creating `.env` file with example config:

```
TEST_MODE=true

TRADING_INTERVAL=5m
HISTORY_PERIODS=45

SECONDARY_SYMBOL=USDT

USE_FIXED_TRADE_VALUE=true
FIXED_TRADE_VALUE=20
FIXED_TRADE_PERCENT=10
MIN_TRADE_USD_VALUE=10

BINANCE_APIKEY=
BINANCE_APISECRET=

USE_TELEGRAM=true
TELEGRAM_ACCESS_TOKEN=
TELEGRAM_CHANNEL_ID=

MODE=DEVELOPMENT
```

Available trading intervals: 1s, 3s, 5s, 15s, 30s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M

### Set Binance API keys

### Set Telegram access token of your Telegram bot and channel ID where bot will post report messages

### In Ubuntu system install required libs:

```bash
sudo apt update
sudo apt install fontconfig libpixman-1-dev libcairo2-dev libpango1.0-dev libjpeg8-dev libgif-dev build-essential
```

### Install `pm2` package globally:

```bash
sudo npm i pm2 pm2-logrotate -g
```

### Start the app:

```bash
npm start
```

### Add process to system startup:

```bash
pm2 set pm2-logrotate:max_size 1M
pm2 startup
pm2 save
```

The others scripts that possible to run (like a logs, upgrade ets.) you can find in the ```package.json``` file.

To get Telegram Channel ID for private channel, send message to the channel, then copy message link, cut channel id from the link string and prefix it witn "-100":

For example, if message link is https://t.me/c/1345063785/244
then Channel ID will be -1001345063785

Lucky trading =)