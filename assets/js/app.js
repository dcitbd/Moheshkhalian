
// Safe API Wrapper: Uses live PHP api.php on web host, seamlessly falls back to MK_SEED if PHP is inactive
let MK_PHP_ALIVE = null;
async function apiCall(queryStr, opts = {}) {
  if (MK_PHP_ALIVE !== false) {
    try {
      const res = await fetch(`${API}?${queryStr}`, opts);
      const txt = (await res.text()).replace(/^\uFEFF/, '').trim();
      if (!txt.startsWith('<') && (txt.startsWith('{') || txt.startsWith('['))) {
        MK_PHP_ALIVE = true;
        return JSON.parse(txt);
      } else {
        MK_PHP_ALIVE = false;
      }
    } catch (e) {
      MK_PHP_ALIVE = false;
    }
  }
  return mkLocalFallback(queryStr, opts);
}

function mkLocalFallback(queryStr, opts = {}) {
  const db = window.MK_SEED || { settings:{}, profiles:[], posts:[], quizzes:[], quiz_submissions:[], administration:[], notices:[], comments:[], reports:[] };
  const params = new URLSearchParams(queryStr.replace(/^action=/, 'action='));
  const action = params.get('action') || queryStr.split('&')[0].replace('action=', '');
  let body = {};
  if (opts.body && typeof opts.body === 'string') {
    try { body = JSON.parse(opts.body); } catch(e) {}
  }

  if (action === 'bootstrap') {
    const apProfs = db.profiles.filter(p => p.status === 'approved');
    const counts = {
      profiles: apProfs.length,
      future: db.posts.filter(p => p.category === 'future' && p.status === 'approved').length,
      news: db.posts.filter(p => p.category === 'news' && p.status === 'approved').length,
      poems: db.posts.filter(p => p.category === 'poem' && p.status === 'approved').length,
      quizzes: db.quizzes.filter(q => q.status === 'active').length,
      admins: db.administration.length
    };
    const notifs = db.notices.slice(0, 3).map(n => ({ id:'n_'+n.id, type:'notice', title:n.title, body:n.body, time:n.created_at }));
    return { ok: true, settings: db.settings, notices: db.notices, counts, notifications: notifs };
  }
  if (action === 'profiles') {
    const q = (params.get('q') || '').toLowerCase();
    const batch = params.get('batch') || 'all';
    const edu = (params.get('education') || '').toLowerCase();
    const prof = (params.get('profession') || '').toLowerCase();
    let list = db.profiles.filter(p => p.status === 'approved');
    if (batch !== 'all' && batch !== '') list = list.filter(p => String(p.ssc_batch) === String(batch));
    if (edu) list = list.filter(p => (p.education || '').toLowerCase().includes(edu));
    if (prof) list = list.filter(p => (p.profession || '').toLowerCase().includes(prof));
    if (q) list = list.filter(p => [p.name, p.current_address, p.permanent_address, p.profession, p.education, p.future_dream].some(v => (v||'').toLowerCase().includes(q)));
    const bMap = {};
    db.profiles.filter(p => p.status === 'approved').forEach(p => { bMap[p.ssc_batch] = (bMap[p.ssc_batch] || 0) + 1; });
    const batch_counts = Object.keys(bMap).sort((a,b)=>b-a).map(k => ({ ssc_batch: k, cnt: bMap[k] }));
    return { ok: true, profiles: list, batch_counts };
  }
  if (action === 'profile_detail') {
    const id = parseInt(params.get('id'));
    const p = db.profiles.find(x => x.id === id);
    if (!p) return { ok: false, error: 'প্রোফাইল পাওয়া যায়নি' };
    const comments = db.comments.filter(c => c.target_type === 'profile' && c.target_id === id);
    return { ok: true, profile: { ...p, comments } };
  }
  if (action === 'like_profile') {
    const p = db.profiles.find(x => x.id === parseInt(body.id));
    if (p) { p.likes = (p.likes || 0) + 1; return { ok: true, likes: p.likes }; }
    return { ok: true, likes: 1 };
  }
  if (action === 'posts') {
    const cat = params.get('category') || 'all';
    const q = (params.get('q') || '').toLowerCase();
    const tag = (params.get('tag') || '').toLowerCase();
    let list = db.posts.filter(p => p.status === 'approved');
    if (cat !== 'all' && cat !== '') list = list.filter(p => p.category === cat);
    if (tag) list = list.filter(p => (p.tag || '').toLowerCase().includes(tag));
    if (q) list = list.filter(p => (p.title + ' ' + p.content + ' ' + p.author_name).toLowerCase().includes(q));
    return { ok: true, posts: list };
  }
  if (action === 'post_detail') {
    const id = parseInt(params.get('id'));
    const p = db.posts.find(x => x.id === id);
    if (!p) return { ok: false };
    p.views = (p.views || 0) + 1;
    const comments = db.comments.filter(c => c.target_type === 'post' && c.target_id === id);
    return { ok: true, post: { ...p, comments } };
  }
  if (action === 'like_post') {
    const p = db.posts.find(x => x.id === parseInt(body.id));
    if (p) { p.likes = (p.likes || 0) + 1; return { ok: true, likes: p.likes }; }
    return { ok: true, likes: 1 };
  }
  if (action === 'comment') {
    db.comments.unshift({ id: Date.now(), target_type: body.target_type, target_id: parseInt(body.target_id), author_name: body.author_name || 'অতিথি', comment_text: body.comment_text });
    return { ok: true };
  }
  if (action === 'quizzes') {
    return { ok: true, quizzes: db.quizzes.filter(q => q.status === 'active'), published_results: db.quiz_submissions.filter(s => s.result_published) };
  }
  if (action === 'administration') {
    return { ok: true, members: db.administration };
  }
  if (action === 'submit_profile') {
    db.profiles.unshift({ id: Date.now(), ...body, likes:0, comments_count:0, quiz_results:[], status:'pending' });
    return { ok: true, message: 'আপনার প্রোফাইল সফলভাবে জমা হয়েছে! এডমিন অনুমোদনের পর প্রকাশিত হবে।' };
  }
  if (action === 'submit_post') {
    db.posts.unshift({ id: Date.now(), ...body, likes:0, views:0, comments_count:0, status:'pending' });
    return { ok: true, message: 'আপনার লেখাটি সফলভাবে জমা হয়েছে! এডমিন অনুমোদনের পর প্রকাশিত হবে।' };
  }
  if (action === 'submit_quiz') {
    return { ok: true, auto_score: 'জমা হয়েছে', message: 'আপনার উত্তর সফলভাবে জমা হয়েছে!' };
  }
  if (action === 'submit_report') {
    return { ok: true, message: 'আপনার বার্তা/রিপোর্ট সফলভাবে পাঠানো হয়েছে।' };
  }
  if (action === 'subscribe') {
    return { ok: true, message: 'ধন্যবাদ! আপনি সফলভাবে সাবস্ক্রাইব করেছেন।' };
  }
  return { ok: true };
}

/**
 * মহেশখালীয়ান (Maheshkhalian) Frontend Application
 */
const API = 'api.php';
let STATE = {
  page: 'home',
  settings: {},
  notices: [],
  counts: {},
  notifications: [],
  profiles: [],
  batchCounts: [],
  postsViewMode: 'grid', // 'grid' or 'list'
  deferredPrompt: null
};

// PWA Install Handler
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  STATE.deferredPrompt = e;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function triggerPwaInstall() {
  if (STATE.deferredPrompt) {
    STATE.deferredPrompt.prompt();
    STATE.deferredPrompt.userChoice.then(() => { STATE.deferredPrompt = null; });
  } else {
    openModal(`
      <h2 style="margin-bottom:10px;"><i class="fa-solid fa-mobile-screen-button" style="color:var(--primary)"></i> অ্যাপ ইনস্টল পদ্ধতি</h2>
      <p style="color:var(--muted); margin-bottom:12px;">আপনার মোবাইল বা কম্পিউটারে <strong>মহেশখালীয়ান</strong> অ্যাপ হিসেবে ইনস্টল করতে নিচের ধাপ অনুসরণ করুন:</p>
      <ul style="padding-left:20px; line-height:1.9;">
        <li><strong>Android (Chrome):</strong> ব্রাউজারের ডান কোণায় ⋮ মেনু থেকে <em>"Install App"</em> বা <em>"Add to Home screen"</em> চাপুন।</li>
        <li><strong>iPhone (Safari):</strong> নিচের Share আইকনে চাপ দিয়ে <em>"Add to Home Screen"</em> নির্বাচন করুন।</li>
        <li><strong>Desktop (Chrome/Edge):</strong> অ্যাড্রেস বারের ডান পাশে ইনস্টল আইকনে ক্লিক করুন।</li>
      </ul>
    `);
  }
}

function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('আপনার ব্রাউজার নোটিফিকেশন সাপোর্ট করে না');
    return;
  }
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') {
      showToast('নোটিফিকেশন চালু হয়েছে!');
      new Notification('মহেশখালীয়ান (Maheshkhalian)', {
        body: 'এখন থেকে নতুন নিউজ, নোটিশ ও কুইজ রেজাল্টের আপডেট পাবেন!',
        icon: 'assets/images/logo.png'
      });
    } else {
      showToast('নোটিফিকেশন অনুমতি দেওয়া হয়নি');
    }
  });
}

