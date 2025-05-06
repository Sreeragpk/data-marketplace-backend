const express = require('express');
const router = express.Router();
const db = require('../db'); // adjust path if needed
const path = require('path');
const fs = require('fs');

// Download dataset file (only if purchased)
router.get('/:id/download', async (req, res) => {
  const datasetId = parseInt(req.params.id);
  const userId = parseInt(req.query.userId); // 🚨 Insecure for production — use auth token/session

  if (!userId || !datasetId) {
    return res.status(400).json({ error: 'Missing user ID or dataset ID' });
  }

  try {
    const purchase = await db.query(
      'SELECT * FROM purchases WHERE user_id = $1 AND dataset_id = $2',
      [userId, datasetId]
    );

    if (purchase.rows.length === 0) {
      return res.status(403).json({ error: 'Dataset not purchased' });
    }

    const dataset = await db.query(
      'SELECT file_path FROM datasets WHERE id = $1',
      [datasetId]
    );

    if (dataset.rows.length === 0) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const filePath = dataset.rows[0].file_path;
    const fullPath = path.join(__dirname, '..', 'uploads', filePath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File does not exist on server' });
    }

    res.download(fullPath, path.basename(filePath));
  } catch (err) {
    console.error('Error in download route:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;
