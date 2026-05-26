const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const kmzRoutes = require('./routes/kmz');
const imageRoutes = require('./routes/image');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(morgan('combined'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api', (_req, res) => {
  res.json({
    name: 'carroyage-jmt-api',
    version: '1.0.0',
    endpoints: {
      'POST /api/kmz/cado': 'Generate a CADO KMZ file (single coord or two-point zone)',
      'POST /api/kmz/cado/preview': 'Compute grid metadata without generating the KMZ (single coord or two-point zone)',
      'POST /api/image/cado': 'Generate a CADO PNG/JPEG image with map background (single coord or two-point zone)',
      'GET /health': 'Health check',
      'GET /': 'Test page (HTML)',
    },
    docs: 'See README.md',
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/kmz', kmzRoutes);
app.use('/api/image', imageRoutes);

app.use((_req, res) => res.status(404).json({ error: 'NotFound' }));

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: err.message,
  });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`carroyage-jmt-api listening on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