// Toast & Dropdowns
function showToast(msg) {
  const el = document.getElementById('toastBox');
  el.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#2ce6b5"></i> <span>${escapeHtml(msg)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function toggleDropdown(id) {
  const target = document.getElementById(id);
  const wasOpen = target.classList.contains('open');
  closeDropdowns();
  if (!wasOpen) target.classList.add('open');
}
function closeDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('open'));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-actions')) closeDropdowns();
});

function openModal(html) {
  document.getElementById('mainModalContent').innerHTML = html;
  document.getElementById('mainModal').classList.add('open');
}
function closeModal() {
  document.getElementById('mainModal').classList.remove('open');
}


function buildYearOptions(selected = '', placeholder = 'এসএসসি ব্যাচ (১৯৭১–বর্তমান)') {
  const cy = new Date().getFullYear();
  let html = `<option value="">${placeholder}</option>`;
  for (let y = cy; y >= 1971; y--) {
    html += `<option value="${y}" ${String(selected) === String(y) ? 'selected' : ''}>SSC ${y}</option>`;
  }
  return html;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bootstrap Initial Data
async function initApp() {
  try {
    const data = await apiCall('action=bootstrap');
    if (data.ok) {
      STATE.settings = data.settings || {};
      STATE.notices = data.notices || [];
      STATE.counts = data.counts || {};
      STATE.notifications = data.notifications || [];
      applySettings();
      renderNotifications();
    }
  } catch (e) {
    console.error(e);
  }
  setTimeout(() => {
    document.getElementById('preloader').classList.add('hide');
  }, 850);

  // Check page attributes, query params & URL hash for direct multi-page routing
  const urlParams = new URLSearchParams(window.location.search);
  const initPage = document.body.getAttribute('data-initial-page') || '';
  const initYear = document.body.getAttribute('data-batch-year') || urlParams.get('year') || '';
  const postIdParam = urlParams.get('id') || '';
  const hash = window.location.hash.replace('#', '');

  if (initPage === 'post_detail' && postIdParam) {
    openPostDetail(postIdParam);
  } else if (hash.startsWith('post/')) {
    openPostDetail(hash.split('/')[1]);
  } else if (initPage) {
    STATE.initialBatchYear = initYear;
    navigate(initPage, true);
  } else if (['profiles','future','news','poems','quizzes','administration','contact','ssc_batches','about','privacy','terms','advertise','notices'].includes(hash)) {
    navigate(hash);
  } else {
    navigate('home');
  }
}

function applySettings() {
  const s = STATE.settings;
  if (s.site_name_bn) {
    document.getElementById('navSiteName').textContent = s.site_name_bn;
    document.getElementById('loaderTitle').textContent = `${s.site_name_bn} / ${s.site_name_en || 'Maheshkhalian'}`;
  }
  if (s.slogan) {
    document.getElementById('loaderSlogan').textContent = s.slogan;
    document.getElementById('navSlogan').textContent = s.slogan;
  }
  if (s.logo_url) {
    document.getElementById('loaderLogo').src = s.logo_url;
    document.getElementById('navLogo').src = s.logo_url;
  }
  if (s.footer_text) {
    document.getElementById('footerText').textContent = s.footer_text;
  }
  if (STATE.notices.length > 0) {
    document.getElementById('tickerText').textContent = STATE.notices.map(n => `★ ${n.title}: ${n.body}`).join('   •   ');
  }
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  document.getElementById('notifCount').textContent = STATE.notifications.length;
  if (STATE.notifications.length === 0) {
    list.innerHTML = '<div style="padding:14px; text-align:center; color:var(--muted);">কোনো নতুন নোটিফিকেশন নেই</div>';
    return;
  }
  list.innerHTML = STATE.notifications.map(n => `
    <div style="padding:10px 14px; border-bottom:1px solid var(--border); cursor:pointer;"
         onclick="${n.post_id ? `openPostDetail(${n.post_id})` : `navigate('home')`}; closeDropdowns();">
      <div style="font-weight:700; font-size:0.88rem; color:var(--navy);">${escapeHtml(n.title)}</div>
      <div style="font-size:0.8rem; color:var(--muted);">${escapeHtml(n.body)}</div>
    </div>
  `).join('');
}

// Navigation Router
function navigate(page, skipHash = false) {
  STATE.page = page;
  if (!skipHash) window.location.hash = page === 'home' ? '' : page;
  document.querySelectorAll('.nav-link, .mob-nav-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-page') === page);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (page === 'home') renderHome();
  else if (page === 'profiles') renderProfilesPage(STATE.initialBatchYear || '');
  else if (page === 'ssc_batches') renderAllBatchesDirectory();
  else if (page === 'future') renderPostsPage('future', 'ফিউচার বাংলাদেশ ও মহেশখালী', 'fa-lightbulb');
  else if (page === 'news') renderPostsPage('news', 'ব্রেকিং নিউজ', 'fa-newspaper');
  else if (page === 'poems') renderPostsPage('poem', 'কবিতা ও অভিজ্ঞতা', 'fa-feather-pointed');
  else if (page === 'quizzes') renderQuizzesPage();
  else if (page === 'administration') renderAdministrationPage();
  else if (page === 'contact') renderContactPage();
  else if (page === 'about') renderInfoPage('আমাদের সম্পর্কে — সাগর কন্যা মহেশখালী', STATE.settings.about_text || 'মহেশখালী বাংলাদেশের একমাত্র পাহাড়ী দ্বীপ এবং প্রথম ডিজিটাল দ্বীপ। ১৯৭১ থেকে বর্তমান পর্যন্ত মহেশখালীর সকল প্রজন্মকে একত্রিত করার প্ল্যাটফর্ম হলো মহেশখালীয়ান।');
  else if (page === 'privacy') renderInfoPage('প্রাইভেসি পলিসি', STATE.settings.privacy_text || '');
  else if (page === 'terms') renderInfoPage('শর্তাবলি ও নীতিমালা', STATE.settings.terms_text || '');
  else if (page === 'advertise') renderInfoPage('বিজ্ঞাপন ও সহযোগিতা', STATE.settings.advertise_text || '');
  else if (page === 'notices') renderNoticesBoardPage();
  else if (page === 'install') { renderHome(); setTimeout(() => triggerPwaInstall(), 250); }
  else if (page === 'submit_profile') { renderProfilesPage(); setTimeout(() => openProfileSubmitModal(), 250); }
  else if (page === 'submit_future') { renderPostsPage('future', 'ফিউচার বাংলাদেশ ও মহেশখালী', 'fa-lightbulb'); setTimeout(() => openPostSubmitModal('future'), 250); }
  else if (page === 'submit_news') { renderPostsPage('news', 'ব্রেকিং নিউজ', 'fa-newspaper'); setTimeout(() => openPostSubmitModal('news'), 250); }
  else if (page === 'submit_poem') { renderPostsPage('poem', 'কবিতা ও অভিজ্ঞতা', 'fa-feather-pointed'); setTimeout(() => openPostSubmitModal('poem'), 250); }
  else if (page === 'report') { renderContactPage(); setTimeout(() => openReportModal(), 250); }
}

// ==========================================
// HOME PAGE
// ==========================================

let HERO_BANNER_IDX = 0;
let HERO_BANNER_TIMER = null;
function setHeroBanner(idx) {
  const banners = [STATE.settings.banner_url || 'assets/images/banner1.png', STATE.settings.banner2_url || 'assets/images/banner2.png'];
  HERO_BANNER_IDX = idx % banners.length;
  const img = document.getElementById('heroSlideImg');
  if (img) {
    img.style.opacity = '0.25';
    setTimeout(() => { img.src = banners[HERO_BANNER_IDX]; img.style.opacity = '1'; }, 180);
  }
}
function startHeroBannerSlider() {
  if (HERO_BANNER_TIMER) clearInterval(HERO_BANNER_TIMER);
  HERO_BANNER_TIMER = setInterval(() => {
    if (document.getElementById('heroSlideImg')) setHeroBanner(HERO_BANNER_IDX + 1);
  }, 4500);
}

