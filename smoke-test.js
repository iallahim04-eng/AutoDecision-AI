const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
async function req(path, method='GET', body, token) {
  const r = await fetch(base+path, {method, headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${data.error||''}`);
  return data;
}
(async()=>{
  const health=await req('/api/health'); if(!health.ok) throw new Error('health failed');
  const email=`test-${Date.now()}@example.com`;
  const signup=await req('/api/auth/signup','POST',{name:'مستخدم اختبار',email,password:'TestPass123'});
  const token=signup.token;
  const result=await req('/api/analyze','POST',{budget:130000,usage:'travel',family:4,km:20000,engine:'any',weights:{price:3,safety:4,reliab:5,economy:3,comfort:5,perf:2}},token);
  if(!result.results.length || !result.historyId) throw new Error('analysis was not saved');
  const history=await req('/api/history','GET',null,token);
  if(!history.history.some(x=>x.id===result.historyId)) throw new Error('history record missing');
  const profile=await req('/api/profile','GET',null,token);
  if(profile.analysisCount<1) throw new Error('profile count incorrect');
  console.log('PASS: health, signup, password hashing flow, analysis, SQLite persistence, history, profile');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1)});
