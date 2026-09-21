import { Router } from 'express';
import healthRoutes from './health.routes.js';
import dealsRoutes from './deals.routes.js';
import affiliateRoutes from './affiliate.routes.js';
import gamesRoutes from '../games/games.routes.js';
import authRoutes from './auth.routes.js';
import revenueRoutes from './revenue.routes.js';
import publishRoutes from './publish.routes.js';
import auctionsRoutes from './auctions.routes.js';
import groupbuyRoutes from './groupbuy.routes.js';
import pricecompareRoutes from './pricecompare.routes.js';
import couponsRoutes from './coupons.routes.js';
import assistantRoutes from './assistant.routes.js';

const router = Router();

router.use(healthRoutes);
router.use('/api', dealsRoutes);
router.use('/api', affiliateRoutes);
router.use('/api', gamesRoutes);
router.use('/api', authRoutes);
router.use('/api', revenueRoutes);
router.use('/api', publishRoutes);
router.use('/api', auctionsRoutes);
router.use('/api', groupbuyRoutes);
router.use('/api', pricecompareRoutes);
router.use('/api', couponsRoutes);
router.use('/api', assistantRoutes);

export default router;
