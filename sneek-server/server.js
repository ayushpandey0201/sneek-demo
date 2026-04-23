const express = require('express');
const cors = require('cors');
const { createSneekRouter } = require('./src/sneek/sneek.routes');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(createSneekRouter());

app.listen(PORT, () => {
  console.log(`Sneek server running at http://localhost:${PORT}`);
});
