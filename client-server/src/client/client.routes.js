const express = require('express');
const {
  getBootstrap,
  createLoginSession,
  getSession,
  introspectSession,
  handleClientCallback,
  syncSneekVerification,
} = require('./client.service');

function createClientRouter({ port }) {
  const router = express.Router();

  router.post('/generate-qr', async (req, res) => {
    const result = await createLoginSession(req.body?.clientId, port);
    res.status(result.status).json(result.body);
  });

  router.get('/session-status', (req, res) => {
    const sessionId = req.query?.session_id;
    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        error: 'session_id query parameter is required.',
      });
    }

    const result = getSession(sessionId);
    return res.status(result.status).json(result.body);
  });

  router.post('/verify-session', (req, res) => {
    const result = introspectSession(req.headers.authorization || '', req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/sneek/callback', (req, res) => {
    const result = handleClientCallback(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/sneek/verification-sync', (req, res) => {
    const result = syncSneekVerification(req.body);
    res.status(result.status).json(result.body);
  });

  // Legacy API compatibility
  router.get('/api/demo/bootstrap', (req, res) => {
    res.json(getBootstrap(port));
  });

  router.post('/api/client/login', async (req, res) => {
    const result = await createLoginSession(req.body?.clientId, port);
    res.status(result.status).json(result.body);
  });

  router.get('/api/client/session/:sessionId', (req, res) => {
    const result = getSession(req.params.sessionId);
    res.status(result.status).json(result.body);
  });

  router.post('/api/client/introspect', (req, res) => {
    const result = introspectSession(req.headers.authorization || '', req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/api/client/callback', (req, res) => {
    const result = handleClientCallback(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/api/client/verification-sync', (req, res) => {
    const result = syncSneekVerification(req.body);
    res.status(result.status).json(result.body);
  });

  return router;
}

module.exports = { createClientRouter };
