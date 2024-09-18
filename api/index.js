import express from 'express';
import { logTimestampedMessage } from '../utils/logging.js';

const app = express();
const port = 3001;

app.get('/', (req, res) => {
  res.send('API is running!');
});

app.listen(port, () => {
    logTimestampedMessage(`Nina API listening on port ${port}`);
});
