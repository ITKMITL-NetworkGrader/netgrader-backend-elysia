import { Elysia, t } from 'elysia';
import jwt from '@elysiajs/jwt';
import { env } from 'process';

export const websocket = new Elysia({ prefix: '/ws', websocket: { idleTimeout: 300} })
    .use(jwt({ name: 'jwt', secret: env.JWT_SECRET! }))
    .ws('/:room/:name', {
        schema: {
            body: t.Object({
                message: t.String()
            }),
            response: t.Object({
                user: t.String(),
                message: t.String(),
                time: t.Number()
            })
        },
        async beforeHandle({ cookie: { auth_token }, jwt, set }) {
            // WebSocket auth: verify JWT token from cookie
            if (!auth_token?.value) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }
            const payload = await jwt.verify(auth_token.value);
            if (!payload) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }
        },
        open(ws) {
            const {
                data: {
                    params: { room, name }
                }
            } = ws

            ws.subscribe(room)
            ws.publish(room, {
                message: `${name} has entered the room`,
                user: '[SYSTEM]',
                time: Date.now()
            })
        },
        message(ws, { message }) {
            const {
                data: {
                    params: { room, name }
                }
            } = ws

            const messageData = {
                message,
                user: name,
                time: Date.now()
            }

            // Send to sender immediately
            ws.send(messageData)
            
            // Publish to all other subscribers in the room
            ws.publish(room, messageData)
        },
        close(ws) {
            const {
                data: {
                    params: { room, name }
                }
            } = ws

            ws.publish(room, {
                message: `${name} has leave the room`,
                user: '[SYSTEM]',
                time: Date.now()
            })
        }
    });