async function renderHome() {
  const c = STATE.counts;
  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <section class="hero-card">
      <div class="hero-grid">
        <div>
          <div class="hero-tag"><i class="fa-solid fa-sparkles"></i> বাংলাদেশের একমাত্র পাহাড়ী দ্বীপ • সাগর কন্যা মহেশখালী</div>
          <h2 class="hero-title">${escapeHtml(STATE.settings.site_name_bn || 'মহেশখালীয়ান')} — দ্বীপের সকল প্রজন্মের ডিজিটাল মিলনমেলা</h2>
          <p class="hero-sub">${escapeHtml(STATE.settings.about_text || '')}</p>
          <div class="hero-btns">
            <button class="btn btn-accent" onclick="openProfileSubmitModal()"><i class="fa-solid fa-user-plus"></i> আপনার প্রোফাইল যুক্ত করুন</button>
            <button class="btn btn-ghost-white" onclick="navigate('profiles')"><i class="fa-solid fa-users"></i> সকল প্রোফাইল দেখুন</button>
          </div>
        </div>
        <div style="position:relative; border-radius:16px; overflow:hidden; border:2px solid rgba(255,255,255,0.24); height:235px; box-shadow:0 12px 28px rgba(0,0,0,0.25);">
          <img id="heroSlideImg" src="${escapeHtml(STATE.settings.banner_url || 'assets/images/banner1.png')}" alt="মহেশখালীয়ান ব্যানার" style="width:100%; height:100%; object-fit:cover; transition:opacity 0.6s ease;">
          <div style="position:absolute; bottom:10px; right:10px; display:flex; gap:6px;">
            <button type="button" onclick="setHeroBanner(0)" style="width:10px; height:10px; border-radius:50%; border:none; background:#fff; cursor:pointer; opacity:0.9;"></button>
            <button type="button" onclick="setHeroBanner(1)" style="width:10px; height:10px; border-radius:50%; border:none; background:#fff; cursor:pointer; opacity:0.6;"></button>
          </div>
        </div>
      </div>
    </section>

    <section class="counters-grid">
      <div class="counter-card" onclick="navigate('profiles')">
        <div class="counter-icon"><i class="fa-solid fa-users"></i></div>
        <div class="counter-num">${c.profiles || 0}+</div>
        <div class="counter-label">নিবন্ধিত প্রোফাইল</div>
      </div>
      <div class="counter-card" onclick="navigate('future')">
        <div class="counter-icon"><i class="fa-solid fa-lightbulb"></i></div>
        <div class="counter-num">${c.future || 0}</div>
        <div class="counter-label">ফিউচার বাংলাদেশ</div>
      </div>
      <div class="counter-card" onclick="navigate('news')">
        <div class="counter-icon"><i class="fa-solid fa-newspaper"></i></div>
        <div class="counter-num">${c.news || 0}</div>
        <div class="counter-label">ব্রেকিং নিউজ</div>
      </div>
      <div class="counter-card" onclick="navigate('poems')">
        <div class="counter-icon"><i class="fa-solid fa-feather-pointed"></i></div>
        <div class="counter-num">${c.poems || 0}</div>
        <div class="counter-label">কবিতা ও অভিজ্ঞতা</div>
      </div>
      <div class="counter-card" onclick="navigate('quizzes')">
        <div class="counter-icon"><i class="fa-solid fa-award"></i></div>
        <div class="counter-num">${c.quizzes || 0}</div>
        <div class="counter-label">চলমান কুইজ</div>
      </div>
      <div class="counter-card" onclick="navigate('administration')">
        <div class="counter-icon"><i class="fa-solid fa-user-tie"></i></div>
        <div class="counter-num">${c.admins || 0}</div>
        <div class="counter-label">প্রশাসন ও পরিচালক</div>
      </div>
    </section>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-star"></i> সাম্প্রতিক মহেশখালীয়ান প্রোফাইল</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('profiles')">সব প্রোফাইল <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homeProfilesGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-lightbulb"></i> ফিউচার বাংলাদেশ ও মহেশখালী</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('future')">সব লেখা <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homeFutureGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-newspaper"></i> ব্রেকিং নিউজ</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('news')">সব নিউজ <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homeNewsGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-feather-pointed"></i> কবিতা ও অভিজ্ঞতা</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('poems')">সব কবিতা <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homePoemsGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-trophy"></i> চলমান কুইজ ও প্রতিযোগিতা</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('quizzes')">অংশগ্রহণ করুন <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homeQuizzesGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <div class="home-section-block">
      <div class="section-header">
        <h3 class="section-title"><i class="fa-solid fa-user-tie"></i> প্রশাসন ও পরিচালনা পর্ষদ</h3>
        <button class="btn btn-outline btn-sm" onclick="navigate('administration')">সব দেখুন <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="cards-grid" id="homeAdminGrid"><p>লোড হচ্ছে...</p></div>
    </div>

    <section class="home-connect-grid">
      <div class="connect-card" style="background:linear-gradient(135deg, #072822, #0b5c4b); color:#fff; border:none;">
        <h3 style="font-size:1.35rem; margin-bottom:8px;"><i class="fa-solid fa-envelope-open-text" style="color:#ffd27d"></i> সাবস্ক্রাইব করুন</h3>
        <p style="color:#cce3dd; font-size:0.94rem; margin-bottom:16px;">মহেশখালীর ব্রেকিং নিউজ, নতুন নোটিশ এবং কুইজ প্রতিযোগিতার আপডেট সবার আগে ইমেইলে পেতে সাবস্ক্রাইব করুন।</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input type="email" id="homeSubEmail" class="form-control" placeholder="আপনার ইমেইল ঠিকানা দিন..." style="flex:1; min-width:190px;">
          <button class="btn btn-accent" onclick="submitHomeSubscribe()"><i class="fa-solid fa-paper-plane"></i> সাবস্ক্রাইব</button>
        </div>
      </div>

      <div class="connect-card">
        <h3 style="font-size:1.3rem; color:var(--navy); margin-bottom:10px;"><i class="fa-solid fa-headset" style="color:var(--primary)"></i> সরাসরি যোগাযোগ / মতামত দিন</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <input type="text" id="homeCntName" class="form-control" placeholder="আপনার নাম *">
          <input type="text" id="homeCntContact" class="form-control" placeholder="মোবাইল বা ইমেইল">
          <textarea id="homeCntMsg" class="form-control" rows="2" placeholder="আপনার বার্তা বা পরামর্শ লিখুন... *" style="grid-column:1/-1;"></textarea>
          <button class="btn btn-primary" style="grid-column:1/-1;" onclick="submitHomeContact()"><i class="fa-solid fa-paper-plane"></i> বার্তা পাঠান</button>
        </div>
      </div>
    </section>
  `;

  startHeroBannerSlider();
  const [pRes, fRes, nRes, poRes, qRes, aRes] = await Promise.all([
    apiCall(`action=profiles`),
    apiCall(`action=posts&category=future`),
    apiCall(`action=posts&category=news`),
    apiCall(`action=posts&category=poem`),
    apiCall(`action=quizzes`),
    apiCall(`action=administration`)
  ]);

  if (pRes.ok) document.getElementById('homeProfilesGrid').innerHTML = pRes.profiles.slice(0, 3).map(renderProfileCardHtml).join('');
  if (fRes.ok) document.getElementById('homeFutureGrid').innerHTML = fRes.posts.slice(0, 3).map(renderPostCardHtml).join('');
  if (nRes.ok) document.getElementById('homeNewsGrid').innerHTML = nRes.posts.slice(0, 3).map(renderPostCardHtml).join('');
  if (poRes.ok) document.getElementById('homePoemsGrid').innerHTML = poRes.posts.slice(0, 3).map(renderPostCardHtml).join('');
  if (qRes.ok) {
    document.getElementById('homeQuizzesGrid').innerHTML = qRes.quizzes.slice(0, 3).map(q => `
      <div class="post-card" style="padding:18px;">
        <span class="batch-badge" style="position:static; background:var(--primary-light); color:var(--primary-dark); align-self:flex-start;">${escapeHtml(q.category)}</span>
        <h3 style="margin:10px 0 6px; color:var(--navy);">${escapeHtml(q.title)}</h3>
        <p style="font-size:0.9rem; color:var(--muted); margin-bottom:12px;">${escapeHtml(q.description)}</p>
        <button class="btn btn-primary btn-sm" onclick='openTakeQuizModal(${JSON.stringify(q).replace(/'/g, "&#39;")})'>কুইজে অংশ নিন</button>
      </div>
    `).join('') || '<p>কোনো চলমান কুইজ নেই।</p>';
  }
  if (aRes.ok) {
    document.getElementById('homeAdminGrid').innerHTML = aRes.members.slice(0, 3).map(m => `
      <article class="profile-card" onclick='openAdminMemberDetail(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
        <div class="profile-top" style="background:linear-gradient(135deg, #0a2239, #0b7a62);">
          <span class="batch-badge">${escapeHtml(m.department || 'প্রশাসন')}</span>
        </div>
        <div class="profile-avatar-wrap"><img src="${escapeHtml(m.photo || 'assets/images/logo.png')}" onerror="this.src='assets/images/logo.png'"></div>
        <div class="profile-body">
          <div class="profile-name">${escapeHtml(m.name)}</div>
          <div class="profile-prof">${escapeHtml(m.role_title)}</div>
          <div class="profile-meta">${escapeHtml(m.bio)}</div>
        </div>
      </article>
    `).join('');
  }
}

// ==========================================
// PROFILES PAGE (1971 - CURRENT)
// ==========================================
async function renderProfilesPage(initialYear = '') {
  const root = document.getElementById('appRoot');
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1971; y--) years.push(y);

  root.innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-users"></i> ১৯৭১ থেকে বর্তমান মহেশখালীয়ান প্রোফাইল</h2>
      <button class="btn btn-primary" onclick="openProfileSubmitModal()"><i class="fa-solid fa-user-plus"></i> আপনার প্রোফাইল যুক্ত করুন</button>
    </div>

    <div class="batch-pills" id="batchPills">
      <button class="batch-pill active" onclick="filterBatch('all', this)">সকল ব্যাচ (<span id="totalProfileCounter">0</span>)</button>
    </div>

    <div class="filter-panel">
      <input type="text" id="profSearch" class="form-control" placeholder="নাম, ঠিকানা বা স্বপ্ন দিয়ে খুঁজুন..." oninput="loadProfiles()">
      <select id="profBatchFilter" class="form-control" onchange="loadProfiles()">
        <option value="all">সকল এসএসসি সাল</option>
        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
      </select>
      <input type="text" id="profEduFilter" class="form-control" placeholder="শিক্ষাগত যোগ্যতা (যেমন: বিএসসি/অনার্স)" oninput="loadProfiles()">
      <input type="text" id="profJobFilter" class="form-control" placeholder="পেশা (যেমন: ছাত্র/ইঞ্জিনিয়ার)" oninput="loadProfiles()">
      <button class="btn btn-outline" onclick="resetProfileFilters()"><i class="fa-solid fa-rotate-left"></i></button>
    </div>

    <div class="cards-grid" id="profilesGrid"><p>প্রোফাইল লোড হচ্ছে...</p></div>
  `;

  if (initialYear) {
    const sel = document.getElementById('profBatchFilter');
    if (sel) sel.value = initialYear;
  }
  await loadProfiles(true);
}

