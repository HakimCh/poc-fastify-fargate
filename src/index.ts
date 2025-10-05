import Fastify from 'fastify';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { datadog } from './datadog.js';

const fastify = Fastify({
  logger: true
});

const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || 'eu-west-1',
  endpoint: process.env.EVENTBRIDGE_ENDPOINT
});

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

fastify.addHook('onRequest', (request, reply, done) => {
  request.startTime = Date.now();
  done();
});

fastify.addHook('onResponse', (request, reply, done) => {
  const duration = Date.now() - (request.startTime || Date.now());
  datadog.trackRequest(request, duration, reply.statusCode);
  done();
});

fastify.post('/receive-event', async (request, reply) => {
  const event = request.body;

  fastify.log.info({ event }, 'Event received from EventBridge');
  datadog.info('Event received from EventBridge', { event });
  datadog.trackEventBridgeOperation('receive', true);

  return reply.code(200).send(event);
});

fastify.post('/send-event', async (request, reply) => {
  const startTime = Date.now();
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
    const duration = Date.now() - startTime;

    fastify.log.info({ response }, 'Event sent to EventBridge');
    datadog.info('Event sent to EventBridge', {
      eventBusName: EVENT_BUS_NAME,
      source,
      detailType
    });
    datadog.trackEventBridgeOperation('send', true, duration);

    return reply.code(204).send();
  } catch (error) {
    const duration = Date.now() - startTime;

    fastify.log.error({ error }, 'Failed to send event to EventBridge');
    datadog.error('Failed to send event to EventBridge', {
      error: error instanceof Error ? error.message : 'Unknown error',
      eventBusName: EVENT_BUS_NAME
    });
    datadog.trackEventBridgeOperation('send', false, duration);

    return reply.code(500).send({ error: 'Failed to send event' });
  }
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
    datadog.info('Server started successfully', { port, host });
    datadog.gauge('server.status', 1);
  } catch (err) {
    fastify.log.error(err);
    datadog.error('Failed to start server', {
      error: err instanceof Error ? err.message : 'Unknown error'
    });
    datadog.gauge('server.status', 0);
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  fastify.log.info('SIGTERM received, closing server...');
  datadog.info('Server shutting down');
  datadog.gauge('server.status', 0);
  datadog.close();
  fastify.close(() => {
    process.exit(0);
  });
});

start();
