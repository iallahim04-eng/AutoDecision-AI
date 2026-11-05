const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH API ---
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    if (!user) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });

    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  });
});

// --- CARS API ---
app.get('/api/cars', (req, res) => {
  const { search, brand, category, fuel_type, max_price, sort } = req.query;
  let query = `SELECT * FROM cars WHERE 1=1`;
  let params = [];

  if (search) {
    query += ` AND (name LIKE ? OR brand LIKE ? OR category LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (brand && brand !== 'all') {
    query += ` AND brand = ?`;
    params.push(brand);
  }
  if (category && category !== 'all') {
    query += ` AND category = ?`;
    params.push(category);
  }
  if (fuel_type && fuel_type !== 'all') {
    query += ` AND fuel_type = ?`;
    params.push(fuel_type);
  }
  if (max_price) {
    query += ` AND price <= ?`;
    params.push(Number(max_price));
  }

  if (sort === 'price_asc') query += ` ORDER BY price ASC`;
  else if (sort === 'price_desc') query += ` ORDER BY price DESC`;
  else if (sort === 'rating') query += ` ORDER BY (reliability_score + safety_score) DESC`;
  else query += ` ORDER BY id ASC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/brands', (req, res) => {
  db.all(`SELECT DISTINCT brand FROM cars ORDER BY brand ASC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.brand));
  });
});

app.get('/api/categories', (req, res) => {
  db.all(`SELECT DISTINCT category FROM cars ORDER BY category ASC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.category));
  });
});