function filterBatch(batch, btn) {
  document.querySelectorAll('.batch-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('profBatchFilter').value = batch;
  loadProfiles();
}

function resetProfileFilters() {
  document.getElementById('profSearch').value = '';
  document.getElementById('profBatchFilter').value = 'all';
  document.getElementById('profEduFilter').value = '';
  document.getElementById('profJobFilter').value = '';
  loadProfiles();
}

async function loadProfiles(buildPills = false) {
  const q = encodeURIComponent(document.getElementById('profSearch')?.value || '');
  const batch = encodeURIComponent(document.getElementById('profBatchFilter')?.value || 'all');
  const edu = encodeURIComponent(document.getElementById('profEduFilter')?.value || '');
  const prof = encodeURIComponent(document.getElementById('profJobFilter')?.value || '');

  const res = await apiCall(`action=profiles&q=${q}&batch=${batch}&education=${edu}&profession=${prof}`);
  if (!res.ok) return;

  STATE.profiles = res.profiles;
  if (buildPills && res.batch_counts) {
    const total = res.batch_counts.reduce((acc, b) => acc + parseInt(b.cnt), 0);
    const pillsEl = document.getElementById('batchPills');
    pillsEl.innerHTML = `<button class="batch-pill active" onclick="filterBatch('all', this)">সকল ব্যাচ (${total})</button>` +
      res.batch_counts.map(b => `<button class="batch-pill" onclick="filterBatch('${escapeHtml(b.ssc_batch)}', this)">SSC ${escapeHtml(b.ssc_batch)} (${b.cnt})</button>`).join('');
  }

  const grid = document.getElementById('profilesGrid');
  if (res.profiles.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; background:var(--surface); border-radius:16px;">কোনো প্রোফাইল পাওয়া যায়নি।</div>';
    return;
  }
  grid.innerHTML = res.profiles.map(renderProfileCardHtml).join('');
}

function renderProfileCardHtml(p) {
  const photo = p.photo || 'assets/images/logo.png';
  const awardHtml = (p.quiz_results && p.quiz_results.length > 0)
    ? `<div class="quiz-award-pill"><i class="fa-solid fa-trophy"></i> ${escapeHtml(p.quiz_results[0].rank_title || p.quiz_results[0].score)}</div>`
    : '';
  return `
    <article class="profile-card" onclick="openProfilePopup(${p.id})">
      <div class="profile-top">
        ${p.blood_group ? `<span class="blood-badge">${escapeHtml(p.blood_group)}</span>` : ''}
        <span class="batch-badge">SSC ${escapeHtml(p.ssc_batch || 'N/A')}</span>
      </div>
      <div class="profile-avatar-wrap">
        <img src="${escapeHtml(photo)}" alt="${escapeHtml(p.name)}" onerror="this.src='assets/images/logo.png'">
      </div>
      <div class="profile-body">
        <div class="profile-name">${escapeHtml(p.name)}</div>
        <div class="profile-prof">${escapeHtml(p.profession || 'মহেশখালীয়ান')}</div>
        <div class="profile-meta"><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(p.education || '')}</div>
        <div class="profile-meta"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(p.permanent_address || p.current_address || 'মহেশখালী')}</div>
        ${awardHtml}
        <div class="profile-footer">
          <span><i class="fa-solid fa-heart" style="color:#e11d48"></i> ${p.likes || 0}</span>
          <span><i class="fa-solid fa-comment"></i> ${p.comments_count || 0}</span>
          <span style="color:var(--primary); font-weight:700;">বিস্তারিত <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
        </div>
      </div>
    </article>
  `;
}

// Animated Profile Popup Modal
async function openProfilePopup(id) {
  openModal('<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--primary)"></i></div>');
  const res = await apiCall(`action=profile_detail&id=${id}`);
  if (!res.ok) { closeModal(); return; }
  const p = res.profile;
  const socials = p.social_links || [];
  const iconMap = {
    facebook: 'fa-brands fa-facebook', youtube: 'fa-brands fa-youtube', linkedin: 'fa-brands fa-linkedin',
    instagram: 'fa-brands fa-instagram', twitter: 'fa-brands fa-x-twitter', github: 'fa-brands fa-github',
    whatsapp: 'fa-brands fa-whatsapp', tiktok: 'fa-brands fa-tiktok', website: 'fa-solid fa-globe'
  };

  const resultsHtml = (p.quiz_results && p.quiz_results.length > 0) ? `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:12px; margin-top:14px;">
      <strong style="color:#92400e;"><i class="fa-solid fa-trophy"></i> কুইজ ও প্রতিযোগিতার ফলাফল:</strong>
      ${p.quiz_results.map(r => `<div style="margin-top:6px; font-size:0.9rem;">• <strong>${escapeHtml(r.quiz_title)}:</strong> ${escapeHtml(r.rank_title)} (${escapeHtml(r.score)})</div>`).join('')}
    </div>
  ` : '';

  openModal(`
    <div style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--border);">
      <img src="${escapeHtml(p.photo || 'assets/images/logo.png')}" style="width:110px; height:110px; border-radius:50%; object-fit:cover; border:4px solid var(--primary); box-shadow:0 8px 20px rgba(0,0,0,0.15);" onerror="this.src='assets/images/logo.png'">
      <h2 style="margin-top:10px; color:var(--navy);">${escapeHtml(p.name)}</h2>
      <div style="color:var(--primary); font-weight:700;">${escapeHtml(p.profession)} • SSC ব্যাচ ${escapeHtml(p.ssc_batch)}</div>
      ${p.blood_group ? `<span style="display:inline-block; margin-top:6px; background:#fee2e2; color:#b91c1c; padding:2px 10px; border-radius:99px; font-weight:700; font-size:0.84rem;">রক্তের গ্রুপ: ${escapeHtml(p.blood_group)}</span>` : ''}
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; font-size:0.92rem;">
      <div><strong><i class="fa-solid fa-graduation-cap"></i> শিক্ষাগত যোগ্যতা:</strong><br>${escapeHtml(p.education || '-')}</div>
      <div><strong><i class="fa-solid fa-phone"></i> মোবাইল:</strong><br>${escapeHtml(p.mobile || 'গোপন')}</div>
      <div><strong><i class="fa-solid fa-location-dot"></i> বর্তমান ঠিকানা:</strong><br>${escapeHtml(p.current_address || '-')}</div>
      <div><strong><i class="fa-solid fa-house"></i> স্থায়ী ঠিকানা:</strong><br>${escapeHtml(p.permanent_address || '-')}</div>
      <div style="grid-column:1/-1;"><strong><i class="fa-solid fa-envelope"></i> ইমেইল:</strong> ${escapeHtml(p.email || '-')}</div>
    </div>

    <div style="background:var(--surface-alt); border-left:4px solid var(--primary); padding:12px 14px; border-radius:10px; margin-top:14px;">
      <strong style="color:var(--primary-dark);">মহেশখালী নিয়ে ভবিষ্যৎ চিন্তা ও স্বপ্নঃ</strong>
      <p style="margin-top:4px; font-size:0.94rem;">${escapeHtml(p.future_dream || 'মহেশখালীর উন্নয়ন ও সমৃদ্ধি।')}</p>
    </div>

    ${resultsHtml}

    <div style="margin-top:14px;">
      <strong>সোস্যাল মিডিয়া লিংক:</strong>
      <div class="social-links-row">
        ${socials.length > 0 ? socials.map(s => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="social-chip"><i class="${iconMap[s.platform] || 'fa-solid fa-link'}"></i> ${escapeHtml(s.platform)}</a>`).join('') : '<span style="color:var(--muted); font-size:0.88rem;">কোনো লিংক যুক্ত করা হয়নি</span>'}
      </div>
    </div>

    <div style="display:flex; gap:10px; margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
      <button class="btn btn-primary btn-sm" onclick="likeProfile(${p.id}, this)"><i class="fa-solid fa-heart"></i> লাইক (<span>${p.likes || 0}</span>)</button>
      <button class="btn btn-outline btn-sm" onclick="shareUrl('${escapeHtml(p.name)} — মহেশখালীয়ান', window.location.href)"><i class="fa-solid fa-share-nodes"></i> শেয়ার</button>
    </div>

    <div style="margin-top:18px;">
      <h4 style="margin-bottom:8px;">মন্তব্য (${(p.comments || []).length})</h4>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <input type="text" id="profCommName" class="form-control" placeholder="আপনার নাম" style="max-width:160px;">
        <input type="text" id="profCommText" class="form-control" placeholder="মন্তব্য লিখুন...">
        <button class="btn btn-primary btn-sm" onclick="submitComment('profile', ${p.id})">পাঠান</button>
      </div>
      <div id="profCommentsList">
        ${(p.comments || []).map(c => `<div style="padding:8px 10px; background:#f8fbfa; border-radius:8px; margin-bottom:6px; font-size:0.88rem;"><strong>${escapeHtml(c.author_name)}:</strong> ${escapeHtml(c.comment_text)}</div>`).join('')}
      </div>
    </div>
  `);
}

async function likeProfile(id, btn) {
  const res = await apiCall(`action=like_profile`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id}) });
  if (res.ok) btn.querySelector('span').textContent = res.likes;
}

// ==========================================
// POSTS PAGES (FUTURE BANGLADESH, NEWS, POEMS)
// ==========================================
async function renderPostsPage(category, title, icon) {
  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid ${icon}"></i> ${title} (<span id="postDigitalCounter">0</span>)</h2>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline btn-sm" onclick="togglePostsView('grid')"><i class="fa-solid fa-grip"></i> কার্ড</button>
        <button class="btn btn-outline btn-sm" onclick="togglePostsView('list')"><i class="fa-solid fa-list"></i> লিস্ট</button>
        <button class="btn btn-primary btn-sm" onclick="openPostSubmitModal('${category}')"><i class="fa-solid fa-pen-to-square"></i> লিখুন</button>
      </div>
    </div>

    <div class="filter-panel" style="grid-template-columns: 2fr 1fr auto;">
      <input type="text" id="postSearch" class="form-control" placeholder="শিরোনাম, বিষয় বা লেখকের নাম খুঁজুন..." oninput="loadPosts('${category}')">
      <input type="text" id="postTagFilter" class="form-control" placeholder="ক্যাটাগরি/ট্যাগ..." oninput="loadPosts('${category}')">
      <button class="btn btn-outline" onclick="document.getElementById('postSearch').value=''; document.getElementById('postTagFilter').value=''; loadPosts('${category}')"><i class="fa-solid fa-rotate-left"></i></button>
    </div>

    <div class="cards-grid ${STATE.postsViewMode === 'list' ? 'list-view' : ''}" id="postsGrid"><p>লোড হচ্ছে...</p></div>
  `;
  loadPosts(category);
}

