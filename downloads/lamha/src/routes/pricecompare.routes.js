import { Router } from 'express';
import { compareLocal } from '../pricecompare/priceCompareBot.js';

const router = Router();

router.get('/pricecompare', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'لازم query param اسمه q.' });
  res.json({ results: compareLocal(q) });
});

export default router;
