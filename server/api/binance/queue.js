import amqp from "amqplib";

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "localhost";
const RABBITMQ_QUEUE_NAME = process.env.RABBITMQ_QUEUE_NAME || "requests";
const REQUEST_LIMIT = process.env.REQUEST_LIMIT || 10;

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
    const queueLength = await channel.checkQueue(RABBITMQ_QUEUE_NAME);
    if (queueLength >= REQUEST_LIMIT) {
      throw new Error(`Queue limit reached (${REQUEST_LIMIT} requests)`);
    }

    const message = JSON.stringify(request());
    channel.sendToQueue(RABBITMQ_QUEUE_NAME, Buffer.from(message), {
      persistent: true,
    });

    // console.log("Message sent to queue:", message);

    return new Promise(function (resolve) {
      channel.consume(RABBITMQ_QUEUE_NAME, function (message) {
        // console.log("Message received from queue:", message.content.toString());
        resolve(JSON.parse(message.content.toString()));
        channel.ack(message);
      });
    });
  } catch (err) {
    console.log("Queue is not available at the moment");
    console.error(err);
    return request();
  }
}

export default queue;
