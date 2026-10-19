import express, { Request, Response, Router } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { InstagramService } from './services/instagram.service.js';

dotenv.config();

export const app = express();
const service = new InstagramService();

app.use(cors());
app.use(express.json());

const apiRouter = Router();

// Health check
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'instagram-metadata-scraper',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /v1/profile/:username
 * Query parameters:
 *   - deep: boolean (fetches likes/comments/dates)
 *   - limit: number (max deep posts, default: 6)
 */
apiRouter.get('/v1/profile/:username', async (req: Request, res: Response) => {
  const { username } = req.params;
  const isDeep = req.query.deep === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 6;

  try {
    const profile = await service.getUser(username, {
      includeDeepPostMetrics: isDeep,
      maxDeepPosts: limit,
    });

    res.json({
      success: true,
      data: profile,
    });
  } catch (error: any) {
    const isNotFound = error.message?.includes('not found') || error.message?.includes('does not exist');
    res.status(isNotFound ? 404 : 500).json({
      success: false,
      error: error.message || 'Internal server error while fetching Instagram profile',
    });
  }
});

// Mount router on both '/api' and '/' for seamless Netlify serverless routing
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
