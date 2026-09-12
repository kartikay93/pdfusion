import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import convertRoutes from './routes/convert.js';
import pdfToWordRoutes from './routes/pdfToWord.js';
import { errorMiddleware } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

if (!config.isProduction) {
  const cors = (await import('cors')).default;
  app.use(cors());
}

app.use('/api', convertRoutes);
app.use('/api', pdfToWordRoutes);

if (config.isProduction) {
  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir));
  // Express 5's path-to-regexp no longer accepts a bare '*' route pattern,
  // so the SPA fallback is a plain catch-all middleware instead of a route.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log(`pdfusion server listening on http://localhost:${config.port}`);
});
