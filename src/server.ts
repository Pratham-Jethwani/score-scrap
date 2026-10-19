import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import app from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, '../public');

const port = process.env.PORT || 3000;

// Serve frontend static files
app.use(express.static(publicPath));

// Fallback to index.html for SPA routing
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/v1')) {
    return next();
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Instagram Metadata Scraper running on http://localhost:${port}`);
});