app.get('/api/cars/:id', (req, res) => {
  db.get(`SELECT * FROM cars WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'السيارة غير موجودة' });
    res.json(row);
  });
});

// --- DECISION SUPPORT ENGINE (MCDM - Weighted Scoring) ---
app.post('/api/decision/analyze', (req, res) => {
  const { budget, family_size, annual_km, use_case, fuel_preference, weights } = req.body;
  const w = weights || { price: 0.25, safety: 0.2, reliability: 0.2, economy: 0.15, comfort: 0.1, performance: 0.1 };

  db.all(`SELECT * FROM cars WHERE price <= ?`, [budget * 1.15], (err, cars) => {
    if (err) return res.status(500).json({ error: err.message });
    if (cars.length === 0) {
      db.all(`SELECT * FROM cars ORDER BY price ASC LIMIT 10`, [], (err2, fallbackCars) => {
        if (err2) return res.status(500).json({ error: err2.message });
        processScoring(fallbackCars, req.body, w, res);
      });
    } else {
      processScoring(cars, req.body, w, res);
    }
  });
});

function processScoring(cars, inputs, w, res) {
  let scoredCars = cars.map(car => {
    const priceDiffRatio = Math.abs(car.price - inputs.budget) / inputs.budget;
    let priceScore = Math.max(0, 100 - (priceDiffRatio * 100));
    if (car.price <= inputs.budget) priceScore = 100;

    let familyScore = car.seats >= inputs.family_size ? 100 : 50;
    let fuelScore = (inputs.fuel_preference === 'all' || car.fuel_type === inputs.fuel_preference) ? 100 : 60;

    let rawScore = 
      (priceScore * w.price) +
      (car.safety_score * 10 * w.safety) +
      (car.reliability_score * 10 * w.reliability) +
      (car.fuel_economy * 3.5 * w.economy) +
      (car.comfort_score * 10 * w.comfort) +
      (car.performance_score * 10 * w.performance);

    let matchPercentage = Math.min(99, Math.max(60, Math.round((rawScore / 100) * 95 * (familyScore / 100) * (fuelScore / 100))));

    let reasons = [];
    if (car.price <= inputs.budget) reasons.push(`تتناسب تماماً مع ميزانيتك المحددة (${car.price.toLocaleString()} ريال).`);
    if (car.fuel_economy >= 18) reasons.push(`معدل استهلاك وقود ممتاز جداً (${car.fuel_economy} كم/لتر) يوفر بشكل ملحوظ.`);
    if (car.reliability_score >= 9.5) reasons.push(`مستوى اعتمادية أسطوري (${car.reliability_score}/10) يقلل الأعطال لأدنى حد.`);
    if (car.safety_score >= 9.0) reasons.push(`تجهيزات أمان متقدمة وتقييم عالي جداً (${car.safety_score}/10).`);
    if (car.seats >= inputs.family_size) reasons.push(`سعة مقاعد مناسبة لعدد أفراد أسرتك (${car.seats} مقاعد).`);

    return {
      ...car,
      matchPercentage,
      reasons,
      pros: [`كفاءة عالية في فئة ${car.category}`, `قيمة ممتازة عند إعادة البيع وموثوقية عالية`],
      cons: [car.price > inputs.budget ? 'تتجاوز الميزانية الأساسية قليلاً' : 'تحتاج لجدولة الصيانة الدورية في وكيل معتمد']
    };
  });

  scoredCars.sort((a, b) => b.matchPercentage - a.matchPercentage);
  const topCars = scoredCars.slice(0, 4);

  res.json({
    success: true,
    methodology: 'Weighted Multi-Criteria Decision Making (MCDM) Model with Sensitivity Weights',
    topCars
  });
}

// --- TCO CALCULATOR API (Complete Financial Breakdown) ---
app.post('/api/decision/tco', (req, res) => {
  const { car_id, years, annual_km } = req.body;

  db.get(`SELECT * FROM cars WHERE id = ?`, [car_id], (err, car) => {
    if (err || !car) return res.status(404).json({ error: 'السيارة غير موجودة' });

    const numYears = Number(years) || 5;
    const price = car.price;
    const downPayment = price * 0.20; // 20% دفعة مقدمة افتراضية
    const loanAmount = price - downPayment;
    const totalFinancingCost = loanAmount * (1 + (0.045 * numYears)); // مرابحة 4.5% سنوياً
    const actualPurchaseCost = downPayment + totalFinancingCost;

    const km = Number(annual_km) || 20000;
    // سعر لتر البنزين 2.33 ريال افتراضياً
    const fuelCostAnnual = (km / car.fuel_economy) * 2.33;
    const totalFuelCost = fuelCostAnnual * numYears;
    
    // الصيانة الدورية السنوية (تزداد تدريجياً حسب السنوات)
    let totalMaintCost = 0;
    for (let y = 1; y <= numYears; y++) {
      totalMaintCost += (2000 + (y * 300));
    }

    // التأمين الشامل السنوي (تقريباً 2.5% من سعر السيارة يتناقص سنوياً)
    let totalInsCost = 0;
    let currValIns = price;
    for (let y = 1; y <= numYears; y++) {
      totalInsCost += (currValIns * 0.025);
      currValIns *= 0.88;
    }

    // تكلفة الإطارات والبطاريات التراكمية
    const totalTireCost = numYears >= 4 ? 2400 : 1200;

    // استهلاك وانخفاض قيمة السيارة (Depreciation)
    let resaleValue = price;
    for (let y = 1; y <= numYears; y++) {
      let depRate = y === 1 ? 0.15 : 0.09; // انخفاض أول سنة 15% ثم 9% سنوياً
      resaleValue = resaleValue * (1 - depRate);
    }
    resaleValue = Math.max(resaleValue, price * 0.32); // لا تقل عن 32% من السعر الأصلي

    const netDepreciation = actualPurchaseCost - resaleValue;
    const totalTCO = netDepreciation + totalFuelCost + totalMaintCost + totalInsCost + totalTireCost;
    const annualTCO = totalTCO / numYears;
    const monthlyTCO = annualTCO / 12;
    const costPerKm = totalTCO / (km * numYears);

    res.json({
      success: true,
      car,
      tco_summary: {
        purchase_price: price,
        down_payment: Math.round(downPayment),
        resale_value: Math.round(resaleValue),
        net_depreciation: Math.round(netDepreciation),
        total_fuel_cost: Math.round(totalFuelCost),
        total_maintenance_cost: Math.round(totalMaintCost),
        total_insurance_cost: Math.round(totalInsCost),
        total_tire_cost: Math.round(totalTireCost),
        total_tco: Math.round(totalTCO),
        annual_tco: Math.round(annualTCO),
        monthly_tco: Math.round(monthlyTCO),
        cost_per_km: Number(costPerKm.toFixed(2))
      }
    });
  });
});

// --- WHAT-IF SIMULATION API ---
app.post('/api/decision/what-if', (req, res) => {
  const { base_budget, new_budget, base_km, new_km } = req.body;
  const budgetDelta = Number(new_budget) - Number(base_budget);
  const kmDelta = Number(new_km) - Number(base_km);
  
  let recommendationNote = '';
  if (budgetDelta > 0) {
    recommendationNote = `زيادة الميزانية بمقدار ${budgetDelta.toLocaleString()} ريال تتيح لك الانتقال إلى فئة أعلى من السيارات الفاخرة أو ذات الاعتمادية الفائقة ومستويات أمان أعلى، مع خيارات محركات هجينة أكثر توفيراً.`;
  } else if (budgetDelta < 0) {
    recommendationNote = `تقليل الميزانية بمقدار ${Math.abs(budgetDelta).toLocaleString()} ريال يحتم عليك التركيز على السيارات الاقتصادية المدمجة (فئات السيدان الصغيرة أو الـ Crossover الصغيرة) مع توفير ملحوظ في تكاليف التمويل.`;
  } else {
    recommendationNote = `تثبيت الميزانية مع تعديل المسافة السنوية (${kmDelta > 0 ? 'زيادة' : 'تقليل'} الاستهلاك بقيمة ${Math.abs(kmDelta)} كم) يؤثر بشكل مباشر على تكاليف استهلاك الوقود والصيانة الدورية ضمن حسابات TCO.`;
  }

  res.json({
    success: true,
    simulation: { budget_delta: budgetDelta, km_delta: kmDelta, recommendation: recommendationNote }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
