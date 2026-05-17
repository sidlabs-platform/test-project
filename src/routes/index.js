const express = require('express');
const router = express.Router();

const items = [
  { id: 1, name: 'Item One', description: 'First demo item' },
  { id: 2, name: 'Item Two', description: 'Second demo item' },
  { id: 3, name: 'Item Three', description: 'Third demo item' },
];

router.get('/items', (req, res) => {
  res.json(items);
});

router.get('/items/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = items.find(i => i.id === id);
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json(item);
});

router.get('/version', (req, res) => {
  res.json({
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
