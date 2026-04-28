const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3030;
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Client web server running at http://localhost:${PORT}`);
});
