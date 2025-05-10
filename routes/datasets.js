const express = require('express');
const router = express.Router();
const db = require('../db'); // adjust path if needed
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

router.get('/:id/download', async (req, res) => {
  const datasetId = parseInt(req.params.id);
  const userId = parseInt(req.query.userId);

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

    const filePaths = dataset.rows[0].file_path.split(',');
    const downloadUrls = [];

    for (const path of filePaths) {
      const { data } = supabase.storage.from('datasets').getPublicUrl(path.trim());
      if (data?.publicUrl) {
        downloadUrls.push(data.publicUrl);
      }
    }

    if (downloadUrls.length === 0) {
      return res.status(404).json({ error: 'No valid files found in Supabase' });
    }

    res.json({ downloadUrls });
  } catch (err) {
    console.error('Download route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
