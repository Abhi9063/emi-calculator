const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⚠️ REPLACE 'YOUR_PASSWORD_HERE' with your actual MySQL password
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Abhishek1#',
  database: 'emi_calculator',
  port: 3306
});

db.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err.message);
  } else {
    console.log('✅ MySQL connected successfully!');
  }
});

// EMI Calculation API
app.post('/api/calculate', (req, res) => {
  const { principal, annualRate, tenureMonths } = req.body;

  if (!principal || !annualRate || !tenureMonths) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const P = parseFloat(principal);
  const r = parseFloat(annualRate) / 12 / 100;
  const n = parseInt(tenureMonths);

  if (P <= 0 || annualRate < 0 || n <= 0) {
    return res.status(400).json({ error: 'Invalid input values' });
  }

  let emi;
  if (r === 0) {
    emi = P / n;
  } else {
    emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  const totalPayment = emi * n;
  const totalInterest = totalPayment - P;

  // Generate amortization schedule
  const schedule = [];
  let balance = P;
  for (let month = 1; month <= n; month++) {
    const interestForMonth = balance * r;
    const principalForMonth = emi - interestForMonth;
    balance -= principalForMonth;
    schedule.push({
      month,
      emi: +emi.toFixed(2),
      principal: +principalForMonth.toFixed(2),
      interest: +interestForMonth.toFixed(2),
      balance: +Math.max(balance, 0).toFixed(2),
    });
  }

  // Save to MySQL
  const sql = `INSERT INTO calculations (principal, annual_rate, tenure_months, emi, total_interest, total_payment)
               VALUES (?, ?, ?, ?, ?, ?)`;
  db.query(sql, [P, annualRate, n, emi.toFixed(2), totalInterest.toFixed(2), totalPayment.toFixed(2)], (err) => {
    if (err) console.error('DB save error:', err.message);
    else console.log('💾 Calculation saved to database');
  });

  res.json({
    emi: +emi.toFixed(2),
    totalPayment: +totalPayment.toFixed(2),
    totalInterest: +totalInterest.toFixed(2),
    principal: P,
    schedule,
  });
});

// Get calculation history
app.get('/api/history', (req, res) => {
  db.query('SELECT * FROM calculations ORDER BY created_at DESC LIMIT 20', (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(results);
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ EMI Calculator running at http://localhost:${PORT}\n`);
});
