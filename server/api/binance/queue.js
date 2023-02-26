import amqp from "amqplib";

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "localhost";
const RABBITMQ_QUEUE_NAME = process.env.RABBITMQ_QUEUE_NAME || "requests";
const DELAY_MS = process.env.DELAY_MS || 200;

let channel;

setupQueue();

async function setupQueue() {
  try {
    const conn = await amqp.connect(`amqp://${RABBITMQ_HOST}`);
    channel = await conn.createChannel();
    await channel.assertQueue(RABBITMQ_QUEUE_NAME, { durable: true });
  } catch (err) {
    console.log("Queue is not available at the moment");
    console.error(err);
  }
}

async function queue(request) {
  try {
    const message = JSON.stringify(request());
    channel.sendToQueue(RABBITMQ_QUEUE_NAME, Buffer.from(message), {
      persistent: true,
    });

    return new Promise(function (resolve) {
      setTimeout(() => {
        channel.consume(RABBITMQ_QUEUE_NAME, function (message) {
          resolve(JSON.parse(message.content.toString()));
          channel.ack(message);
        });
      }, DELAY_MS);
    });
  } catch (err) {
    console.error("Queue is not available at the moment");
    return request();
  }
}

export default queue;
