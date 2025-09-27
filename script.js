// script.js — تحديث إصلاح جلب سعر الأونصة (مع مصادر احتياطية + عكس القيمة عند الحاجة)

// --- أسماء العملات الشائعة مع علم/اسم (تبقى نفس الخريطة لديك) ---
const currencyNames = {
  "USD": "🇺🇸 الدولار الأمريكي",
  "EUR": "🇪🇺 اليورو",
  "GBP": "🇬🇧 الجنيه الإسترليني",
  "EGP": "🇪🇬 الجنيه المصري",
  "SAR": "🇸🇦 الريال السعودي",
  "AED": "🇦🇪 الدرهم الإماراتي",
  "KWD": "🇰🇼 الدينار الكويتي",
  "QAR": "🇶🇦 الريال القطري",
  "BHD": "🇧🇭 الدينار البحريني",
  "OMR": "🇴🇲 الريال العماني",
  "JPY": "🇯🇵 الين الياباني",
  "CNY": "🇨🇳 اليوان الصيني",
  "INR": "🇮🇳 الروبية الهندية",
  "TRY": "🇹🇷 الليرة التركية"
};

// --- مساعدة: عنصر الحالة (يُنشأ لو لم يكن موجوداً) ---
function ensureStatusElement() {
  let s = document.getElementById('status');
  if (!s) {
    s = document.createElement('div');
    s.id = 'status';
    s.style.cssText = 'text-align:center;color:#333;margin:10px 0;font-size:14px;';
    const container = document.querySelector('.container');
    container.insertBefore(s, container.firstChild.nextSibling);
  }
  return s;
}
const statusEl = ensureStatusElement();
function setStatus(text) { statusEl.textContent = text; }

// --- fetch مع مهلة ---
async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// --- جلب سعر الأونصة من عدة مصادر موثوقة وتجهيز القيمة --- 
async function fetchGoldPrice() {
  const sources = [
    // Metals-API (مطلوب access_key صالح؛ الـ demo قد لا يعمل دائماً)
    { url: "https://metals-api.com/api/latest?access_key=demo&base=USD&symbols=XAU", name: "Metals-API" },

    // goldprice.org endpoint (يستعمله كثيرون لعرض الاسعار)
    { url: "https://data-asg.goldprice.org/dbXRates/USD", name: "GoldPrice (data-asg)" },

    // metals.live public endpoint
    { url: "https://api.metals.live/v1/spot/gold", name: "Metals.live" }
  ];

  setStatus('جارٍ محاولة جلب سعر الأونصة من الإنترنت...');
  for (const src of sources) {
    try {
      const res = await fetchWithTimeout(src.url, 8000);
      if (!res.ok) {
        console.warn(`مصدر ${src.name} أعاد حالة ${res.status}`);
        continue;
      }
      const data = await res.json();
      // --- التعامل مع استجابة Metals-API ---
      if (src.name === "Metals-API") {
        // لاحظ: بعض الاستجابات تحتوي على { success:false, error:{...} }
        if (data.success === false) {
          console.warn('Metals-API returned error', data.error);
        } else if (data.rates && data.rates.XAU !== undefined) {
          let v = Number(data.rates.XAU);
          if (!isFinite(v) || v <= 0) { continue; }
          // إذا القيمة كبيرة (مثلاً > 50) فـ هي USD per XAU بالفعل
          // وإلا نعتبرها XAU per USD ونعكسها
          const usdPerOunce = (v > 50) ? v : (1 / v);
          setStatus(`تم جلب سعر الأونصة من ${src.name}`);
          return usdPerOunce;
        }
      }

      // --- التعامل مع data-asg.goldprice.org ---
      if (src.name === "GoldPrice (data-asg)") {
        if (data && data.items && data.items.length) {
          const item = data.items[0];
          if (item && (item.xauPrice || item.auPrice)) {
            const p = Number(item.xauPrice || item.auPrice);
            if (isFinite(p) && p > 0) {
              setStatus(`تم جلب سعر الأونصة من ${src.name}`);
              return p;
            }
          }
        }
      }

      // --- التعامل مع metals.live (غالباً مصفوفة أو رقم) ---
      if (src.name === "Metals.live") {
        if (Array.isArray(data) && data.length) {
          const first = data[0];
          if (typeof first === 'number' && first > 0) {
            setStatus(`تم جلب سعر الأونصة من ${src.name}`);
            return Number(first);
          } else if (first && (first.price || first.ask || first.bid)) {
            const p = Number(first.price || first.ask || first.bid);
            if (isFinite(p) && p > 0) {
              setStatus(`تم جلب سعر الأونصة من ${src.name}`);
              return p;
            }
          }
        } else if (typeof data === 'number' && data > 0) {
          setStatus(`تم جلب سعر الأونصة من ${src.name}`);
          return Number(data);
        }
      }
    } catch (err) {
      console.warn(`فشل الوصول إلى ${src.name}:`, err && err.message ? err.message : err);
      // تابع للمصدر التالي
    }
  }

  // لم ننجح في أي مصدر
  setStatus('تعذر جلب سعر الأونصة تلقائياً من المصادر المتاحة.');
  return null;
}

