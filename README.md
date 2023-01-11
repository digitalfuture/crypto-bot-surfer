# **Next Gen Bot** automatic trading system for Binance Crypto exchange

## Prerequisites

### NodeJS

Be sure you have [Node.js](https://nodejs.org/) installed.

Tested with version 14

### Binance API

Set Binance API keys on [Binance](https://binance.com/) web site

### Environment

Set up environment variables in your system or by creating `.env` file with
example config:

```env
TEST_MODE=true

HEARTBEAT_INTERVAL=5m

SECONDARY_SYMBOL=USDT

USE_FIXED_TRADE_VALUE=true
FIXED_TRADE_VALUE=20
FIXED_TRADE_PERCENT=10
MIN_TRADE_USD_VALUE=10
MIN_CHANGE_PERCENT=20
USED_SYMBOLS_LENGTH=5

BINANCE_APIKEY=
BINANCE_APISECRET=

USE_TELEGRAM=true
TELEGRAM_ACCESS_TOKEN=
TELEGRAM_CHANNEL_ID=

MODE=DEVELOPMENT
```

Trading interval can be any amound of seconds or minutes, for example, 30s, 100s, 1m, 5m, 20m and so on

Available modes: `DEVELOPMENT` (for console logs output and debur purposes) or `PRODUCTION` (using PM2 and logs in separated files)

### Telegram

Set up Telegram access token of your Telegram bot and channel ID where bot will
post report messages

To get Telegram Channel ID for private channel, send message to the channel,
then copy message link, cut channel id from the link string and prefix it witn
"-100":

For example, if message link is [https://t.me/c/1345063785/244] then Channel ID
will be -1001345063785

### OS setup

In Ubuntu system install required libs:

```bash
sudo apt update
sudo apt install fontconfig libpixman-1-dev libcairo2-dev libpango1.0-dev libjpeg8-dev libgif-dev build-essential
sudo apt-get install ntp
```

### Process manager

Install `pm2` package globally

```bash
sudo npm i pm2 pm2-logrotate -g
```

### Start dev server

```bash
npm run start
```

### Startup

Add process to system startup

```bash
pm2 set pm2-logrotate:max_size 1M
pm2 startup
pm2 save
```

The others scripts that possible to run (like a logs, upgrade ets.) you can find
in the `package.json` file.

Lucky trading =)
