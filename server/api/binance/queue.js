import amqp from "amqplib";

const host = process.env.RABBITMQ_HOST || "localhost";
const port = process.env.RABBITMQ_PORT || 5672;
const queueName = process.env.RABBITMQ_QUEUE_NAME || "requests";

let channel;

setupQueue();

async function setupQueue() {
  try {
    const conn = await amqp.connect(`amqp://guest:guest@${host}:${port}`);
    channel = await conn.createChannel();
    await channel.assertQueue(queueName, { durable: true });
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

    return new Promise(function (resolve) {
      channel.consume(
        RABBITMQ_QUEUE_NAME,
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
