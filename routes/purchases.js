const express = require('express');
const router = express.Router();
const db = require('../db'); // Your DB client

router.post('/purchase', async (req, res) => {
  const { userId, datasetId } = req.body;

  if (!userId || !datasetId) {
    return res.status(400).json({ error: 'Missing user ID or dataset ID' });
  }

  try {
    // Check if user exists
    const userRes = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User does not exist' });
    }

    // Check if dataset exists
    const datasetRes = await db.query('SELECT id FROM datasets WHERE id = $1', [datasetId]);
    if (datasetRes.rows.length === 0) {
      return res.status(400).json({ error: 'Dataset does not exist' });
    }

    // Check if already purchased
    const exists = await db.query(
      'SELECT * FROM purchases WHERE user_id = $1 AND dataset_id = $2',
      [userId, datasetId]
    );

    if (exists.rows.length > 0) {
      return res.status(200).json({ message: 'Already purchased' });
    }

    // Insert new purchase
    const result = await db.query(
      'INSERT INTO purchases (user_id, dataset_id) VALUES ($1, $2) RETURNING *',
      [userId, datasetId]
    );

    res.status(201).json({ success: true, purchase: result.rows[0] });

  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Foreign key constraint failed: invalid user or dataset ID' });
    }

    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Server error during purchase' });
  }
});

module.exports = router;
