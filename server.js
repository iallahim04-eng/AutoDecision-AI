'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'database', 'autodecision.db');
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'database', 'seed.json'), 'utf8'));
const insertCar = db.prepare(`INSERT OR IGNORE INTO cars
(id,name,type,fuel,price,seats,safety,reliability,economy,comfort,performance,city,travel,year,description)
VALUES (@id,@name,@type,@fuel,@price,@seats,@safety,@reliability,@economy,@comfort,@performance,@city,@travel,@year,@description)`);
for (const car of seed) insertCar.run(car);

const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function createUser(name, email, password, role = 'user') {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `${salt}:${scrypt(password, salt)}`;
  return db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name, email.trim().toLowerCase(), hash, role);
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = Buffer.from(scrypt(password, salt), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}
function ensureAccount(email, password, name, role) {
  if (!email || !password) return;
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (!existing) createUser(name, email, password, role);
}
ensureAccount(process.env.DEMO_EMAIL || 'demo@autodecision.ai', process.env.DEMO_PASSWORD || '123456', 'مستخدم تجريبي', 'user');
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) ensureAccount(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, 'مدير النظام', 'admin');

const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
};
const readBody = req => new Promise((resolve, reject) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) { reject(new Error('حجم الطلب كبير')); req.destroy(); } });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('صيغة البيانات غير صحيحة')); } });
  req.on('error', reject);
});
const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.created_at });
function tokenFor(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash, userId, expires);
  return token;
}
function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash, new Date().toISOString());
  return row ? { ...row, tokenHash: hash } : null;
}
function normalizeWeights(input = {}) {
  const keys = ['price','safety','reliab','economy','comfort','perf'];
  const w = {}; for (const k of keys) w[k] = Math.min(5, Math.max(1, Number(input[k] ?? 3)));
  return w;
}
function scoreCars(input) {
  const budget = Number(input.budget), family = Math.min(9, Math.max(1, Number(input.family || 4)));
  const km = Number(input.km || 20000), usage = ['city','travel','mixed'].includes(input.usage) ? input.usage : 'mixed';
  const engine = ['any','بنزين','هايبرد','كهربائي'].includes(input.engine) ? input.engine : 'any';
  const weights = normalizeWeights(input.weights);
  if (!Number.isFinite(budget) || budget < 20000 || budget > 10000000) throw new Error('أدخل ميزانية صحيحة بين 20,000 و10,000,000 ريال.');
  const cars = db.prepare('SELECT * FROM cars').all();
  const eligible = cars.filter(c => c.price <= budget && c.seats >= family && (engine === 'any' || c.fuel === engine));
  const pool = eligible.length ? eligible : cars.filter(c => c.seats >= family && (engine === 'any' || c.fuel === engine));
  const list = (pool.length ? pool : cars).map(c => {
    const w = { ...weights }; if (km >= 35000) w.economy += 1;
    const total = Object.values(w).reduce((a,b)=>a+b,0);
    const priceScore = c.price <= budget ? 6 + 4 * (1 - c.price / budget) : Math.max(0, 6 - ((c.price / budget) - 1) * 20);
    const attrs = { price: priceScore, safety:c.safety, reliab:c.reliability, economy:c.economy, comfort:c.comfort, perf:c.performance };
    const weighted = Object.keys(w).reduce((sum,k)=>sum + w[k] * attrs[k],0) / (total * 10);
    const use = (usage === 'mixed' ? (c.city+c.travel)/2 : c[usage]) / 10;
    let factor = 1;
    if (c.seats < family) factor *= 0.72;
    if (engine !== 'any' && c.fuel !== engine) factor *= 0.82;
    if (c.price > budget) factor *= 0.82;
    const match = Math.max(1, Math.min(99, Math.round(100 * (0.72 * weighted + 0.28 * use) * factor)));
    const reasons = [];
    const names = {price:'السعر',safety:'الأمان',reliab:'الاعتمادية',economy:'اقتصاد الوقود',comfort:'الراحة',perf:'الأداء'};
    Object.keys(w).sort((a,b)=>w[b]-w[a]).slice(0,3).forEach(k=>{ if(attrs[k] >= 8) reasons.push(`قوية في «${names[k]}» وهي من أولوياتك`); });
    reasons.push(c.price <= budget ? `ضمن ميزانيتك (${c.price.toLocaleString('en-US')} ريال)` : `تتجاوز ميزانيتك بـ ${(c.price-budget).toLocaleString('en-US')} ريال`);
    reasons.push(c.seats >= family ? `تستوعب عدد أفراد الأسرة (${c.seats} مقاعد)` : `عدد المقاعد (${c.seats}) أقل من أفراد الأسرة (${family})`);
    if (engine !== 'any') reasons.push(c.fuel === engine ? `تطابق المحرك المفضل (${engine})` : `محركها ${c.fuel} بخلاف تفضيلك`);
    return { ...c, match, why: reasons.slice(0,4) };
  }).sort((a,b)=>b.match-a.match || a.price-b.price).slice(0,4);
  return { input: { budget, family, km, usage, engine, weights }, results:list, note: eligible.length ? null : 'لم نجد سيارة تطابق الميزانية وعدد المقاعد ونوع المحرك معاً؛ أظهرنا أقرب الخيارات للمقارنة.' };
}

