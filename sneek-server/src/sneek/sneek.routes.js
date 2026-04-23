const express = require('express');
const { processSneekScan } = require('./sneek.service');

function createSneekRouter() {
  const router = express.Router();

  router.post('/sneek/scan', async (req, res) => {
    try {
      const result = await processSneekScan(req.body);
      res.status(result.status).json(result.body);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'Sneek scan processing failed.',
        details: error?.message || 'Unknown error',
      });
    }
  });

  router.post('/api/sneek/scan', async (req, res) => {
    try {
      const result = await processSneekScan(req.body);
      res.status(result.status).json(result.body);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'Sneek scan processing failed.',
        details: error?.message || 'Unknown error',
      });
    }
  });

  return router;
}

module.exports = { createSneekRouter };
