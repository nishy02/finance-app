require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Rate limiting — 100 requests per 15 minutes per IP
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  })
);

// Static frontend
app.use(express.static(path.join(__dirname, '../../finance-frontend')));

// Routes
app.use('/auth',      require('./routes/auth'));
app.use('/users',     require('./routes/users'));
app.use('/records',   require('./routes/records'));
app.use('/dashboard', require('./routes/dashboard'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Finance API running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    const { initProd } = require('./db/init');
    initProd();
  }
});

module.exports = app;