async function api(req, res, url) {
  const method = req.method, p = url.pathname;
  if (method === 'GET' && p === '/api/health') return send(res,200,{ok:true,service:'AutoDecision AI',database:'SQLite',time:new Date().toISOString()});
  if (method === 'POST' && p === '/api/auth/signup') {
    const b = await readBody(req); const name=String(b.name||'').trim(), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'');
    if (name.length<2 || name.length>80) return send(res,400,{error:'الاسم يجب أن يكون بين حرفين و80 حرفاً.'});
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length>190) return send(res,400,{error:'البريد الإلكتروني غير صالح.'});
    if (password.length<8) return send(res,400,{error:'كلمة المرور يجب ألا تقل عن 8 أحرف.'});
    try { const r=createUser(name,email,password); const u=db.prepare('SELECT * FROM users WHERE id=?').get(Number(r.lastInsertRowid)); return send(res,201,{user:safeUser(u),token:tokenFor(u.id)}); }
    catch(e) { if(String(e.message).includes('UNIQUE')) return send(res,409,{error:'هذا البريد مسجّل مسبقاً.'}); throw e; }
  }
  if (method === 'POST' && p === '/api/auth/login') {
    const b=await readBody(req), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'');
    const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!u || !verifyPassword(password,u.password_hash)) return send(res,401,{error:'البريد الإلكتروني أو كلمة المرور غير صحيحة.'});
    return send(res,200,{user:safeUser(u),token:tokenFor(u.id)});
  }
  const user=auth(req);
  if (p.startsWith('/api/') && !user && !(method==='POST' && p==='/api/auth/login') && !(method==='POST' && p==='/api/auth/signup')) return send(res,401,{error:'يلزم تسجيل الدخول أولاً.'});
  if (method==='GET' && p==='/api/auth/me') return send(res,200,{user:safeUser(user)});
  if (method==='POST' && p==='/api/auth/logout') { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.tokenHash); return send(res,200,{ok:true}); }
  if (method==='GET' && p==='/api/cars') return send(res,200,{cars:db.prepare('SELECT * FROM cars ORDER BY name').all()});
  if (method==='POST' && p==='/api/analyze') {
    const b=await readBody(req), result=scoreCars(b);
    const insertHistory=db.prepare('INSERT INTO decision_history(user_id,input_json,results_json) VALUES(?,?,?)');
    const h=insertHistory.run(user.id,JSON.stringify(result.input),JSON.stringify(result.results));
    const ins=db.prepare('INSERT INTO recommendations(user_id,car_id,match_score,rank,reasons_json) VALUES(?,?,?,?,?)');
    result.results.forEach((c,i)=>ins.run(user.id,c.id,c.match,i+1,JSON.stringify(c.why)));
    return send(res,200,{...result,historyId:Number(h.lastInsertRowid)});
  }
  if (method==='GET' && p==='/api/history') {
    const rows=db.prepare('SELECT id,input_json,results_json,created_at FROM decision_history WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
    return send(res,200,{history:rows.map(r=>({id:r.id,input:JSON.parse(r.input_json),results:JSON.parse(r.results_json),createdAt:r.created_at}))});
  }
  if (method==='DELETE' && p.startsWith('/api/history/')) {
    const id=Number(p.split('/').pop()); const r=db.prepare('DELETE FROM decision_history WHERE id=? AND user_id=?').run(id,user.id);
    return send(res,r.changes?200:404,{ok:!!r.changes});
  }
  if (method==='POST' && p==='/api/comparisons') {
    const b=await readBody(req), ids=Array.isArray(b.carIds)?b.carIds.map(Number).filter(Number.isInteger).slice(0,4):[];
    if(ids.length<2) return send(res,400,{error:'اختر سيارتين على الأقل للمقارنة.'});
    db.prepare('INSERT INTO comparisons(user_id,car_ids_json) VALUES(?,?)').run(user.id,JSON.stringify(ids));
    return send(res,201,{ok:true});
  }
  if (method==='GET' && p==='/api/profile') {
    const total=db.prepare('SELECT COUNT(*) n FROM decision_history WHERE user_id=?').get(user.id).n;
    const fav=db.prepare('SELECT COUNT(*) n FROM favorites WHERE user_id=?').get(user.id).n;
    return send(res,200,{user:safeUser(user),analysisCount:total,favoritesCount:fav});
  }
  if (method==='POST' && p==='/api/favorites') {
    const b=await readBody(req), id=Number(b.carId); if(!db.prepare('SELECT id FROM cars WHERE id=?').get(id)) return send(res,404,{error:'السيارة غير موجودة.'});
    db.prepare('INSERT OR IGNORE INTO favorites(user_id,car_id) VALUES(?,?)').run(user.id,id); return send(res,200,{ok:true});
  }
  if (method==='GET' && p==='/api/favorites') return send(res,200,{cars:db.prepare('SELECT c.* FROM favorites f JOIN cars c ON c.id=f.car_id WHERE f.user_id=?').all(user.id)});
  if (method==='DELETE' && p.startsWith('/api/favorites/')) { const id=Number(p.split('/').pop()); db.prepare('DELETE FROM favorites WHERE user_id=? AND car_id=?').run(user.id,id); return send(res,200,{ok:true}); }
  if (method==='GET' && p==='/api/admin/stats') {
    if(user.role!=='admin') return send(res,403,{error:'هذه الصفحة للمشرف فقط.'});
    return send(res,200,{users:db.prepare('SELECT COUNT(*) n FROM users').get().n,cars:db.prepare('SELECT COUNT(*) n FROM cars').get().n,analyses:db.prepare('SELECT COUNT(*) n FROM decision_history').get().n,recentUsers:db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id DESC LIMIT 10').all()});
  }
  if (method==='POST' && p==='/api/admin/cars') {
    if(user.role!=='admin') return send(res,403,{error:'هذه العملية للمشرف فقط.'});
    const b=await readBody(req); const fields=['name','type','fuel','price','seats','safety','reliability','economy','comfort','performance','city','travel'];
    if(fields.some(k=>b[k]===undefined || b[k]==='')) return send(res,400,{error:'أكمل جميع بيانات السيارة المطلوبة.'});
    const q=db.prepare(`INSERT INTO cars(name,type,fuel,price,seats,safety,reliability,economy,comfort,performance,city,travel,year,description) VALUES(@name,@type,@fuel,@price,@seats,@safety,@reliability,@economy,@comfort,@performance,@city,@travel,@year,@description)`);
    const values={...b,price:Number(b.price),seats:Number(b.seats),year:Number(b.year||2025),description:String(b.description||'')};
    for(const k of ['safety','reliability','economy','comfort','performance','city','travel']) values[k]=Number(b[k]);
    const r=q.run(values); return send(res,201,{id:Number(r.lastInsertRowid)});
  }
  return send(res,404,{error:'المسار غير موجود.'});
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    if(req.method!=='GET' && req.method!=='HEAD') return send(res,405,{error:'الطريقة غير مدعومة.'});
    let pathname=decodeURIComponent(url.pathname); if(pathname==='/') pathname='/index.html';
    const file=path.resolve(path.join(ROOT,'public',pathname));
    if(!file.startsWith(path.resolve(path.join(ROOT,'public'))+path.sep) && file!==path.resolve(path.join(ROOT,'public','index.html'))) return send(res,403,{error:'ممنوع'});
    fs.readFile(file,(err,data)=>{if(err)return send(res,404,{error:'الصفحة غير موجودة.'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);});
  } catch(e) { console.error(e); if(!res.headersSent) send(res,500,{error:e.message==='Unexpected end of JSON input'?'تعذر قراءة البيانات.':'حدث خطأ داخلي، حاول مرة أخرى.'}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`\nAutoDecision AI يعمل على http://localhost:${PORT}\nقاعدة البيانات: ${DB_FILE}\n`));
process.on('SIGINT',()=>{db.close();process.exit(0)});
process.on('SIGTERM',()=>{db.close();process.exit(0)});
