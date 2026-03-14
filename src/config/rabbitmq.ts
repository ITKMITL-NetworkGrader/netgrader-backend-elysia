import amqp from "amqplib"

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
export const QUEUE_NAME = process.env.QUEUE_NAME || 'queue';

export let channel: amqp.Channel;

let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

async function setupRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        reconnectAttempts = 0;
        console.log(`RabbitMQ connection and queue ${QUEUE_NAME} is ready.`);

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err.message);
        });
        connection.on('close', () => {
            console.warn('RabbitMQ connection closed. Reconnecting...');
            scheduleReconnect();
        });
    } catch (error) {
        console.error('Error setting up RabbitMQ:', error);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    console.log(`RabbitMQ reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
    setTimeout(setupRabbitMQ, delay);
}

setupRabbitMQ();
