import { Elysia, t } from 'elysia';
import { channel } from './service';

const gradingRoutes = new Elysia({ prefix: '/grading' })
  .post("/submit", async ({ body, set }) => {
    if (!channel) {
      set.status = 503;
      return { status: 'error', message: "Service unavailable, RabbitMQ channel not initialized." };
    }
    const jobPayload = JSON.stringify(body);
  });
