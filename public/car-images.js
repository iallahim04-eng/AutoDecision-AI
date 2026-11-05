(() => {
  'use strict';

  // لا نعرض صورة إلا إذا احتوى اسم ملف الصورة على اسم الموديل المطابق.
  // عند غياب تطابق واضح نُبقي العنصر بصورة افتراضية بدلاً من عرض سيارة خاطئة.
  const brandNames = {
    'تويوتا':'Toyota','هيونداي':'Hyundai','كيا':'Kia','فورد':'Ford',
    'لكزس':'Lexus','شانجان':'Changan','جيلي':'Geely','هافال':'Haval',
    'GAC':'GAC','نيسان':'Nissan','شفروليه':'Chevrolet','جمس':'GMC',
    'هوندا':'Honda','مازدا':'Mazda','MG':'MG','Tank':'Tank',
    'ميتسوبيشي':'Mitsubishi','سوزوكي':'Suzuki','سوبارو':'Subaru',
    'BYD':'BYD','جيتور':'Jetour','جينيسيس':'Genesis','BMW':'BMW',
    'مرسيدس':'Mercedes-Benz','رينو':'Renault'
  };

  const modelNames = [
    ['جراند هايلاندر','Grand Highlander'],['لاندكروزر','Land Cruiser'],
    ['راف فور','RAV4'],['فورتشنر','Fortuner'],['هايلكس','Hilux'],
    ['أفالون','Avalon'],['كامري','Camry'],['كورولا','Corolla'],
    ['بريوس','Prius'],['يارس','Yaris'],
    ['سانتا في','Santa Fe'],['باليسايد','Palisade'],['أكسنت','Accent'],
    ['النترا','Elantra'],['سوناتا','Sonata'],['توسان','Tucson'],
    ['ستاريا','Staria'],['كريتا','Creta'],['كونا','Kona'],
    ['تيلورايد','Telluride'],['سورينتو','Sorento'],['سبورتاج','Sportage'],
    ['سيراتو','Cerato'],['بيجاس','Pegas'],['سونيت','Sonet'],
    ['K8','K8'],['K5','K5'],
    ['إكسبيديشن','Expedition'],['إكسبلورر','Explorer'],['موستانج','Mustang'],
    ['برونكو','Bronco'],['رينجر','Ranger'],['تورس','Taurus'],
    ['ES 300h','ES 300h'],['RX 350h','RX 350h'],['LX 600','LX 600'],
    ['IS 350','IS 350'],['NX 350','NX 350'],
    ['يوني-ك','UNI-K'],['CS95','CS95'],['CS75 بلس','CS75 Plus'],['إيدو','Eado'],
    ['مونجارو','Monjaro'],['كولراي','Coolray'],['توجيلا','Tugella'],
    ['إمجراند','Emgrand'],['جوليان','Jolion'],['دارجو','Dargo'],
    ['GS8','GS8'],['GS3','GS3'],['إمباو','Empow'],
    ['إكس تريل','X-Trail'],['ألتيما','Altima'],['باترول','Patrol'],
    ['صني','Sunny'],['كيكس','Kicks'],
    ['سيلفرادو','Silverado'],['كابتيفا','Captiva'],['تاهو','Tahoe'],
    ['يوكون','Yukon'],['سييرا','Sierra'],
    ['CR-V','CR-V'],['بايلوت','Pilot'],['سيفيك','Civic'],['أكورد','Accord'],
    ['CX-90','CX-90'],['CX-5','CX-5'],['مازدا 6','Mazda 6'],['مازدا 3','Mazda 3'],
    ['إم جي 5','MG 5'],['RX5','RX5'],['300','300'],['500','500'],
    ['أتراج','Attrage'],['أوتلاندر','Outlander'],['جيمني','Jimny'],
    ['ديزاير','Dzire'],['فورستر','Forester'],
    ['سونج بلس','Song Plus'],['سيل 7','Seal 7'],['جيتور T2','T2'],
    ['G70','G70'],['320i','320i'],['C200','C200'],['داستر','Duster']
  ];

  const cache = new Map();
  const pending = new Set();

  const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function getSearchInfo(card) {
    const name = card.dataset.carName || '';
    const brand = card.dataset.carBrand || '';
    const brandEn = brandNames[brand] || brand;
    const found = modelNames.find(([ar]) => name.toLowerCase().includes(ar.toLowerCase()));
    if (!found) return null;
    const modelEn = found[1];
    return { query: brandEn + ' ' + modelEn, model: modelEn, brand: brandEn };
  }

  function exactModelMatch(title, info) {
    const t = norm(title);
    const tokens = norm(info.model).split(' ').filter(Boolean);
    if (!tokens.length || !tokens.every(token => t.split(' ').includes(token))) return false;
    // للأرقام القصيرة نطلب ظهور اسم الشركة أيضاً لتجنب نتائج عامة أو موديلات مختلفة.
    if (tokens.every(token => /^\d+$/.test(token)) || tokens.join('').length <= 2) {
      return t.includes(norm(info.brand));
    }
    return true;
  }

  function showFallback(card) {
    const holder = card.querySelector('.car-photo');
    if (!holder || holder.querySelector('img')) return;
    holder.innerHTML = '<div class="car-photo-placeholder"><i class="fa-solid fa-car-side" aria-hidden="true"></i><span>لا تتوفر صورة مطابقة حالياً</span></div>';
  }

  async function findImage(info) {
    const key = info.query;
    if (cache.has(key)) return cache.get(key);
    const endpoint = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch='
      + encodeURIComponent(info.query) + '&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=800&format=json&origin=*';
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Image search unavailable');
      const data = await response.json();
      const pages = Object.values(data.query?.pages || {});
      const match = pages.find(page => {
        const infoItem = page.imageinfo?.[0];
        return infoItem && /^image\/(jpeg|png|webp)$/i.test(infoItem.mime || '')
          && exactModelMatch(page.title || '', info);
      });
      if (!match) { cache.set(key, null); return null; }
      const item = match.imageinfo[0];
      const result = {
        url: item.thumburl || item.url,
        title: match.title || '',
        credit: clean(item.extmetadata?.Artist?.value || item.extmetadata?.Credit?.value || ''),
        license: clean(item.extmetadata?.LicenseShortName?.value || 'Wikimedia Commons')
      };
      if (!/^https:\/\//i.test(result.url || '')) return null;
      cache.set(key, result);
      return result;
    } catch (_) {
      cache.set(key, null);
      return null;
    }
  }

  async function decorate(card) {
    if (pending.has(card) || card.dataset.imageChecked === '1') return;
    pending.add(card);
    const info = getSearchInfo(card);
    if (!info) {
      showFallback(card);
      card.dataset.imageChecked = '1';
      pending.delete(card);
      return;
    }
    const result = await findImage(info);
    const holder = card.querySelector('.car-photo');
    if (result && holder && card.isConnected) {
      const img = document.createElement('img');
      img.src = result.url;
      img.alt = 'صورة ' + (card.dataset.carName || 'السيارة');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => showFallback(card);
      holder.replaceChildren(img);
      if (result.credit || result.license) {
        const credit = document.createElement('small');
        credit.className = 'car-photo-credit';
        credit.textContent = [result.credit, result.license].filter(Boolean).join(' · ');
        holder.appendChild(credit);
      }
    } else {
      showFallback(card);
    }
    card.dataset.imageChecked = '1';
    pending.delete(card);
  }

  function observeCards() {
    const root = document.getElementById('cars-grid');
    if (!root) return;
    const cards = root.querySelectorAll('.car-card[data-car-name]');
    if (!('IntersectionObserver' in window)) {
      cards.forEach(decorate);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          decorate(entry.target);
        }
      });
    }, { rootMargin: '250px' });
    cards.forEach(card => observer.observe(card));
  }

  const style = document.createElement('style');
  style.textContent = `
    .car-photo{height:178px;width:100%;overflow:hidden;border-radius:12px;background:var(--panel2);position:relative;display:grid;place-items:center}
    .car-photo img{width:100%;height:100%;object-fit:contain;background:var(--panel2);display:block}
    .car-photo-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:var(--muted);font-size:11px;text-align:center;padding:12px}
    .car-photo-placeholder i{font-size:38px;opacity:.55}
    .car-photo-credit{position:absolute;bottom:0;right:0;left:0;padding:5px 8px;background:#101828b8;color:#fff;font-size:9px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.appendChild(style);

  const root = document.getElementById('cars-grid');
  if (root) {
    new MutationObserver(observeCards).observe(root, { childList: true });
    observeCards();
  }
})();