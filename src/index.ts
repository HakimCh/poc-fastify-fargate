import Fastify from 'fastify';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const fastify = Fastify({
  logger: true
});

const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || 'eu-west-1',
  endpoint: process.env.EVENTBRIDGE_ENDPOINT
});

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

fastify.post('/receive-event', async (request, reply) => {
  const event = request.body;

  fastify.log.info({ event }, 'Event received from EventBridge');

  return reply.code(200).send(event);
});

fastify.post('/send-event', async (request, reply) => {
  const { detail, detailType, source } = request.body as {
    detail: Record<string, any>;
    detailType: string;
    source: string;
  };

  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: EVENT_BUS_NAME,
        Source: source || 'custom.app',
        DetailType: detailType || 'CustomEvent',
        Detail: JSON.stringify(detail)
      }
    ]
  });

  try {
    const response = await eventBridgeClient.send(command);
    fastify.log.info({ response }, 'Event sent to EventBridge');

    return reply.code(204).send();
  } catch (error) {
    fastify.log.error({ error }, 'Failed to send event to EventBridge');
    return reply.code(500).send({ error: 'Failed to send event' });
  }
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
