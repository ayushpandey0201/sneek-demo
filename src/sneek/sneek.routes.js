const express = require('express');
const { processSneekScan } = require('./sneek.service');

function createSneekRouter() {
  const router = express.Router();

  router.post('/sneek/scan', (req, res) => {
    const result = processSneekScan(req.body);
    res.status(result.status).json(result.body);
  });

  // Legacy route compatibility
  router.post('/api/sneek/scan', (req, res) => {
    const result = processSneekScan(req.body);
    res.status(result.status).json(result.body);
  });

  return router;
}

module.exports = { createSneekRouter };
