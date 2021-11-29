module.exports = {
    apps : [{
      name   : "crypto-bot-surfer",
      script : "./server/bot.js",
      node_args: "-r dotenv/config",
      log_date_format: "YYYY-MM-DD HH:mm Z",
      restart_delay: "60000",
    }]
  }
  