function togglePostsView(mode) {
  STATE.postsViewMode = mode;
  const g = document.getElementById('postsGrid');
  if (g) g.classList.toggle('list-view', mode === 'list');
}

async function loadPosts(category) {
  const q = encodeURIComponent(document.getElementById('postSearch')?.value || '');
  const tag = encodeURIComponent(document.getElementById('postTagFilter')?.value || '');
  const res = await apiCall(`action=posts&category=${category}&q=${q}&tag=${tag}`);
  if (!res.ok) return;

  const counterEl = document.getElementById('postDigitalCounter');
  if (counterEl) counterEl.textContent = res.posts.length;

  const grid = document.getElementById('postsGrid');
  if (res.posts.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; background:var(--surface); border-radius:16px;">কোনো লেখা পাওয়া যায়নি।</div>';
    return;
  }
  grid.innerHTML = res.posts.map(renderPostCardHtml).join('');
}

function renderPostCardHtml(p) {
  const img = p.image || 'assets/images/banner2.png';
  return `
    <article class="post-card">
      <div class="post-thumb" onclick="openPostDetail(${p.id})" style="cursor:pointer;">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" onerror="this.src='assets/images/banner2.png'">
        <span class="post-tag">${escapeHtml(p.tag || p.category)}</span>
      </div>
      <div class="post-body">
        <div class="post-title" onclick="openPostDetail(${p.id})">${escapeHtml(p.title)}</div>
        <div style="font-size:0.82rem; color:var(--primary); font-weight:600; margin-bottom:6px;">
          <i class="fa-solid fa-user-pen"></i> ${escapeHtml(p.author_name)} ${p.author_batch ? `(SSC ${escapeHtml(p.author_batch)})` : ''}
        </div>
        <div class="post-excerpt">${escapeHtml(p.content)}</div>
        <div class="post-actions">
          <div style="display:flex; gap:12px; font-size:0.84rem; color:var(--muted);">
            <span><i class="fa-solid fa-heart" style="color:#e11d48"></i> ${p.likes || 0}</span>
            <span><i class="fa-solid fa-comment"></i> ${p.comments_count || 0}</span>
            <span><i class="fa-solid fa-eye"></i> ${p.views || 0}</span>
          </div>
          <button class="btn btn-outline btn-sm" onclick="openPostDetail(${p.id})">বিস্তারিত পড়ুন</button>
        </div>
      </div>
    </article>
  `;
}

// Customer View Details Page
async function openPostDetail(id) {
  window.location.hash = `post/${id}`;
  const root = document.getElementById('appRoot');
  root.innerHTML = '<div style="text-align:center; padding:60px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>';
  const res = await apiCall(`action=post_detail&id=${id}`);
  if (!res.ok) { navigate('home'); return; }
  const p = res.post;

  root.innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="navigate('${p.category === 'poem' ? 'poems' : p.category}')" style="margin-bottom:14px;">
      <i class="fa-solid fa-arrow-left"></i> ফিরে যান
    </button>
    <article style="background:var(--surface); border-radius:20px; border:1px solid var(--border); overflow:hidden; box-shadow:var(--shadow-md);">
      ${p.image ? `<img src="${escapeHtml(p.image)}" style="width:100%; max-height:380px; object-fit:cover;">` : ''}
      <div style="padding:24px;">
        <span class="batch-badge" style="position:static; background:var(--primary-light); color:var(--primary-dark);">${escapeHtml(p.tag || p.category)}</span>
        <h1 style="margin:10px 0; font-size:1.75rem; color:var(--navy);">${escapeHtml(p.title)}</h1>
        <div style="color:var(--muted); font-size:0.9rem; margin-bottom:18px;">
          লেখক: <strong>${escapeHtml(p.author_name)}</strong> ${p.author_batch ? `• SSC ${escapeHtml(p.author_batch)}` : ''} • দেখা হয়েছে: ${p.views} বার
        </div>
        <div style="white-space:pre-line; font-size:1.05rem; line-height:1.85; color:var(--ink);">${escapeHtml(p.content)}</div>

        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:24px; padding-top:16px; border-top:1px solid var(--border);">
          <button class="btn btn-primary btn-sm" onclick="likePost(${p.id}, this)"><i class="fa-solid fa-heart"></i> লাইক (<span>${p.likes || 0}</span>)</button>
          <button class="btn btn-outline btn-sm" onclick="shareUrl('${escapeHtml(p.title)}', window.location.href)"><i class="fa-solid fa-share-nodes"></i> শেয়ার করুন</button>
        </div>

        <div style="margin-top:24px;">
          <h3 style="margin-bottom:10px;">মন্তব্যসমূহ (${(p.comments || []).length})</h3>
          <div style="display:flex; gap:8px; margin-bottom:14px;">
            <input type="text" id="postCommName" class="form-control" placeholder="আপনার নাম" style="max-width:180px;">
            <input type="text" id="postCommText" class="form-control" placeholder="আপনার মন্তব্য লিখুন...">
            <button class="btn btn-primary btn-sm" onclick="submitComment('post', ${p.id})">পাঠান</button>
          </div>
          <div id="postCommentsList">
            ${(p.comments || []).map(c => `<div style="padding:10px 14px; background:#f6faf9; border-radius:10px; margin-bottom:8px;"><strong>${escapeHtml(c.author_name)}:</strong> ${escapeHtml(c.comment_text)}</div>`).join('')}
          </div>
        </div>
      </div>
    </article>
  `;
}

async function likePost(id, btn) {
  const res = await apiCall(`action=like_post`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) });
  if (res.ok) btn.querySelector('span').textContent = res.likes;
}

async function submitComment(type, targetId) {
  const nameEl = document.getElementById(type === 'profile' ? 'profCommName' : 'postCommName');
  const textEl = document.getElementById(type === 'profile' ? 'profCommText' : 'postCommText');
  const author_name = nameEl.value.trim() || 'অতিথি';
  const comment_text = textEl.value.trim();
  if (!comment_text) return showToast('মন্তব্য লিখুন');

  const res = await apiCall(`action=comment`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ target_type: type, target_id: targetId, author_name, comment_text })
  });

  if (res.ok) {
    textEl.value = '';
    showToast('মন্তব্য যুক্ত হয়েছে!');
    if (type === 'profile') openProfilePopup(targetId);
    else openPostDetail(targetId);
  }
}

function shareUrl(title, url) {
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
    showToast('লিংক কপি হয়েছে!');
  }
}

// ==========================================
// QUIZZES & COMPETITIONS PAGE
// ==========================================
async function renderQuizzesPage() {
  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-trophy"></i> কুইজ, পরীক্ষা ও প্রতিযোগিতা</h2>
    </div>
    <div class="cards-grid" id="quizzesGrid"><p>লোড হচ্ছে...</p></div>
    <h3 class="section-title" style="margin-top:32px; margin-bottom:14px;"><i class="fa-solid fa-medal"></i> প্রকাশিত ফলাফল তালিকা</h3>
    <div id="quizResultsList" style="background:var(--surface); border-radius:16px; border:1px solid var(--border); padding:16px;">লোড হচ্ছে...</div>
  `;

  const res = await apiCall(`action=quizzes`);
  if (!res.ok) return;

  document.getElementById('quizzesGrid').innerHTML = res.quizzes.map(q => `
    <div class="post-card" style="padding:18px;">
      <span class="batch-badge" style="position:static; background:var(--primary-light); color:var(--primary-dark); align-self:flex-start;">${escapeHtml(q.category)}</span>
      <h3 style="margin:10px 0 6px; color:var(--navy);">${escapeHtml(q.title)}</h3>
      <p style="font-size:0.9rem; color:var(--muted); margin-bottom:12px;">${escapeHtml(q.description)}</p>
      <div style="font-size:0.84rem; color:var(--danger); margin-bottom:12px;"><i class="fa-regular fa-clock"></i> শেষ সময়: ${escapeHtml(q.deadline || 'চলমান')}</div>
      <button class="btn btn-primary" onclick='openTakeQuizModal(${JSON.stringify(q).replace(/'/g, "&#39;")})'>অংশগ্রহণ করুন</button>
    </div>
  `).join('') || '<p>কোনো চলমান কুইজ নেই।</p>';

  document.getElementById('quizResultsList').innerHTML = res.published_results.map(r => `
    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; padding:10px 0; border-bottom:1px solid var(--border);">
      <div><strong>${escapeHtml(r.participant_name)}</strong> ${r.ssc_batch ? `(SSC ${escapeHtml(r.ssc_batch)})` : ''} — <span style="color:var(--muted)">${escapeHtml(r.quiz_title)}</span></div>
      <div><span class="quiz-award-pill" style="margin:0;">${escapeHtml(r.rank_title || 'উত্তীর্ণ')} (${escapeHtml(r.score)})</span></div>
    </div>
  `).join('') || '<p style="color:var(--muted)">এখনো কোনো ফলাফল প্রকাশিত হয়নি।</p>';
}

