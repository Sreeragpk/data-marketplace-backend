const express = require('express');
const router = express.Router();
const pool = require('../db'); // your configured pg pool

router.get('/datasets/:id/stats', async (req, res) => {
  const datasetId = req.params.id;

  try {
    const totalRes = await pool.query(
      'SELECT COUNT(*) FROM purchases WHERE dataset_id = $1',
      [datasetId]
    );

    const lastHourRes = await pool.query(
      `SELECT COUNT(*) FROM purchases 
       WHERE dataset_id = $1 AND purchased_at >= NOW() - INTERVAL '1 hour'`,
      [datasetId]
    );

    res.json({
      totalPurchases: parseInt(totalRes.rows[0].count, 10),
      lastHourPurchases: parseInt(lastHourRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error('Error fetching dataset stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
