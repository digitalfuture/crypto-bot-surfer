import amqp from "amqplib";

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "localhost";
const RABBITMQ_QUEUE_NAME = process.env.RABBITMQ_QUEUE_NAME || "requests";
const PROCESS_DELAY = process.env.PROCESS_DELAY || 100;

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
    if (!channel) {
      throw new Error("Queue is not available at the moment");
    }

    const message = JSON.stringify(request());
    channel.sendToQueue(RABBITMQ_QUEUE_NAME, Buffer.from(message), {
      persistent: true,
    });

    // console.log("Message sent to queue:", message);

    return new Promise(function (resolve) {
      setTimeout(async function () {
        const message = await channel.get(RABBITMQ_QUEUE_NAME, {
          noAck: false,
        });
        if (message) {
          // console.log("Message received from queue:", message.content.toString());
          resolve(JSON.parse(message.content.toString()));
          channel.ack(message);
        } else {
          resolve();
        }
      }, PROCESS_DELAY);
    });
  } catch (err) {
    console.error("Queue is not available at the moment");
    return request();
  }
}

export default queue;
