const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'emi-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

const db = mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'Abhishek1#',
  database: process.env.DB_NAME     || 'emi_calculator',
  port:     process.env.DB_PORT     || 3306
});

db.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err.message);
  } else {
    console.log('✅ MySQL connected successfully!');
    db.query(`CREATE TABLE IF NOT EXISTS calculations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      principal DECIMAL(15,2),
      annual_rate DECIMAL(5,2),
      tenure_months INT,
      emi DECIMAL(15,2),
      total_interest DECIMAL(15,2),
      total_payment DECIMAL(15,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error(err.message); else console.log('✅ Table ready!'); });

    db.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error(err.message); else console.log('✅ Users table ready!'); });
  }
});

// Middleware to check if logged in
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please login first' });
  }
  next();
}

// ── AUTH ROUTES ──────────────────────────────

// Register
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashed], (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ error: 'Email already registered' });
          return res.status(500).json({ error: 'Registration failed' });
        }
        req.session.user = { id: result.insertId, name, email };
        res.json({ message: 'Registered successfully!', user: { name, email } });
      });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ error: 'Invalid email or password' });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ error: 'Invalid email or password' });

    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.json({ message: 'Login successful!', user: { name: user.name, email: user.email } });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// Get current user
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

// ── EMI ROUTES ───────────────────────────────

app.post('/api/calculate', requireLogin, (req, res) => {
  const { principal, annualRate, tenureMonths } = req.body;
  if (!principal || !annualRate || !tenureMonths)
    return res.status(400).json({ error: 'Missing required fields' });

  const P = parseFloat(principal);
  const r = parseFloat(annualRate) / 12 / 100;
  const n = parseInt(tenureMonths);

  if (P <= 0 || annualRate < 0 || n <= 0)
    return res.status(400).json({ error: 'Invalid input values' });

  let emi = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const totalPayment = emi * n;
  const totalInterest = totalPayment - P;

  const schedule = [];
  let balance = P;
  for (let month = 1; month <= n; month++) {
    const interestForMonth = balance * r;
    const principalForMonth = emi - interestForMonth;
    balance -= principalForMonth;
    schedule.push({
      month, emi: +emi.toFixed(2),
      principal: +principalForMonth.toFixed(2),
      interest: +interestForMonth.toFixed(2),
      balance: +Math.max(balance, 0).toFixed(2),
    });
  }

  const sql = `INSERT INTO calculations (user_id, principal, annual_rate, tenure_months, emi, total_interest, total_payment)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.query(sql, [req.session.user.id, P, annualRate, n, emi.toFixed(2), totalInterest.toFixed(2), totalPayment.toFixed(2)], (err) => {
    if (err) console.error('DB save error:', err.message);
    else console.log('💾 Calculation saved to database');
  });

  res.json({ emi: +emi.toFixed(2), totalPayment: +totalPayment.toFixed(2), totalInterest: +totalInterest.toFixed(2), principal: P, schedule });
});

app.get('/api/history', requireLogin, (req, res) => {
  db.query('SELECT * FROM calculations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [req.session.user.id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(results);
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.listen(PORT, () => console.log(`\n✅ EMI Calculator running at http://localhost:${PORT}\n`));