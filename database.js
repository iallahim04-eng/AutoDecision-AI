const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(() => {
  // Create Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
  )`);

  // Create Cars Table
  db.run(`CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    brand TEXT,
    category TEXT,
    price REAL,
    fuel_type TEXT,
    fuel_economy REAL,
    reliability_score REAL,
    safety_score REAL,
    comfort_score REAL,
    performance_score REAL,
    seats INTEGER,
    description TEXT,
    image TEXT
  )`, () => {
    // Seed sample cars if table is empty
    db.get(`SELECT COUNT(*) as count FROM cars`, (err, row) => {
      if (row && row.count === 0) {
        const stmt = db.prepare(`INSERT INTO cars (name, brand, category, price, fuel_type, fuel_economy, reliability_score, safety_score, comfort_score, performance_score, seats, description, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        
        const defaultCars = [
          ['تويوتا كامري هجين', 'تويوتا', 'سيدان', 115000, 'هجين', 26.0, 9.5, 9.0, 8.5, 8.0, 5, 'سيارة اقتصادية وعائلية ممتازة مع كفاءة عالية في استهلاك الوقود.', 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&w=800&q=80'],
          ['هيونداي سوناتا', 'هيونداي', 'سيدان', 105000, 'بنزين', 16.5, 8.8, 8.5, 8.5, 8.2, 5, 'تصميم عصري جريء مع تقنيات راحة متقدمة.', 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=800&q=80'],
          ['تويوتا فورتشنر', 'تويوتا', 'دفع رباعي', 145000, 'ديزل', 14.0, 9.8, 8.8, 7.5, 8.5, 7, 'سيارة دفع رباعي قوية وموثوقة لكافة الطرق والرحلات.', 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800&q=80'],
          ['كيا ك8 هجين', 'كيا', 'سيدان فاخرة', 135000, 'هجين', 18.2, 9.0, 9.2, 9.0, 8.8, 5, 'سيدان فاخرة بتصميم مستقبلي وراحة فائقة.', 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=800&q=80']
        ];

        defaultCars.forEach(car => stmt.run(car));
        stmt.finalize();
      }
    });
  });

  // Insert default demo user
  db.get(`SELECT COUNT(*) as count FROM users WHERE email = ?`, ['demo@autodecision.ai'], async (err, row) => {
    if (row && row.count === 0) {
      const hashedPassword = await bcrypt.hash('123456', 8);
      db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, ['أبو نورة', 'demo@autodecision.ai', hashedPassword]);
    }
  });
});

module.exports = db;
