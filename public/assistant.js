
(() => {
  const style = document.createElement('style');
  style.textContent = `
    #car-assistant-launcher {
      position:fixed;bottom:24px;left:24px;z-index:80;
      border:0;border-radius:15px;padding:14px 19px;
      background:linear-gradient(135deg,#3867f5,#15b8c9);
      color:white;font:700 13px inherit;cursor:pointer;
      box-shadow:0 9px 28px #3867f544;
    }
    #car-assistant-launcher i { margin-left:8px }
    #car-assistant-overlay {
      position:fixed;inset:0;background:#071020aa;
      z-index:200;display:none;align-items:center;
      justify-content:center;padding:16px;
      backdrop-filter:blur(5px);
    }
    #car-assistant-modal {
      width:min(650px,100%);max-height:90vh;overflow:auto;
      background:var(--panel,#fff);color:var(--text,#172033);
      border:1px solid var(--line,#e5eaf2);border-radius:22px;
      padding:25px;box-shadow:0 25px 80px #0004;
    }
    .ca-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .ca-head h2{font-size:21px;margin:0 0 7px}
    .ca-muted{color:var(--muted);font-size:12px;line-height:1.8}
    .ca-close{border:1px solid var(--line);background:var(--panel2);
      color:var(--text);border-radius:10px;width:36px;height:36px;cursor:pointer}
    .ca-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}
    .ca-field{display:flex;flex-direction:column;gap:7px}
    .ca-field label{font-size:12px;font-weight:700;color:var(--muted)}
    .ca-field input,.ca-field select{
      width:100%;padding:12px;border:1px solid var(--line);
      border-radius:10px;background:var(--panel2);color:var(--text);
      font:inherit;font-size:13px;
    }
    .ca-wide{grid-column:1/-1}
    .ca-submit{width:100%;margin-top:20px;padding:13px;border:0;
      border-radius:11px;background:var(--blue);color:white;
      font:700 13px inherit;cursor:pointer}
    .ca-submit:disabled{opacity:.6;cursor:wait}
    .ca-results{margin-top:22px}
    .ca-result{border:1px solid var(--line);border-radius:14px;
      padding:15px;margin-top:11px;background:var(--panel)}
    .ca-result.ca-best{border-color:var(--blue);box-shadow:0 0 0 2px #3867f51a}
    .ca-result-top{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .ca-result h3{font-size:15px;margin:7px 0}
    .ca-score{font-size:21px;font-weight:800;color:var(--green)}
    .ca-progress{height:7px;background:var(--panel2);border-radius:9px;overflow:hidden;margin:10px 0}
    .ca-progress span{display:block;height:100%;background:linear-gradient(90deg,#3867f5,#15b8c9)}
    .ca-reasons{font-size:12px;color:var(--muted);line-height:2;margin-top:8px}
    .ca-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .ca-actions button{border:1px solid var(--line);border-radius:9px;
      padding:9px 12px;background:var(--panel2);color:var(--text);
      font:600 11px inherit;cursor:pointer}
    .ca-error{font-size:12px;color:var(--red);margin-top:12px}
    @media(max-width:560px){
      #car-assistant-launcher{bottom:14px;left:14px}
      #car-assistant-modal{padding:18px}
      .ca-fields{grid-template-columns:1fr}
      .ca-wide{grid-column:auto}
    }
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.id = 'car-assistant-launcher';
  launcher.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ساعدني أختار سيارتي';
  launcher.onclick = () => window.openCarAssistant();
  document.body.appendChild(launcher);

  const overlay = document.createElement('div');
  overlay.id = 'car-assistant-overlay';
  overlay.innerHTML = `
    <div id="car-assistant-modal" role="dialog" aria-modal="true">
      <div class="ca-head">
        <div>
          <div style="font-size:11px;color:var(--blue);font-weight:700;margin-bottom:7px">SMART CAR ASSISTANT</div>
          <h2>خلّنا نختار سيارتك معاً</h2>
          <div class="ca-muted">جاوب عن الأسئلة التالية، وسنحلل السيارات الموجودة في قاعدة بيانات المنصة.</div>
        </div>
        <button class="ca-close" type="button" aria-label="إغلاق" onclick="window.closeCarAssistant()">✕</button>
      </div>

      <form id="ca-form">
        <div class="ca-fields">
          <div class="ca-field">
            <label for="ca-budget">1. كم ميزانيتك القصوى؟</label>
            <input id="ca-budget" type="number" min="10000" step="5000" value="130000" required>
          </div>
          <div class="ca-field">
            <label for="ca-family">2. كم عدد أفراد الأسرة؟</label>
            <select id="ca-family">
              <option value="2">1–2 أفراد</option>
              <option value="4" selected>3–4 أفراد</option>
              <option value="5">5 أفراد</option>
              <option value="7">6–7 أفراد</option>
              <option value="8">8 أفراد أو أكثر</option>
            </select>
          </div>
          <div class="ca-field">
            <label for="ca-km">3. كم تقطع سنوياً؟ (كم)</label>
            <input id="ca-km" type="number" min="1000" value="20000" required>
          </div>
          <div class="ca-field">
            <label for="ca-use">4. ما طبيعة استخدامك؟</label>
            <select id="ca-use">
              <option value="daily">استخدام يومي</option>
              <option value="family">عائلي</option>
              <option value="travel">سفر وطرق سريعة</option>
              <option value="offroad">طرق وعرة</option>
              <option value="mixed">متعدد الاستخدامات</option>
            </select>
          </div>
          <div class="ca-field ca-wide">
            <label for="ca-fuel">5. هل تفضل نوع وقود معيناً؟</label>
            <select id="ca-fuel">
              <option value="all">لا يوجد تفضيل</option>
              <option value="بنزين">بنزين</option>
              <option value="ديزل">ديزل</option>
              <option value="هجين">هجين</option>
              <option value="كهربائي">كهربائي</option>
            </select>
          </div>
        </div>
        <button class="ca-submit" id="ca-submit" type="submit">
          <i class="fa-solid fa-wand-magic-sparkles"></i> حلّل احتياجاتي واختر لي
        </button>
        <div id="ca-error" class="ca-error" role="alert"></div>
      </form>
      <div id="ca-results" class="ca-results" style="display:none"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) window.closeCarAssistant();
  });

  window.openCarAssistant = () => {
    overlay.style.display = 'flex';
    document.getElementById('ca-error').textContent = '';
  };

  window.closeCarAssistant = () => {
    overlay.style.display = 'none';
  };

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  document.getElementById('ca-form').addEventListener('submit', async e => {
    e.preventDefault();

    const budget = Number(document.getElementById('ca-budget').value);
    const annualKm = Number(document.getElementById('ca-km').value);
    const error = document.getElementById('ca-error');
    const submit = document.getElementById('ca-submit');
    const results = document.getElementById('ca-results');

    error.textContent = '';
    results.style.display = 'none';

    if (budget < 10000 || annualKm < 1000) {
      error.textContent = 'تأكد من إدخال ميزانية ومسافة سنوية صحيحتين.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'جاري تحليل احتياجاتك...';

    try {
      const payload = {
        budget,
        family_size: Number(document.getElementById('ca-family').value),
        annual_km: annualKm,
        use_case: document.getElementById('ca-use').value,
        fuel_preference: document.getElementById('ca-fuel').value
      };

      const response = await fetch('/api/decision/analyze', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إكمال التحليل');

      const cars = data.topCars || [];
      if (!cars.length) throw new Error('لم نجد سيارات مناسبة لهذه المعايير. جرّب زيادة الميزانية.');

      results.innerHTML = `
        <h3 class="section-title">هذه أفضل السيارات لاحتياجاتك</h3>
        <p class="ca-muted">الترتيب مبني على نتيجة محرك التوصية في النظام.</p>
        ${cars.slice(0,3).map((car,index) => `
          <article class="ca-result ${index===0?'ca-best':''}">
            <div class="ca-result-top">
              <span class="tag">${index===0?'أفضل ترشيح':'الترتيب '+(index+1)}</span>
              <span class="ca-score">${escapeHTML(car.matchPercentage)}%</span>
            </div>
            <h3>${escapeHTML(car.name)}</h3>
            <div class="ca-muted">${escapeHTML(Number(car.price||0).toLocaleString('en-US'))} ر.س · ${escapeHTML(car.fuel_type)} · ${escapeHTML(car.seats)} مقاعد</div>
            <div class="ca-progress"><span style="width:${Math.max(0,Math.min(100,Number(car.matchPercentage)||0))}%"></span></div>
            <div class="ca-reasons">
              ${(car.reasons||[]).map(reason=>'✓ '+escapeHTML(reason)).join('<br>') || 'تم ترشيح السيارة وفق نتيجة التقييم.'}
            </div>
          </article>
        `).join('')}
        <div class="ca-actions">
          <button type="button" id="ca-compare">قارن أفضل سيارتين</button>
          <button type="button" id="ca-again">تعديل إجاباتي</button>
        </div>
        <p class="ca-muted" style="margin-top:12px">ملاحظة: نسبة التوافق نتيجة نموذج التقييم والبيانات المتاحة، وليست ضماناً لجودة السيارة أو ملاءمتها الفعلية.</p>
      `;
      results.style.display = 'block';

      document.getElementById('ca-compare').onclick = () => {
        if (cars.length < 2) {
          error.textContent = 'نحتاج سيارتين على الأقل لإنشاء مقارنة.';
          return;
        }
        const first = document.getElementById('comp-1');
        const second = document.getElementById('comp-2');
        first.value = String(cars[0].id);
        second.value = String(cars[1].id);
        window.closeCarAssistant();
        if (typeof window.switchTab === 'function') {
          window.switchTab('compare');
          window.renderComparison();
        }
      };

      document.getElementById('ca-again').onclick = () => {
        results.style.display = 'none';
        document.getElementById('ca-form').scrollIntoView({behavior:'smooth'});
      };

      results.scrollIntoView({behavior:'smooth',block:'start'});
    } catch (err) {
      error.textContent = err.message || 'حدث خطأ غير متوقع.';
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> حلّل احتياجاتي واختر لي';
    }
  });
})();
