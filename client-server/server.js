const express = require('express');
const cors = require('cors');
const { createClientRouter } = require('./src/client/client.routes');
const { ensureSessionCleanup } = require('./src/shared/sessionStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(createClientRouter({ port: PORT }));

ensureSessionCleanup();

app.listen(PORT, () => {
  console.log(`Client server running at http://localhost:${PORT}`);
});
