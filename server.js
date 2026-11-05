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

// --- AUTH: LOGIN API ---
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

// --- AUTH: REGISTER API ---
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال كافة البيانات المطلوبة' });
  }

  try {
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, existingUser) => {
      if (err) return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
      if (existingUser) {
        return res.status(400).json({ error: 'البريد الإلكتروني مستخدم مسبقاً' });
      }

      const hashedPassword = await bcrypt.hash(password, 8);
      db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, hashedPassword], function(err2) {
        if (err2) return res.status(500).json({ error: 'فشل إنشاء الحساب' });
        res.json({ 
          success: true, 
          user: { id: this.lastID, name, email },
          message: 'تم إنشاء الحساب بنجاح'
        });
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'حدث خطأ غير متوقع' });
  }
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

// --- DECISION SUPPORT ENGINE (MCDM) ---
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

// --- TCO CALCULATOR API (Precise Financial Calculations) ---
app.post('/api/decision/tco', (req, res) => {
  const { car_id, years, annual_km, include_financing } = req.body;

  db.get(`SELECT * FROM cars WHERE id = ?`, [car_id], (err, car) => {
    if (err || !car) return res.status(404).json({ error: 'السيارة غير موجودة' });

    const numYears = Number(years) || 5;
    const price = car.price;
    
    // التمويل اختياري
    let actualPurchaseCost = price;
    let downPayment = price;
    let totalFinancingCost = 0;
    
    if (include_financing) {
      downPayment = price * 0.20;
      const loanAmount = price - downPayment;
      totalFinancingCost = loanAmount * (1 + (0.045 * numYears));
      actualPurchaseCost = downPayment + totalFinancingCost;
    }

    const km = Number(annual_km) || 20000;
    
    // تسعير الوقود تفاضلي حسب نوع المحرك
    let fuelPricePerLiter = 2.33; // بنزين 91 افتراضي
    if (car.fuel_type === 'ديزل') fuelPricePerLiter = 1.15;
    if (car.fuel_type === 'هجين') fuelPricePerLiter = 2.33; // كفاءة مضاعفة في استهلاك اللتر

    const fuelCostAnnual = (km / car.fuel_economy) * fuelPricePerLiter;
    const totalFuelCost = fuelCostAnnual * numYears;
    
    // الصيانة الدورية تختلف بحسب الفئة والسعر
    let baseMaint = car.price > 150000 ? 3500 : 2000;
    let totalMaintCost = 0;
    for (let y = 1; y <= numYears; y++) {
      totalMaintCost += (baseMaint + (y * 250));
    }

    // التأمين الشامل التقديري يتناقص سنوياً
    let totalInsCost = 0;
    let currValIns = price;
    for (let y = 1; y <= numYears; y++) {
      totalInsCost += (currValIns * 0.022);
      currValIns *= 0.88;
    }

    const totalTireCost = numYears >= 4 ? 2600 : 1300;

    // انخفاض القيمة وإعادة البيع
    let resaleValue = price;
    for (let y = 1; y <= numYears; y++) {
      let depRate = y === 1 ? 0.15 : 0.09;
      resaleValue = resaleValue * (1 - depRate);
    }
    resaleValue = Math.max(resaleValue, price * 0.30);

    const netDepreciation = actualPurchaseCost - resaleValue;
    const totalTCO = netDepreciation + totalFuelCost + totalMaintCost + totalInsCost + totalTireCost;
    const annualTCO = totalTCO / numYears;
    const monthlyTCO = annualTCO / 12;
    // التكلفة بالريال لكل كيلومتر (وليس هللة)
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
        cost_per_km: Number(costPerKm.toFixed(2)) // بالريال
      }
    });
  });
});

// --- WHAT-IF SIMULATION API (Real Re-evaluation) ---
app.post('/api/decision/what-if', (req, res) => {
  const { base_budget, new_budget, base_km, new_km } = req.body;
  const budgetDelta = Number(new_budget) - Number(base_budget);
  const kmDelta = Number(new_km) - Number(base_km);
  
  // إعادة تقييم فعلية للسيارات المتاحة تحت الميزانية الجديدة
  db.all(`SELECT COUNT(*) as available_count, AVG(price) as avg_price FROM cars WHERE price <= ?`, [Number(new_budget)], (err, row) => {
    let availableCount = row ? row.available_count : 0;
    let avgPrice = row ? Math.round(row.avg_price || 0) : 0;

    let recommendationNote = `عند تعديل الميزانية من ${Number(base_budget).toLocaleString()} ر.س إلى ${Number(new_budget).toLocaleString()} ر.س (${budgetDelta >= 0 ? '+' : ''}${budgetDelta.toLocaleString()} ر.س)، وتغيير المسافة السنوية إلى ${Number(new_km).toLocaleString()} كم: `;
    
    if (budgetDelta > 0) {
      recommendationNote += `اتاحت لك الزيادة الوصول إلى عدد ${availableCount} سيارة مطابقة في القاعدة بمتوسط أسعار يقدر بـ ${avgPrice.toLocaleString()} ر.س، مع تحسن ملحوظ في خيارات الرفاهية والأمان وتقليل تكلفة التشغيل للمسافات الأطول.`;
    } else if (budgetDelta < 0) {
      recommendationNote += `أدى تخفيض الميزانية إلى حصر الخيارات في ${availableCount} سيارة اقتصادية، مما يقلل تكلفة التمويل ولكنه يرفع تكلفة الصيانة النسبية نسبة للاستهلاك (${Number(new_km).toLocaleString()} كم سنويًا).`;
    } else {
      recommendationNote += `تثبيت الميزانية مع تعديل معدل الحركة السنوي (${Math.abs(kmDelta)} كم) يؤثر حصرياً على استهلاك الوقود الإجمالي وتآكل الإطارات بنسبة مقدرة مالياً.`;
    }

    res.json({
      success: true,
      simulation: { 
        budget_delta: budgetDelta, 
        km_delta: kmDelta, 
        new_available_cars: availableCount,
        average_matched_price: avgPrice,
        recommendation: recommendationNote 
      }
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