function openTakeQuizModal(q) {
  const qs = q.questions || [];
  openModal(`
    <h2 style="margin-bottom:6px;">${escapeHtml(q.title)}</h2>
    <p style="color:var(--muted); font-size:0.9rem; margin-bottom:14px;">${escapeHtml(q.description)}</p>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px;">
      <input type="text" id="qzName" class="form-control" placeholder="আপনার পূর্ণ নাম *" required>
      <select id="qzBatch" class="form-control">${buildYearOptions("", "এসএসসি ব্যাচ নির্বাচন করুন")}</select>
      <input type="text" id="qzMobile" class="form-control" placeholder="মোবাইল নম্বর" style="grid-column:1/-1;">
    </div>
    <div id="qzQuestionsWrap">
      ${qs.map((item, idx) => `
        <div style="background:#f7fbfa; padding:12px; border-radius:10px; margin-bottom:10px; border:1px solid var(--border);">
          <strong>${idx+1}. ${escapeHtml(item.q)}</strong>
          <div style="margin-top:8px; display:grid; gap:6px;">
            ${(item.options || []).map((opt, oIdx) => `
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="radio" name="q_${idx}" value="${oIdx}"> ${escapeHtml(opt)}
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primary" style="width:100%;" onclick="submitQuizAnswers(${q.id}, ${qs.length})">উত্তর জমা দিন</button>
  `);
}

async function submitQuizAnswers(quizId, count) {
  const participant_name = document.getElementById('qzName').value.trim();
  const ssc_batch = document.getElementById('qzBatch').value.trim();
  const mobile = document.getElementById('qzMobile').value.trim();
  if (!participant_name) return showToast('আপনার নাম লিখুন');

  const answers = [];
  for (let i = 0; i < count; i++) {
    const checked = document.querySelector(`input[name="q_${i}"]:checked`);
    answers.push(checked ? parseInt(checked.value) : -1);
  }
  const res = await apiCall(`action=submit_quiz`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ quiz_id: quizId, participant_name, ssc_batch, mobile, answers })
  });
  if (res.ok) {
    closeModal();
    showToast(`${res.message} ${res.auto_score ? `(প্রাথমিক স্কোর: ${res.auto_score})` : ''}`);
  } else {
    showToast(res.error || 'সমস্যা হয়েছে');
  }
}

