const express = require('express');
const router = express.Router();
const pool = require('../db');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// ✅ Create Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ---------------- Initiate Razorpay Payment ----------------
router.post('/payment/razorpay/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Fetch dataset details by ID
    const result = await pool.query('SELECT * FROM datasets WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dataset not found' });
    }

    const dataset = result.rows[0];

    const options = {
      amount: dataset.price * 100, // convert to paise
      currency: 'INR',
      receipt: id,
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: options.amount,
      currency: options.currency,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error initiating payment.' });
  }
});

// ---------------- Verify Razorpay Payment ----------------
router.post('/payment/verify', (req, res) => {
  const { paymentId, orderId, signature } = req.body;

  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(orderId + '|' + paymentId)
    .digest('hex');

  if (generatedSignature === signature) {
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, message: 'Payment verification failed.' });
  }
});

module.exports = router;
