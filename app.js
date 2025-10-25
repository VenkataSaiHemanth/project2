const express = require('express');
const promClient = require('prom-client');
const winston = require('winston');
const jaeger = require('jaeger-client');
const opentracing = require('opentracing');

// Create a Registry to register the metrics
const register = new promClient.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'nodejs-demo-app'
});

// Enable the collection of default metrics
promClient.collectDefaultMetrics({ register });

// Create a counter metric
const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

// Register the counter
register.registerMetric(httpRequestCounter);

// Create a histogram metric
const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500] // buckets for response time from 0.1ms to 500ms
});

// Register the histogram
register.registerMetric(httpRequestDurationMicroseconds);

// Create a logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

// Initialize Jaeger tracer
const initTracer = (serviceName) => {
  const config = {
    serviceName: serviceName,
    sampler: {
      type: 'const',
      param: 1,
    },
    reporter: {
      logSpans: true,
      agentHost: 'jaeger',
      agentPort: 6832,
    },
  };
  const options = {
    logger: {
      info(msg) {
        logger.info(msg);
      },
      error(msg) {
        logger.error(msg);
      },
    },
  };
  return jaeger.initTracer(config, options);
};

const tracer = initTracer('nodejs-demo-app');
const app = express();
const port = process.env.PORT || 8080;

app.use((req, res, next) => {
  const parentSpanContext = tracer.extract(opentracing.FORMAT_HTTP_HEADERS, req.headers);
  const span = tracer.startSpan(req.path, {
    childOf: parentSpanContext,
    tags: { [opentracing.Tags.SPAN_KIND]: opentracing.Tags.SPAN_KIND_RPC_SERVER }
  });

  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.path,
      status_code: res.statusCode
    });
    end({ method: req.method, route: req.path, code: res.statusCode });
    span.setTag(opentracing.Tags.HTTP_STATUS_CODE, res.statusCode);
    span.finish();
  });
  next();
});

app.get('/', (req, res) => {
  logger.info('Hello World endpoint was called');
  res.send('Hello World!');
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(port, () => {
  logger.info(`App listening on port ${port}`);
});