// --- جلب سعر الصرف USD -> العملة المطلوبة ---
async function fetchExchangeRate(currencyCode) {
  try {
    const res = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD", 8000);
    if (!res.ok) throw new Error('رد غير سليم من مزوّد الصرف');
    const data = await res.json();
    if (data && data.rates && data.rates[currencyCode]) return Number(data.rates[currencyCode]);
    // إن لم يوجد الرمز، نعيد 1 (تعامل احتياطي)
    return 1;
  } catch (err) {
    console.warn('خطأ في جلب سعر الصرف:', err);
    return 1;
  }
}

// --- تحميل قائمة العملات وملئ الاختيار (مع اسم/علم إن وجد) ---
async function loadCurrencies() {
  try {
    const res = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD", 8000);
    if (!res.ok) throw new Error('فشل تحميل قائمة العملات');
    const data = await res.json();
    const select = document.getElementById("currency");
    select.innerHTML = "";
    const currencies = Object.keys(data.rates).sort();
    currencies.forEach(code => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = currencyNames[code] ? `${code} - ${currencyNames[code]}` : code;
      select.appendChild(option);
    });
    select.value = 'EGP';
  } catch (err) {
    console.warn('loadCurrencies failed:', err);
    // كن احتياطياً: أضف بعض الخيارات الشائعة إن فشل التحميل
    const select = document.getElementById("currency");
    if (select.options.length === 0) {
      ['EGP','USD','EUR','SAR','AED','GBP'].forEach(code => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = currencyNames[code] ? `${code} - ${currencyNames[code]}` : code;
        select.appendChild(option);
      });
      select.value = 'EGP';
    }
  }
}

// --- تنسيق الأرقام --- 
function fmtNum(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- حساب وعرض الأسعار ---
async function calculateGold(currencyCode = 'EGP') {
  setStatus('جارٍ الحساب ...');
  let usdPerOunce = await fetchGoldPrice();

  // لو فشلنا نطلب من المستخدم إدخال السعر يدوياً كحل مؤقت
  if (!usdPerOunce) {
    const manual = prompt('فشل جلب سعر الأونصة تلقائياً.\nأدخل سعر الأونصة بالدولار الأمريكي (USD) يدوياً، أو اضغط إلغاء:');
    if (!manual) {
      setStatus('تم إلغاء العملية — لا يوجد سعر للأونصة.');
      return;
    }
    const parsed = Number(String(manual).replace(/,/g, ''));
    if (!isFinite(parsed) || parsed <= 0) {
      alert('قيمة غير صالحة. الرجاء إدخال رقم صالح مثل 1950.50');
      setStatus('لم يتم إدخال قيمة صحيحة.');
      return;
    }
    usdPerOunce = parsed;
    setStatus('تم استخدام القيمة المدخلة يدوياً لحساب الأسعار.');
  }

  // جلب سعر الصرف USD -> العملة المحلية
  const usdToLocal = await fetchExchangeRate(currencyCode);

  // حساب جرام بالدولار (الأونصة = 31.1 غرام تقريبياً)
  const gramUsd = usdPerOunce / 31.1;
  const gramLocal = gramUsd * usdToLocal;

  // عرض النتائج
  document.getElementById("price24").innerText = `عيار 24: ${fmtNum(gramLocal)} ${currencyCode}`;
  document.getElementById("price21").innerText = `عيار 21: ${fmtNum(gramLocal * (21/24))} ${currencyCode}`;
  document.getElementById("price18").innerText = `عيار 18: ${fmtNum(gramLocal * (18/24))} ${currencyCode}`;

  setStatus(`تم الحساب — سعر الأونصة ~ ${fmtNum(usdPerOunce)} USD — تحويل USD → ${currencyCode} = ${usdToLocal}`);
}

// --- ربط الأحداث ---
document.getElementById("recalculate").addEventListener("click", () => {
  const cur = document.getElementById("currency").value;
  calculateGold(cur);
});
document.getElementById("home").addEventListener("click", () => {
  // إعادة تحميل الصفحة كصفحة رئيسية للتطبيق
  window.location.href = "index.html";
});

// --- تهيئة أولية ---
loadCurrencies().then(() => calculateGold('EGP'));