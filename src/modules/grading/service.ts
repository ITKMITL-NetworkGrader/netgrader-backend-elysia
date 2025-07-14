import amqp from "amqplib"

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = process.env.QUEUE_NAME || 'queue';

export let channel: amqp.Channel;

async function setupRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`RabbitMQ connected to ${RABBITMQ_URL} and queue ${QUEUE_NAME} is ready.`);
    } catch (error) {
        console.error('Error setting up RabbitMQ:', error);
    }
}

setupRabbitMQ();
