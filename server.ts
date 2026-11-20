import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes/api.ts';
import { authApiRouter, oauthCallbackRouter } from './server/routes/auth.ts';
import { recoverInterruptedAnalysisJobs } from './server/store.ts';

async function startServer() {
  const recoveredJobs = recoverInterruptedAnalysisJobs();
  if (recoveredJobs > 0) {
    console.warn(`Marked ${recoveredJobs} interrupted analysis job(s) as failed after server restart.`);
  }

  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', authApiRouter);
  app.use('/', oauthCallbackRouter);
  app.use('/api', apiRouter);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
        return next();
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return res.status(404).send('Build output not found. Run npm run build first.');
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CodeRubric server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CodeRubric server:', err);
  process.exit(1);
});