// ==========================================
// ADMINISTRATION & CONTACT US PAGES
// ==========================================
async function renderAdministrationPage() {
  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-user-tie"></i> মহেশখালীয়ান প্রশাসন ও পরিচালনা পর্ষদ</h2>
    </div>
    <div class="cards-grid" id="adminTeamGrid"><p>লোড হচ্ছে...</p></div>
  `;
  const res = await apiCall(`action=administration`);
  if (!res.ok) return;
  document.getElementById('adminTeamGrid').innerHTML = res.members.map(m => `
    <article class="profile-card" onclick='openAdminMemberDetail(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
      <div class="profile-top" style="background:linear-gradient(135deg, #0a2239, #0b7a62);">
        <span class="batch-badge">${escapeHtml(m.department || 'প্রশাসন')}</span>
      </div>
      <div class="profile-avatar-wrap">
        <img src="${escapeHtml(m.photo || 'assets/images/logo.png')}" onerror="this.src='assets/images/logo.png'">
      </div>
      <div class="profile-body">
        <div class="profile-name">${escapeHtml(m.name)}</div>
        <div class="profile-prof">${escapeHtml(m.role_title)}</div>
        <div class="profile-meta">${escapeHtml(m.bio)}</div>
        <div class="profile-footer">
          <span><i class="fa-solid fa-phone"></i> ${escapeHtml(m.mobile || '-')}</span>
          <span style="color:var(--primary); font-weight:700;">বিস্তারিত</span>
        </div>
      </div>
    </article>
  `).join('');
}

function openAdminMemberDetail(m) {
  openModal(`
    <div style="text-align:center;">
      <img src="${escapeHtml(m.photo || 'assets/images/logo.png')}" style="width:105px; height:105px; border-radius:50%; object-fit:cover; border:4px solid var(--primary);">
      <h2 style="margin-top:10px;">${escapeHtml(m.name)}</h2>
      <div style="color:var(--primary); font-weight:700;">${escapeHtml(m.role_title)} (${escapeHtml(m.department)})</div>
      <p style="margin-top:12px; color:var(--muted);">${escapeHtml(m.bio)}</p>
      <div style="margin-top:14px; font-size:0.94rem;">
        <div><strong>মোবাইল:</strong> ${escapeHtml(m.mobile || '-')}</div>
        <div><strong>ইমেইল:</strong> ${escapeHtml(m.email || '-')}</div>
      </div>
      <div class="social-links-row" style="justify-content:center; margin-top:14px;">
        ${(m.social_links || []).map(s => `<a href="${escapeHtml(s.url)}" target="_blank" class="social-chip">${escapeHtml(s.platform)}</a>`).join('')}
      </div>
    </div>
  `);
}

async function renderContactPage() {
  const root = document.getElementById('appRoot');
  const res = await apiCall(`action=administration`);
  const members = res.ok ? res.members : [];
  const s = STATE.settings;

  root.innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-address-book"></i> যোগাযোগ ও প্রশাসন</h2>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:20px;">
      <div style="background:var(--surface); padding:22px; border-radius:16px; border:1px solid var(--border);">
        <h3 style="margin-bottom:12px; color:var(--navy);">সরাসরি বার্তা বা অভিযোগ পাঠান</h3>
        <input type="text" id="cntName" class="form-control" placeholder="আপনার নাম *" style="margin-bottom:10px;">
        <input type="text" id="cntContact" class="form-control" placeholder="মোবাইল বা ইমেইল" style="margin-bottom:10px;">
        <input type="text" id="cntSub" class="form-control" placeholder="বিষয়" style="margin-bottom:10px;">
        <textarea id="cntMsg" class="form-control" rows="4" placeholder="আপনার বার্তা লিখুন..." style="margin-bottom:12px;"></textarea>
        <button class="btn btn-primary" style="width:100%;" onclick="sendReportFromContact()">বার্তা পাঠান</button>
      </div>

      <div style="background:var(--surface); padding:22px; border-radius:16px; border:1px solid var(--border);">
        <h3 style="margin-bottom:12px; color:var(--navy);">অফিসিয়াল যোগাযোগ ও প্রশাসন</h3>
        <p style="margin-bottom:8px;"><i class="fa-solid fa-location-dot" style="color:var(--primary)"></i> ${escapeHtml(s.contact_address || 'মহেশখালী, কক্সবাজার')}</p>
        <p style="margin-bottom:8px;"><i class="fa-solid fa-phone" style="color:var(--primary)"></i> ${escapeHtml(s.contact_phone || '')}</p>
        <p style="margin-bottom:16px;"><i class="fa-solid fa-envelope" style="color:var(--primary)"></i> ${escapeHtml(s.contact_email || '')}</p>
        <h4 style="margin-bottom:8px; border-top:1px solid var(--border); padding-top:12px;">প্রশাসন ও পরিচালকবৃন্দ:</h4>
        ${members.map(m => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);">
            <img src="${escapeHtml(m.photo || 'assets/images/logo.png')}" style="width:42px; height:42px; border-radius:50%; object-fit:cover;">
            <div>
              <div style="font-weight:700; font-size:0.94rem;">${escapeHtml(m.name)} <small style="color:var(--primary)">(${escapeHtml(m.role_title)})</small></div>
              <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(m.mobile)} • ${escapeHtml(m.email)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function sendReportFromContact() {
  const reporter_name = document.getElementById('cntName').value.trim();
  const reporter_contact = document.getElementById('cntContact').value.trim();
  const subject = document.getElementById('cntSub').value.trim() || 'যোগাযোগ বার্তা';
  const message = document.getElementById('cntMsg').value.trim();
  if (!reporter_name || !message) return showToast('নাম ও বার্তা দিন');

  const res = await apiCall(`action=submit_report`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ reporter_name, reporter_contact, subject, message })
  });
  if (res.ok) {
    showToast(res.message);
    document.getElementById('cntMsg').value = '';
  }
}

// ==========================================
// SUBMISSION MODALS (UPLOAD OR URL + PREVIEW)
// ==========================================
function bindImageInputPreview(fileInputId, urlInputId, previewId, folder) {
  const fileEl = document.getElementById(fileInputId);
  const urlEl = document.getElementById(urlInputId);
  const prevEl = document.getElementById(previewId);

  urlEl.addEventListener('input', () => {
    prevEl.innerHTML = urlEl.value.trim() ? `<img src="${escapeHtml(urlEl.value.trim())}">` : '<span style="color:var(--muted)">ছবির প্রিভিউ</span>';
  });

  fileEl.addEventListener('change', async () => {
    if (!fileEl.files[0]) return;
    const fd = new FormData();
    fd.append('file', fileEl.files[0]);
    fd.append('folder', folder);
    prevEl.innerHTML = '<span>আপলোড হচ্ছে...</span>';
    const res = await apiCall(`action=upload_image`, { method: 'POST', body: fd });
    if (res.ok) {
      urlEl.value = res.url;
      prevEl.innerHTML = `<img src="${escapeHtml(res.url)}">`;
      showToast('ছবি আপলোড সফল!');
    } else {
      prevEl.innerHTML = '<span style="color:red">আপলোড ব্যর্থ</span>';
    }
  });
}

function addSocialRow() {
  const wrap = document.getElementById('socialInputsWrap');
  const row = document.createElement('div');
  row.style.cssText = 'display:grid; grid-template-columns:1fr 2fr auto; gap:6px; margin-bottom:6px;';
  row.innerHTML = `
    <select class="form-control soc-plat">
      <option value="facebook">Facebook</option>
      <option value="youtube">YouTube</option>
      <option value="linkedin">LinkedIn</option>
      <option value="instagram">Instagram</option>
      <option value="twitter">Twitter/X</option>
      <option value="github">GitHub</option>
      <option value="whatsapp">WhatsApp</option>
      <option value="website">Website</option>
    </select>
    <input type="url" class="form-control soc-url" placeholder="https://...">
    <button type="button" class="btn btn-outline btn-sm" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
  `;
  wrap.appendChild(row);
}

function openProfileSubmitModal() {
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1971; y--) years.push(y);

  openModal(`
    <h2 style="margin-bottom:4px;"><i class="fa-solid fa-user-plus" style="color:var(--primary)"></i> আপনার প্রোফাইল যুক্ত করুন</h2>
    <p style="font-size:0.86rem; color:var(--muted); margin-bottom:14px;">জমা দেওয়ার পর এডমিন অনুমোদন করলে প্রোফাইলটি প্রকাশিত হবে।</p>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <input type="text" id="spName" class="form-control" placeholder="পূর্ণ নাম *" style="grid-column:1/-1;">
      <select id="spBatch" class="form-control">
        <option value="">এসএসসি ব্যাচ (সাল)</option>
        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
      </select>
      <select id="spBlood" class="form-control">
        <option value="">রক্তের গ্রুপ</option>
        <option>A+</option><option>A-</option><option>B+</option><option>B-</option>
        <option>O+</option><option>O-</option><option>AB+</option><option>AB-</option>
      </select>
      <input type="text" id="spEdu" class="form-control" placeholder="শিক্ষাগত যোগ্যতা">
      <input type="text" id="spProf" class="form-control" placeholder="পেশা">
      <input type="text" id="spCurrAddr" class="form-control" placeholder="বর্তমান ঠিকানা">
      <input type="text" id="spPermAddr" class="form-control" placeholder="স্থায়ী ঠিকানা (মহেশখালী)">
      <input type="text" id="spMobile" class="form-control" placeholder="মোবাইল নম্বর">
      <input type="email" id="spEmail" class="form-control" placeholder="ইমেইল">
      <textarea id="spDream" class="form-control" rows="3" placeholder="মহেশখালী নিয়ে ভবিষ্যৎ চিন্তা ও স্বপ্নঃ" style="grid-column:1/-1;"></textarea>

      <div style="grid-column:1/-1; background:#f8fbfa; padding:10px; border-radius:10px; border:1px solid var(--border);">
        <label style="font-weight:700; font-size:0.88rem;">ছবি আপলোড করুন অথবা ছবির লিংক দিন:</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
          <input type="file" id="spPhotoFile" accept="image/*" class="form-control">
          <input type="url" id="spPhotoUrl" class="form-control" placeholder="অথবা ছবির URL দিন...">
        </div>
        <div class="img-preview-box" id="spPreview"><span style="color:var(--muted)">ছবির প্রিভিউ</span></div>
      </div>

      <div style="grid-column:1/-1;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:0.9rem;">সোস্যাল লিংক (৫টি বা যত বেশি চান):</strong>
          <button type="button" class="btn btn-outline btn-sm" onclick="addSocialRow()"><i class="fa-solid fa-plus"></i> লিংক বাড়ান</button>
        </div>
        <div id="socialInputsWrap"></div>
      </div>
    </div>
    <button class="btn btn-primary" style="width:100%; margin-top:14px;" onclick="submitPublicProfile()">প্রোফাইল জমা দিন</button>
  `);
  for (let i = 0; i < 5; i++) addSocialRow();
  bindImageInputPreview('spPhotoFile', 'spPhotoUrl', 'spPreview', 'profiles');
}

async function submitPublicProfile() {
  const name = document.getElementById('spName').value.trim();
  if (!name) return showToast('আপনার নাম লিখুন');
  const social_links = [];
  document.querySelectorAll('#socialInputsWrap > div').forEach(row => {
    const plat = row.querySelector('.soc-plat').value;
    const url = row.querySelector('.soc-url').value.trim();
    if (url) social_links.push({ platform: plat, url });
  });

  const payload = {
    name,
    ssc_batch: document.getElementById('spBatch').value,
    blood_group: document.getElementById('spBlood').value,
    education: document.getElementById('spEdu').value,
    profession: document.getElementById('spProf').value,
    current_address: document.getElementById('spCurrAddr').value,
    permanent_address: document.getElementById('spPermAddr').value,
    mobile: document.getElementById('spMobile').value,
    email: document.getElementById('spEmail').value,
    future_dream: document.getElementById('spDream').value,
    photo: document.getElementById('spPhotoUrl').value,
    social_links
  };

  const res = await apiCall(`action=submit_profile`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (res.ok) {
    closeModal();
    showToast(res.message);
  } else showToast(res.error || 'ব্যর্থ হয়েছে');
}

function openPostSubmitModal(cat) {
  const labels = {
    future: 'ফিউচার বাংলাদেশ ও মহেশখালী নিয়ে লিখুন',
    news: 'ব্রেকিং নিউজ লিখুন',
    poem: 'কবিতা ও অভিজ্ঞতা শেয়ার করুন'
  };
  const futureExtras = cat === 'future' ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <input type="text" id="postSubPen" class="form-control" placeholder="ছদ্মনাম (ঐচ্ছিক)">
        <select id="postSubUnion" class="form-control">
          <option value="">ইউনিয়ন / পৌরসভা</option>
          <option>মহেশখালী পৌরসভা</option><option>বড় মহেশখালী</option><option>ছোট মহেশখালী</option>
          <option>হোয়ানক</option><option>কালারমারছড়া</option><option>মাতারবাড়ী</option>
          <option>ধলঘাটা</option><option>কুতুবজোম</option><option>শাপলাপুর</option>
        </select>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <input type="text" id="postSubMobile" class="form-control" placeholder="মোবাইল নম্বর">
        <input type="email" id="postSubEmail" class="form-control" placeholder="ইমেইল ঠিকানা">
      </div>
      <select id="postSubPubAs" class="form-control">
        <option value="own">নিজের নামে প্রকাশ করুন</option>
        <option value="pen">ছদ্মনামে প্রকাশ করুন</option>
        <option value="anon">নাম প্রকাশ না করে</option>
      </select>
      <input type="text" id="postSubSummary" class="form-control" placeholder="সংক্ষিপ্ত সারসংক্ষেপ (ঐচ্ছিক)">
  ` : '';
  openModal(`
    <h2 style="margin-bottom:4px;"><i class="fa-solid fa-pen-nib" style="color:var(--primary)"></i> ${labels[cat] || 'নতুন লেখা'}</h2>
    <p style="font-size:0.86rem; color:var(--muted); margin-bottom:12px;">এডমিন অনুমোদনের পর আপনার লেখাটি প্রকাশিত হবে।</p>
    <div style="display:grid; gap:10px;">
      <input type="text" id="postSubTitle" class="form-control" placeholder="শিরোনাম *">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <input type="text" id="postSubAuthor" class="form-control" placeholder="লেখকের নাম *">
        <select id="postSubBatch" class="form-control">${buildYearOptions('', 'এসএসসি ব্যাচ (ঐচ্ছিক)')}</select>
      </div>
      ${futureExtras}
      <input type="text" id="postSubTag" class="form-control" placeholder="ক্যাটাগরি/ট্যাগ (যেমন: শিক্ষা, প্রযুক্তি, পর্যটন, কবিতা)">
      <textarea id="postSubContent" class="form-control" rows="5" placeholder="বিস্তারিত লিখুন... *"></textarea>
      <div style="background:#f8fbfa; padding:10px; border-radius:10px; border:1px solid var(--border);">
        <label style="font-weight:700; font-size:0.88rem;">ছবি আপলোড অথবা লিংক (প্রিভিউসহ):</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
          <input type="file" id="postPhotoFile" accept="image/*" class="form-control">
          <input type="url" id="postPhotoUrl" class="form-control" placeholder="ছবির URL...">
        </div>
        <div class="img-preview-box" id="postPreview"><span style="color:var(--muted)">ছবির প্রিভিউ</span></div>
      </div>
      <button class="btn btn-primary" onclick="submitPublicPost('${cat}')">জমা দিন</button>
    </div>
  `);
  bindImageInputPreview('postPhotoFile', 'postPhotoUrl', 'postPreview', 'posts');
}

