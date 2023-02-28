import amqp from "amqplib";

const host = process.env.RABBITMQ_HOST || "localhost";
const port = process.env.RABBITMQ_PORT || 5672;
const queueName = process.env.RABBITMQ_QUEUE_NAME || "requests";
const delayedExchangeName =
  process.env.RABBITMQ_DELAYED_EXCHANGE_NAME || "requests-delayed";
const delay = process.env.RABBITMQ_DELAY_MS || 100;

let channel;
let exchange;

setupQueue();

async function setupQueue() {
  try {
    const conn = await amqp.connect(`amqp://guest:guest@${host}:${port}`);
    channel = await conn.createChannel();
    exchange = await channel.assertExchange(
      delayedExchangeName,
      "x-delayed-message",
      {
        durable: true,
        arguments: { "x-delayed-type": "direct" },
      }
    );
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, delayedExchangeName, queueName);
  } catch (err) {
    console.log("Queue is not available at the moment");
    console.error(err);
  }
}

async function queue(request) {
  try {
    if (!channel) {
      throw new Error("Queue is not available at the moment");
    }

    const message = JSON.stringify(request());
    channel.publish(delayedExchangeName, queueName, Buffer.from(message), {
      persistent: true,
      headers: { "x-delay": delay },
    });

    return new Promise(function (resolve) {
      channel.consume(
        queueName,
        function (message) {
          if (message) {
            // console.log("Message received from queue:", message.content.toString());
            resolve(JSON.parse(message.content.toString()));
            channel.ack(message);
          } else {
            resolve();
          }
        },
        { noAck: false }
      );
    });
  } catch (err) {
    console.error("Queue is not available at the moment");
    return request();
  }
}

export default queue;