async function submitPublicPost(category) {
  const title = document.getElementById('postSubTitle').value.trim();
  const author_name = document.getElementById('postSubAuthor').value.trim();
  const content = document.getElementById('postSubContent').value.trim();
  if (!title || !author_name || !content) return showToast('শিরোনাম, নাম ও বিষয়বস্তু আবশ্যক');

  const res = await apiCall(`action=submit_post`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      category, title, author_name,
      author_batch: document.getElementById('postSubBatch').value,
      pen_name: document.getElementById('postSubPen')?.value.trim() || '',
      union_name: document.getElementById('postSubUnion')?.value || '',
      author_mobile: document.getElementById('postSubMobile')?.value.trim() || '',
      author_email: document.getElementById('postSubEmail')?.value.trim() || '',
      publish_as: document.getElementById('postSubPubAs')?.value || 'own',
      summary: document.getElementById('postSubSummary')?.value.trim() || '',
      tag: document.getElementById('postSubTag').value.trim() || 'সাধারণ',
      content,
      image: document.getElementById('postPhotoUrl').value.trim()
    })
  });
  if (res.ok) { closeModal(); showToast(res.message); }
  else showToast(res.error || 'ব্যর্থ হয়েছে');
}

function openReportModal() {
  openModal(`
    <h2 style="margin-bottom:10px;"><i class="fa-solid fa-flag" style="color:var(--danger)"></i> রিপোর্ট বা অভিযোগ করুন</h2>
    <div style="display:grid; gap:10px;">
      <input type="text" id="repName" class="form-control" placeholder="আপনার নাম *">
      <input type="text" id="repContact" class="form-control" placeholder="মোবাইল বা ইমেইল">
      <input type="text" id="repSub" class="form-control" placeholder="রিপোর্টের বিষয়">
      <textarea id="repMsg" class="form-control" rows="4" placeholder="বিস্তারিত লিখুন... *"></textarea>
      <button class="btn btn-primary" onclick="submitPublicReport()">রিপোর্ট পাঠান</button>
    </div>
  `);
}

async function submitPublicReport() {
  const reporter_name = document.getElementById('repName').value.trim();
  const message = document.getElementById('repMsg').value.trim();
  if (!reporter_name || !message) return showToast('নাম ও বিস্তারিত লিখুন');
  const res = await apiCall(`action=submit_report`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      reporter_name,
      reporter_contact: document.getElementById('repContact').value.trim(),
      subject: document.getElementById('repSub').value.trim() || 'রিপোর্ট',
      message
    })
  });
  if (res.ok) { closeModal(); showToast(res.message); }
}

document.addEventListener('DOMContentLoaded', initApp);

async function submitHomeSubscribe() {
  const el = document.getElementById('homeSubEmail');
  const email = el.value.trim();
  if (!email) return showToast('আপনার ইমেইল দিন');
  const res = await apiCall(`action=subscribe`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email})
  });
  if (res.ok) { el.value = ''; showToast(res.message); }
  else showToast(res.error || 'সঠিক ইমেইল দিন');
}

async function submitHomeContact() {
  const reporter_name = document.getElementById('homeCntName').value.trim();
  const reporter_contact = document.getElementById('homeCntContact').value.trim();
  const message = document.getElementById('homeCntMsg').value.trim();
  if (!reporter_name || !message) return showToast('নাম ও বার্তা দিন');
  const res = await apiCall(`action=submit_report`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ reporter_name, reporter_contact, subject: 'হোম পেজ যোগাযোগ', message })
  });
  if (res.ok) {
    document.getElementById('homeCntMsg').value = '';
    showToast(res.message);
  }
}

async function renderAllBatchesDirectory() {
  const cy = new Date().getFullYear();
  const res = await apiCall('action=profiles');
  const map = {};
  if (res.ok && res.batch_counts) res.batch_counts.forEach(b => { map[String(b.ssc_batch)] = b.cnt; });
  let cards = '';
  for (let y = cy; y >= 1971; y--) {
    const cnt = map[String(y)] || 0;
    cards += `<a href="javascript:void(0)" onclick="STATE.initialBatchYear='${y}'; navigate('profiles')" class="counter-card" style="text-decoration:none;">
      <div class="counter-num">${y}</div>
      <div class="counter-label">SSC ব্যাচ ${y} (${cnt} জন)</div>
    </a>`;
  }
  document.getElementById('appRoot').innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-graduation-cap"></i> সকল এসএসসি ব্যাচ (১৯৭১ – ${cy})</h2>
      <button class="btn btn-primary btn-sm" onclick="openProfileSubmitModal()">+ আপনার প্রোফাইল যুক্ত করুন</button>
    </div>
    <div class="counters-grid">${cards}</div>
  `;
}

function renderInfoPage(title, bodyText) {
  document.getElementById('appRoot').innerHTML = `
    <div style="background:rgba(255,255,255,0.95); padding:28px; border-radius:20px; border:1px solid var(--border); box-shadow:var(--shadow-sm); max-width:860px; margin:0 auto;">
      <h2 style="color:var(--navy); margin-bottom:14px;"><i class="fa-solid fa-circle-info" style="color:var(--primary)"></i> ${escapeHtml(title)}</h2>
      <p style="font-size:1.02rem; line-height:1.9; color:var(--ink); white-space:pre-line;">${escapeHtml(bodyText)}</p>
      <div style="margin-top:20px;"><a href="index.html" class="btn btn-primary btn-sm">হোম পেজে ফিরুন</a></div>
    </div>
  `;
}

function renderNoticesBoardPage() {
  document.getElementById('appRoot').innerHTML = `
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-bullhorn"></i> নোটিশ ও ঘোষণা বোর্ড</h2>
      <button class="btn btn-outline btn-sm" onclick="requestPushPermission()"><i class="fa-solid fa-bell"></i> পুশ নোটিফিকেশন চালু করুন</button>
    </div>
    <div style="display:grid; gap:12px;">
      ${(STATE.notices || []).map(n => `
        <div style="background:rgba(255,255,255,0.95); padding:18px; border-radius:14px; border-left:4px solid var(--primary); border:1px solid var(--border);">
          <h3 style="color:var(--navy);">${escapeHtml(n.title)}</h3>
          <p style="color:var(--muted); margin-top:6px;">${escapeHtml(n.body)}</p>
        </div>
      `).join('') || '<p>কোনো সক্রিয় নোটিশ নেই।</p>'}
    </div>
  `;
}
