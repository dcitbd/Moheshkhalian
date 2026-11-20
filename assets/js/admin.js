/**
 * মহেশখালীয়ান (Maheshkhalian) Admin Panel Controller
 * Features: Device-aware session (Mobile persistent vs Desktop tab-close logout),
 * Time Lock, Role-Based Access Control (RBAC), Full CRUD & Quiz Result Publishing
 */
const API = 'api.php';
let ADM = {
  token: '',
  user: null,
  tab: 'overview',
  isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
};

function saveToken(tok) { ADM.token = tok; }
function loadToken() { return ADM.token; }
function clearToken() { ADM.token = ''; }

// Desktop: auto logout on tab/browser close via sendBeacon
window.addEventListener('beforeunload', () => {
  if (!ADM.isMobile && ADM.user) {
    navigator.sendBeacon(`${API}?action=admin_logout`);
  }
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const el = document.getElementById('toastBox');
  el.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#2ce6b5"></i> <span>${escapeHtml(msg)}</span>`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function openAdmModal(html) {
  document.getElementById('adminModalBody').innerHTML = html;
  document.getElementById('adminModal').classList.add('open');
}
function closeAdmModal() {
  document.getElementById('adminModal').classList.remove('open');
}

let ADM_PHP_ALIVE = null;
async function apiFetch(action, opts = {}) {
  if (ADM_PHP_ALIVE !== false) {
    try {
      const headers = opts.headers || {};
      if (ADM.token) headers['X-Auth-Token'] = ADM.token;
      if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${API}?action=${action}`, { ...opts, headers });
      const txt = (await res.text()).replace(/^\uFEFF/, '').trim();
      if (!txt.startsWith('<') && (txt.startsWith('{') || txt.startsWith('['))) {
        ADM_PHP_ALIVE = true;
        return JSON.parse(txt);
      } else {
        ADM_PHP_ALIVE = false;
      }
    } catch (e) {
      ADM_PHP_ALIVE = false;
    }
  }
  return mkAdminFallback(action, opts);
}

function mkAdminFallback(actionStr, opts = {}) {
  const db = window.MK_SEED || { settings:{}, profiles:[], posts:[], quizzes:[], quiz_submissions:[], administration:[], notices:[], users:[], reports:[], login_logs:[] };
  const act = actionStr.split('&')[0];
  let body = {};
  if (opts.body && typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch(e) {} }

  if (act === 'admin_check') return { ok: true, authenticated: false };
  if (act === 'admin_login') {
    const u = db.users.find(x => x.email === body.email) || db.users[0];
    if (!u) return { ok: false, error: 'ইউজার পাওয়া যায়নি' };
    return { ok: true, token: 'demo_tok_' + Date.now(), requires_timelock: true, user: u };
  }
  if (act === 'verify_timelock') {
    const pin = db.settings.time_lock_pin || '1971';
    if (body.pin !== pin) return { ok: false, error: 'টাইম লক পিন সঠিক নয়!' };
    return { ok: true, unlocked: true };
  }
  if (act === 'admin_dashboard') {
    return {
      ok: true,
      stats: {
        profiles_approved: db.profiles.filter(p=>p.status==='approved').length,
        profiles_pending: db.profiles.filter(p=>p.status==='pending').length,
        future_total: db.posts.filter(p=>p.category==='future').length,
        future_pending: db.posts.filter(p=>p.category==='future' && p.status==='pending').length,
        news_total: db.posts.filter(p=>p.category==='news').length,
        news_pending: db.posts.filter(p=>p.category==='news' && p.status==='pending').length,
        poems_total: db.posts.filter(p=>p.category==='poem').length,
        quizzes_total: db.quizzes.length,
        submissions_total: db.quiz_submissions.length,
        reports_pending: db.reports.length
      },
      login_logs: db.login_logs
    };
  }
  if (act === 'profiles') return { ok: true, profiles: db.profiles };
  if (act === 'posts') {
    const params = new URLSearchParams(actionStr);
    const cat = params.get('category') || 'all';
    return { ok: true, posts: cat === 'all' ? db.posts : db.posts.filter(p => p.category === cat) };
  }
  if (act === 'quizzes') return { ok: true, quizzes: db.quizzes };
  if (act === 'admin_quiz_submissions') return { ok: true, submissions: db.quiz_submissions, profiles: db.profiles };
  if (act === 'administration') return { ok: true, members: db.administration };
  if (act === 'admin_users') return { ok: true, users: db.users };
  if (act === 'admin_notices') return { ok: true, notices: db.notices };
  if (act === 'admin_reports') return { ok: true, reports: db.reports };
  if (act === 'admin_get_settings') return { ok: true, settings: db.settings };
  return { ok: true };
}

// Initialize Admin Flow
document.addEventListener('DOMContentLoaded', async () => {
  setInterval(() => {
    const cl = document.getElementById('tlClock');
    if (cl) cl.textContent = new Date().toLocaleTimeString('en-GB');
  }, 1000);

  const chk = await apiFetch('admin_check');
  if (!chk.authenticated) {
    clearToken();
    showStep('login');
  } else if (!chk.unlocked) {
    ADM.user = chk.user;
    showStep('timelock');
  } else {
    ADM.user = chk.user;
    enterDashboard();
  }
});

function showStep(step) {
  document.getElementById('loginView').style.display = step === 'login' ? 'flex' : 'none';
  document.getElementById('timelockView').style.display = step === 'timelock' ? 'flex' : 'none';
  document.getElementById('dashboardView').style.display = step === 'dashboard' ? 'grid' : 'none';
  if (step === 'timelock' && ADM.user) {
    document.getElementById('tlUserName').textContent = ADM.user.name;
  }
}

async function doAdminLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  if (!email || !password) return showToast('ইমেইল ও পাসওয়ার্ড দিন');

  const res = await apiFetch('admin_login', {
    method: 'POST',
    body: JSON.stringify({ email, password, device_type: ADM.isMobile ? 'mobile' : 'desktop' })
  });
  if (res.ok) {
    saveToken(res.token);
    ADM.user = res.user;
    showStep('timelock');
    showToast('লগইন সফল! এখন টাইম লক আনলক করুন।');
  } else {
    showToast(res.error || 'লগইন ব্যর্থ');
  }
}

async function verifyTimeLock() {
  const pin = document.getElementById('tlPinInput').value.trim();
  const res = await apiFetch('verify_timelock', { method: 'POST', body: JSON.stringify({ pin }) });
  if (res.ok) {
    enterDashboard();
  } else {
    showToast(res.error || 'পিন সঠিক নয়');
  }
}

async function doAdminLogout() {
  if (ADM.token) await apiFetch('admin_logout', { method: 'POST' }).catch(() => {});
  clearToken();
  ADM.user = null;
  showStep('login');
}

// Role-Based Sidebar & Navigation
function hasPerm(p) {
  if (!ADM.user) return false;
  if (ADM.user.role === 'super_admin') return true;
  return (ADM.user.permissions || []).includes(p);
}

function enterDashboard() {
  showStep('dashboard');
  document.getElementById('admUserName').textContent = ADM.user.name;
  document.getElementById('admUserRole').textContent = `${ADM.user.designation} (${ADM.user.role})`;
  document.getElementById('admUserPhoto').src = ADM.user.photo || 'assets/images/logo.png';

  const menuItems = [
    { id: 'overview', label: 'ড্যাশবোর্ড ওভারভিউ', icon: 'fa-chart-pie', perm: '' },
    { id: 'profiles', label: 'প্রোফাইল ও ব্যাচ (১৯৭১+)', icon: 'fa-users', perm: 'profiles' },
    { id: 'future', label: 'ফিউচার বাংলাদেশ', icon: 'fa-lightbulb', perm: 'future' },
    { id: 'news', label: 'ব্রেকিং নিউজ', icon: 'fa-newspaper', perm: 'news' },
    { id: 'poems', label: 'কবিতা ও অভিজ্ঞতা', icon: 'fa-feather-pointed', perm: 'poems' },
    { id: 'quizzes', label: 'কুইজ, সাবমিশন ও রেজাল্ট', icon: 'fa-trophy', perm: 'quizzes' },
    { id: 'administration', label: 'প্রশাসন ও পরিচালক', icon: 'fa-user-tie', perm: 'administration' },
    { id: 'users', label: 'ইউজার ও রোল ম্যানেজমেন্ট', icon: 'fa-users-gear', perm: 'users' },
    { id: 'notices', label: 'নোটিশ বোর্ড', icon: 'fa-bullhorn', perm: 'notices' },
    { id: 'reports', label: 'রিপোর্ট ও বার্তা', icon: 'fa-flag', perm: 'reports' },
    { id: 'settings', label: 'ওয়েবসাইট তথ্য ও সেটিংস', icon: 'fa-gear', perm: 'settings' }
  ];

  const allowed = menuItems.filter(m => m.perm === '' || hasPerm(m.perm));
  document.getElementById('sidebarMenu').innerHTML = allowed.map(m => `
    <button class="side-btn ${ADM.tab === m.id ? 'active' : ''}" data-tab="${m.id}" onclick="switchTab('${m.id}', '${m.label}')">
      <i class="fa-solid ${m.icon}"></i> ${m.label}
    </button>
  `).join('');

  switchTab('overview', 'ড্যাশবোর্ড ওভারভিউ');
}

function switchTab(tab, title) {
  ADM.tab = tab;
  document.getElementById('adminPageTitle').textContent = title;
  document.querySelectorAll('#sidebarMenu .side-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));

  if (tab === 'overview') loadOverview();
  else if (tab === 'profiles') loadAdminProfiles();
  else if (['future','news','poems'].includes(tab)) loadAdminPosts(tab === 'poems' ? 'poem' : tab);
  else if (tab === 'quizzes') loadAdminQuizzes();
  else if (tab === 'administration') loadAdminTeam();
  else if (tab === 'users') loadAdminUsers();
  else if (tab === 'notices') loadAdminNotices();
  else if (tab === 'reports') loadAdminReports();
  else if (tab === 'settings') loadAdminSettings();
}

// ==========================================
// 1. OVERVIEW & DIGITAL COUNTERS & LOGIN TRACKING
// ==========================================
async function loadOverview() {
  const res = await apiFetch('admin_dashboard');
  if (!res.ok) return;
  const s = res.stats;
  document.getElementById('adminContent').innerHTML = `
    <div class="counters-grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">
      <div class="counter-card"><div class="counter-num">${s.profiles_approved}</div><div class="counter-label">অনুমোদিত প্রোফাইল (অপেক্ষমাণ: ${s.profiles_pending})</div></div>
      <div class="counter-card"><div class="counter-num">${s.future_total}</div><div class="counter-label">ফিউচার বাংলাদেশ (অপেক্ষমাণ: ${s.future_pending})</div></div>
      <div class="counter-card"><div class="counter-num">${s.news_total}</div><div class="counter-label">ব্রেকিং নিউজ (অপেক্ষমাণ: ${s.news_pending})</div></div>
      <div class="counter-card"><div class="counter-num">${s.poems_total}</div><div class="counter-label">কবিতা ও অভিজ্ঞতা</div></div>
      <div class="counter-card"><div class="counter-num">${s.submissions_total}</div><div class="counter-label">কুইজ সাবমিশন (${s.quizzes_total} কুইজ)</div></div>
      <div class="counter-card"><div class="counter-num">${s.reports_pending}</div><div class="counter-label">নতুন রিপোর্ট/বার্তা</div></div>
    </div>

    <h3 style="margin:18px 0 10px; color:var(--navy);">সর্বশেষ লগইন ট্র্যাকিং (একাউন্ট মনিটরিং)</h3>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>নাম</th><th>ইমেইল</th><th>রোল</th><th>ডিভাইস</th><th>সময়</th></tr></thead>
        <tbody>
          ${res.login_logs.map(l => `
            <tr>
              <td><strong>${escapeHtml(l.user_name)}</strong></td>
              <td>${escapeHtml(l.user_email)}</td>
              <td><span class="status-pill st-active">${escapeHtml(l.role)}</span></td>
              <td>${escapeHtml(l.device_type)}</td>
              <td>${escapeHtml(l.login_time)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ==========================================
// 2. PROFILES MANAGEMENT
// ==========================================
async function loadAdminProfiles() {
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; margin-bottom:14px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <input type="text" id="admProfQ" class="form-control" placeholder="নাম/ব্যাচ/পেশা..." style="width:220px;" oninput="fetchAdminProfiles()">
        <select id="admProfStatus" class="form-control" style="width:160px;" onchange="fetchAdminProfiles()">
          <option value="all">সকল স্ট্যাটাস</option>
          <option value="pending">অপেক্ষমাণ (Pending)</option>
          <option value="approved">অনুমোদিত (Approved)</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openEditProfileModal()"><i class="fa-solid fa-plus"></i> নতুন প্রোফাইল যুক্ত করুন</button>
    </div>
    <div class="data-table-wrap" id="admProfilesTable">লোড হচ্ছে...</div>
  `;
  fetchAdminProfiles();
}

async function fetchAdminProfiles() {
  const q = encodeURIComponent(document.getElementById('admProfQ').value);
  const st = encodeURIComponent(document.getElementById('admProfStatus').value);
  const res = await apiFetch(`profiles&admin=1&q=${q}&status=${st}`);
  if (!res.ok) return;

  document.getElementById('admProfilesTable').innerHTML = `
    <table>
      <thead><tr><th>ছবি</th><th>নাম</th><th>ব্যাচ</th><th>পেশা</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
      <tbody>
        ${res.profiles.map(p => `
          <tr>
            <td><img src="${escapeHtml(p.photo || 'assets/images/logo.png')}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;"></td>
            <td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.mobile || '')}</small></td>
            <td>SSC ${escapeHtml(p.ssc_batch)}</td>
            <td>${escapeHtml(p.profession)}</td>
            <td><span class="status-pill st-${p.status}">${p.status}</span></td>
            <td style="white-space:nowrap;">
              ${p.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="setProfileStatus(${p.id}, 'approved')"><i class="fa-solid fa-check"></i></button>` : ''}
              <button class="btn btn-outline btn-sm" title="QuickView" onclick='quickViewProfile(${JSON.stringify(p).replace(/'/g, "&#39;")})'><i class="fa-solid fa-eye"></i></button>
              <button class="btn btn-outline btn-sm" onclick='openEditProfileModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
              <button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteProfile(${p.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function setProfileStatus(id, status) {
  await apiFetch('admin_set_profile_status', { method:'POST', body: JSON.stringify({id, status}) });
  showToast('স্ট্যাটাস আপডেট হয়েছে');
  fetchAdminProfiles();
}

async function deleteProfile(id) {
  if (!confirm('প্রোফাইলটি ডিলিট করতে চান?')) return;
  await apiFetch('admin_delete_profile', { method:'POST', body: JSON.stringify({id}) });
  showToast('ডিলিট হয়েছে');
  fetchAdminProfiles();
}

function bindAdmImagePreview(fileId, urlId, prevId, folder) {
  const f = document.getElementById(fileId);
  const u = document.getElementById(urlId);
  const p = document.getElementById(prevId);
  u.addEventListener('input', () => { p.innerHTML = u.value ? `<img src="${escapeHtml(u.value)}">` : 'প্রিভিউ'; });
  f.addEventListener('change', async () => {
    if (!f.files[0]) return;
    const fd = new FormData(); fd.append('file', f.files[0]); fd.append('folder', folder);
    const res = await apiFetch('upload_image', { method:'POST', body:fd });
    if (res.ok) { u.value = res.url; p.innerHTML = `<img src="${escapeHtml(res.url)}">`; }
  });
}

function openEditProfileModal(p = null) {
  const d = p || { id:0, name:'', ssc_batch:'2020', education:'', profession:'', blood_group:'', current_address:'', permanent_address:'', mobile:'', email:'', future_dream:'', photo:'', social_links:[], status:'approved' };
  openAdmModal(`
    <h3>${d.id ? 'প্রোফাইল এডিট' : 'নতুন প্রোফাইল'}</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
      <input type="text" id="epName" class="form-control" placeholder="নাম *" value="${escapeHtml(d.name)}" style="grid-column:1/-1;">
      <select id="epBatch" class="form-control">
        ${(() => { const cy = new Date().getFullYear(); let opts = ""; for(let y=cy; y>=1971; y--) { opts += `<option value="${y}" ${String(d.ssc_batch)===String(y)?'selected':''}>SSC ${y}</option>`; } return opts; })()}
      </select>
      <input type="text" id="epBlood" class="form-control" placeholder="ব্লাড গ্রুপ" value="${escapeHtml(d.blood_group)}">
      <input type="text" id="epEdu" class="form-control" placeholder="শিক্ষাগত যোগ্যতা" value="${escapeHtml(d.education)}">
      <input type="text" id="epProf" class="form-control" placeholder="পেশা" value="${escapeHtml(d.profession)}">
      <input type="text" id="epCurr" class="form-control" placeholder="বর্তমান ঠিকানা" value="${escapeHtml(d.current_address)}">
      <input type="text" id="epPerm" class="form-control" placeholder="স্থায়ী ঠিকানা" value="${escapeHtml(d.permanent_address)}">
      <input type="text" id="epMob" class="form-control" placeholder="মোবাইল" value="${escapeHtml(d.mobile)}">
      <input type="text" id="epMail" class="form-control" placeholder="ইমেইল" value="${escapeHtml(d.email)}">
      <textarea id="epDream" class="form-control" rows="2" placeholder="মহেশখালী নিয়ে স্বপ্ন" style="grid-column:1/-1;">${escapeHtml(d.future_dream)}</textarea>
      <select id="epStatus" class="form-control" style="grid-column:1/-1;">
        <option value="approved" ${d.status==='approved'?'selected':''}>Approved</option>
        <option value="pending" ${d.status==='pending'?'selected':''}>Pending</option>
      </select>
      <div style="grid-column:1/-1;">
        <input type="file" id="epFile" class="form-control" accept="image/*" style="margin-bottom:6px;">
        <input type="text" id="epPhoto" class="form-control" placeholder="ছবির URL" value="${escapeHtml(d.photo)}">
        <div class="img-preview-box" id="epPrev">${d.photo ? `<img src="${escapeHtml(d.photo)}">` : 'প্রিভিউ'}</div>
      </div>
      <textarea id="epSocial" class="form-control" rows="2" placeholder='সোস্যাল JSON: [{"platform":"facebook","url":"https://..."}]' style="grid-column:1/-1;">${escapeHtml(JSON.stringify(d.social_links || []))}</textarea>
    </div>
    <button class="btn btn-primary" style="width:100%; margin-top:12px;" onclick="saveAdminProfile(${d.id})">সংরক্ষণ করুন</button>
  `);
  bindAdmImagePreview('epFile', 'epPhoto', 'epPrev', 'profiles');
}

async function saveAdminProfile(id) {
  let social_links = [];
  try { social_links = JSON.parse(document.getElementById('epSocial').value || '[]'); } catch(e) {}
  await apiFetch('admin_save_profile', {
    method:'POST',
    body: JSON.stringify({
      id, name: document.getElementById('epName').value, ssc_batch: document.getElementById('epBatch').value,
      blood_group: document.getElementById('epBlood').value, education: document.getElementById('epEdu').value,
      profession: document.getElementById('epProf').value, current_address: document.getElementById('epCurr').value,
      permanent_address: document.getElementById('epPerm').value, mobile: document.getElementById('epMob').value,
      email: document.getElementById('epMail').value, future_dream: document.getElementById('epDream').value,
      status: document.getElementById('epStatus').value, photo: document.getElementById('epPhoto').value, social_links
    })
  });
  closeAdmModal(); showToast('সংরক্ষিত হয়েছে!'); fetchAdminProfiles();
}

// ==========================================
// 3. POSTS MANAGEMENT (FUTURE, NEWS, POEMS)
// ==========================================
async function loadAdminPosts(cat) {
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <input type="text" id="admPostQ" class="form-control" placeholder="খুঁজুন..." style="width:240px;" oninput="fetchAdminPosts('${cat}')">
      <button class="btn btn-primary btn-sm" onclick="openEditPostModal('${cat}')"><i class="fa-solid fa-plus"></i> নতুন যোগ করুন</button>
    </div>
    <div class="data-table-wrap" id="admPostsTable">লোড হচ্ছে...</div>
  `;
  fetchAdminPosts(cat);
}

async function fetchAdminPosts(cat) {
  const q = encodeURIComponent(document.getElementById('admPostQ').value);
  const res = await apiFetch(`posts&admin=1&category=${cat}&q=${q}`);
  if (!res.ok) return;
  document.getElementById('admPostsTable').innerHTML = `
    <table>
      <thead><tr><th>শিরোনাম</th><th>লেখক</th><th>ট্যাগ</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
      <tbody>
        ${res.posts.map(p => `
          <tr>
            <td><strong>${escapeHtml(p.title)}</strong></td>
            <td>${escapeHtml(p.author_name)}</td>
            <td>${escapeHtml(p.tag)}</td>
            <td><span class="status-pill st-${p.status}">${p.status}</span></td>
            <td style="white-space:nowrap;">
              ${p.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="setPostStatus(${p.id}, 'approved', '${cat}')"><i class="fa-solid fa-check"></i></button>` : ''}
              <button class="btn btn-outline btn-sm" onclick='openEditPostModal("${cat}", ${JSON.stringify(p).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
              <button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deletePost(${p.id}, '${cat}')"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function setPostStatus(id, status, cat) {
  await apiFetch('admin_set_post_status', { method:'POST', body:JSON.stringify({id, status}) });
  showToast('অনুমোদিত হয়েছে'); fetchAdminPosts(cat);
}
async function deletePost(id, cat) {
  if (!confirm('ডিলিট করতে চান?')) return;
  await apiFetch('admin_delete_post', { method:'POST', body:JSON.stringify({id}) });
  showToast('ডিলিট হয়েছে'); fetchAdminPosts(cat);
}

function openEditPostModal(cat, p = null) {
  const d = p || { id:0, category:cat, title:'', author_name:'', author_batch:'', tag:'', content:'', image:'', status:'approved' };
  openAdmModal(`
    <h3>${d.id ? 'পোস্ট এডিট' : 'নতুন পোস্ট'}</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <input type="text" id="epoTitle" class="form-control" placeholder="শিরোনাম *" value="${escapeHtml(d.title)}">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <input type="text" id="epoAuthor" class="form-control" placeholder="লেখকের নাম" value="${escapeHtml(d.author_name)}">
        <input type="text" id="epoTag" class="form-control" placeholder="ট্যাগ" value="${escapeHtml(d.tag)}">
      </div>
      <textarea id="epoContent" class="form-control" rows="5" placeholder="বিস্তারিত...">${escapeHtml(d.content)}</textarea>
      <select id="epoStatus" class="form-control">
        <option value="approved" ${d.status==='approved'?'selected':''}>Approved</option>
        <option value="pending" ${d.status==='pending'?'selected':''}>Pending</option>
      </select>
      <input type="file" id="epoFile" class="form-control" accept="image/*">
      <input type="text" id="epoImg" class="form-control" placeholder="ছবির URL" value="${escapeHtml(d.image)}">
      <div class="img-preview-box" id="epoPrev">${d.image ? `<img src="${escapeHtml(d.image)}">` : 'প্রিভিউ'}</div>
      <button class="btn btn-primary" onclick="saveAdminPost(${d.id}, '${cat}')">সংরক্ষণ করুন</button>
    </div>
  `);
  bindAdmImagePreview('epoFile', 'epoImg', 'epoPrev', 'posts');
}

async function saveAdminPost(id, cat) {
  await apiFetch('admin_save_post', {
    method:'POST',
    body: JSON.stringify({
      id, category: cat, title: document.getElementById('epoTitle').value,
      author_name: document.getElementById('epoAuthor').value, tag: document.getElementById('epoTag').value,
      content: document.getElementById('epoContent').value, status: document.getElementById('epoStatus').value,
      image: document.getElementById('epoImg').value
    })
  });
  closeAdmModal(); showToast('সংরক্ষিত!'); fetchAdminPosts(cat);
}

// ==========================================
// 4. QUIZZES, SUBMISSIONS & RESULT PUBLISHING
// ==========================================
async function loadAdminQuizzes() {
  const [qRes, sRes] = await Promise.all([apiFetch('quizzes&admin=1'), apiFetch('admin_quiz_submissions')]);
  const quizzes = qRes.ok ? qRes.quizzes : [];
  const subs = sRes.ok ? sRes.submissions : [];
  const profs = sRes.ok ? sRes.profiles : [];

  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <h3>কুইজ ও প্রতিযোগিতা তালিকা</h3>
      <button class="btn btn-primary btn-sm" onclick="openNewQuizModal()"><i class="fa-solid fa-plus"></i> নতুন কুইজ তৈরি</button>
    </div>
    <div class="data-table-wrap" style="margin-bottom:24px;">
      <table>
        <thead><tr><th>শিরোনাম</th><th>ক্যাটাগরি</th><th>শেষ সময়</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${quizzes.map(q => `
            <tr>
              <td><strong>${escapeHtml(q.title)}</strong></td>
              <td>${escapeHtml(q.category)}</td>
              <td>${escapeHtml(q.deadline)}</td>
              <td><span class="status-pill st-${q.status}">${q.status}</span></td>
              <td><button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteQuiz(${q.id})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h3 style="margin-bottom:10px;">কুইজ সাবমিশন ও রেজাল্ট প্রদান (প্রোফাইল কার্ডে যুক্ত হবে)</h3>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>অংশগ্রহণকারী</th><th>কুইজ</th><th>স্কোর ও র‍্যাংক</th><th>রেজাল্ট</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${subs.map(s => `
            <tr>
              <td><strong>${escapeHtml(s.participant_name)}</strong> (SSC ${escapeHtml(s.ssc_batch)})<br><small>${escapeHtml(s.mobile)}</small></td>
              <td>${escapeHtml(s.quiz_title)}</td>
              <td>${escapeHtml(s.score)} • <strong>${escapeHtml(s.rank_title || '-')}</strong></td>
              <td><span class="status-pill ${s.result_published ? 'st-approved' : 'st-pending'}">${s.result_published ? 'প্রকাশিত' : 'অপেক্ষমাণ'}</span></td>
              <td><button class="btn btn-primary btn-sm" onclick='openPublishResultModal(${JSON.stringify(s).replace(/'/g, "&#39;")}, ${JSON.stringify(profs).replace(/'/g, "&#39;")})'>রেজাল্ট দিন</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openNewQuizModal() {
  openAdmModal(`
    <h3>নতুন কুইজ / প্রতিযোগিতা</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <input type="text" id="nqTitle" class="form-control" placeholder="কুইজ শিরোনাম *">
      <input type="text" id="nqCat" class="form-control" placeholder="ক্যাটাগরি (যেমন: সাধারণ জ্ঞান)">
      <input type="date" id="nqDead" class="form-control">
      <textarea id="nqDesc" class="form-control" rows="2" placeholder="বিবরণ..."></textarea>
      <textarea id="nqQs" class="form-control" rows="5" placeholder='প্রশ্ন JSON: [{"q":"প্রশ্ন?","options":["ক","খ","গ","ঘ"],"ans":0}]'>[{"q":"মহেশখালী কোন জেলায় অবস্থিত?","options":["কক্সবাজার","চট্টগ্রাম","ফেনী","বান্দরবান"],"ans":0}]</textarea>
      <button class="btn btn-primary" onclick="saveNewQuiz()">তৈরি করুন</button>
    </div>
  `);
}

async function saveNewQuiz() {
  let qs = [];
  try { qs = JSON.parse(document.getElementById('nqQs').value); } catch(e) { return showToast('সঠিক JSON ফরম্যাট দিন'); }
  await apiFetch('admin_save_quiz', {
    method:'POST',
    body: JSON.stringify({
      id:0, title: document.getElementById('nqTitle').value, category: document.getElementById('nqCat').value,
      deadline: document.getElementById('nqDead').value, description: document.getElementById('nqDesc').value,
      questions: qs, status: 'active'
    })
  });
  closeAdmModal(); showToast('কুইজ তৈরি হয়েছে!'); loadAdminQuizzes();
}

async function deleteQuiz(id) {
  if (!confirm('ডিলিট করবেন?')) return;
  await apiFetch('admin_delete_quiz', { method:'POST', body:JSON.stringify({id}) });
  loadAdminQuizzes();
}

function openPublishResultModal(s, profs) {
  openAdmModal(`
    <h3>রেজাল্ট প্রকাশ করুন — ${escapeHtml(s.participant_name)}</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <label>প্রোফাইলের সাথে যুক্ত করুন (কার্ডে শো করার জন্য):</label>
      <select id="prProfId" class="form-control">
        <option value="0">-- প্রোফাইল নির্বাচন করুন --</option>
        ${profs.map(p => `<option value="${p.id}" ${s.profile_id == p.id ? 'selected' : ''}>${escapeHtml(p.name)} (SSC ${escapeHtml(p.ssc_batch)})</option>`).join('')}
      </select>
      <input type="text" id="prScore" class="form-control" placeholder="স্কোর (যেমন: ২৮/৩০)" value="${escapeHtml(s.score)}">
      <input type="text" id="prRank" class="form-control" placeholder="স্থান/পদক (যেমন: ১ম স্থান — স্বর্ণপদক)" value="${escapeHtml(s.rank_title)}">
      <input type="text" id="prRem" class="form-control" placeholder="মন্তব্য" value="${escapeHtml(s.remarks)}">
      <button class="btn btn-primary" onclick="publishQuizResult(${s.id})">প্রকাশ করুন</button>
    </div>
  `);
}

async function publishQuizResult(id) {
  await apiFetch('admin_publish_result', {
    method:'POST',
    body: JSON.stringify({
      id, profile_id: document.getElementById('prProfId').value,
      score: document.getElementById('prScore').value,
      rank_title: document.getElementById('prRank').value,
      remarks: document.getElementById('prRem').value
    })
  });
  closeAdmModal(); showToast('রেজাল্ট প্রকাশিত ও প্রোফাইলে যুক্ত হয়েছে!'); loadAdminQuizzes();
}

// ==========================================
// 5. ADMINISTRATION TEAM
// ==========================================
async function loadAdminTeam() {
  const res = await apiFetch('administration');
  const members = res.ok ? res.members : [];
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <h3>প্রশাসন ও পরিচালনা পর্ষদ</h3>
      <button class="btn btn-primary btn-sm" onclick="openTeamModal()"><i class="fa-solid fa-plus"></i> নতুন সদস্য যোগ করুন</button>
    </div>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>ছবি</th><th>নাম ও পদবী</th><th>বিভাগ</th><th>যোগাযোগ</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${members.map(m => `
            <tr>
              <td><img src="${escapeHtml(m.photo || 'assets/images/logo.png')}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;"></td>
              <td><strong>${escapeHtml(m.name)}</strong><br><small>${escapeHtml(m.role_title)}</small></td>
              <td>${escapeHtml(m.department)}</td>
              <td>${escapeHtml(m.mobile)}<br><small>${escapeHtml(m.email)}</small></td>
              <td>
                <button class="btn btn-outline btn-sm" onclick='openTeamModal(${JSON.stringify(m).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteTeamMember(${m.id})"><i class="fa-solid fa-trash"></i></button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openTeamModal(m = null) {
  const d = m || { id:0, name:'', role_title:'', department:'এডমিন', bio:'', mobile:'', email:'', photo:'', sort_order:1 };
  openAdmModal(`
    <h3>${d.id ? 'সদস্য এডিট' : 'নতুন প্রশাসন সদস্য'}</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <input type="text" id="tmName" class="form-control" placeholder="নাম *" value="${escapeHtml(d.name)}">
      <input type="text" id="tmRole" class="form-control" placeholder="পদবী (যেমন: পরিচালক)" value="${escapeHtml(d.role_title)}">
      <input type="text" id="tmDept" class="form-control" placeholder="বিভাগ (এডমিন/পরিচালক/মডারেটর)" value="${escapeHtml(d.department)}">
      <input type="text" id="tmMob" class="form-control" placeholder="মোবাইল" value="${escapeHtml(d.mobile)}">
      <input type="text" id="tmEmail" class="form-control" placeholder="ইমেইল" value="${escapeHtml(d.email)}">
      <textarea id="tmBio" class="form-control" rows="2" placeholder="সংক্ষিপ্ত পরিচিতি">${escapeHtml(d.bio)}</textarea>
      <input type="number" id="tmOrder" class="form-control" placeholder="ক্রমিক নং" value="${d.sort_order}">
      <input type="file" id="tmFile" class="form-control" accept="image/*">
      <input type="text" id="tmPhoto" class="form-control" placeholder="ছবির URL" value="${escapeHtml(d.photo)}">
      <div class="img-preview-box" id="tmPrev">${d.photo ? `<img src="${escapeHtml(d.photo)}">` : 'প্রিভিউ'}</div>
      <button class="btn btn-primary" onclick="saveTeamMember(${d.id})">সংরক্ষণ করুন</button>
    </div>
  `);
  bindAdmImagePreview('tmFile', 'tmPhoto', 'tmPrev', 'users');
}

async function saveTeamMember(id) {
  await apiFetch('admin_save_admin_member', {
    method:'POST',
    body: JSON.stringify({
      id, name: document.getElementById('tmName').value, role_title: document.getElementById('tmRole').value,
      department: document.getElementById('tmDept').value, mobile: document.getElementById('tmMob').value,
      email: document.getElementById('tmEmail').value, bio: document.getElementById('tmBio').value,
      sort_order: document.getElementById('tmOrder').value, photo: document.getElementById('tmPhoto').value, social_links: []
    })
  });
  closeAdmModal(); showToast('সংরক্ষিত হয়েছে!'); loadAdminTeam();
}

async function deleteTeamMember(id) {
  if (!confirm('ডিলিট করবেন?')) return;
  await apiFetch('admin_delete_admin_member', { method:'POST', body:JSON.stringify({id}) });
  loadAdminTeam();
}

// ==========================================
// 6. USERS & RBAC MANAGEMENT
// ==========================================
async function loadAdminUsers() {
  const res = await apiFetch('admin_users');
  const users = res.ok ? res.users : [];
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <h3>ইউজার ও রোল ম্যানেজমেন্ট (RBAC)</h3>
      <button class="btn btn-primary btn-sm" onclick="openUserModal()"><i class="fa-solid fa-user-plus"></i> নতুন ইউজার</button>
    </div>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>ছবি</th><th>নাম ও পদবী</th><th>ইমেইল</th><th>রোল</th><th>অনুমতি</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td><img src="${escapeHtml(u.photo || 'assets/images/logo.png')}" style="width:38px; height:38px; border-radius:50%; object-fit:cover;"></td>
              <td><strong>${escapeHtml(u.name)}</strong><br><small>${escapeHtml(u.designation)}</small></td>
              <td>${escapeHtml(u.email)}</td>
              <td><span class="status-pill st-active">${escapeHtml(u.role)}</span></td>
              <td style="font-size:0.8rem;">${(u.permissions || []).join(', ')}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick='openUserModal(${JSON.stringify(u).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteUser(${u.id})"><i class="fa-solid fa-trash"></i></button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openUserModal(u = null) {
  const d = u || { id:0, name:'', email:'', designation:'মডারেটর', role:'moderator', photo:'', permissions:['profiles','news'], status:'active' };
  const allPerms = ['profiles','future','news','poems','quizzes','administration','users','notices','reports','settings'];
  openAdmModal(`
    <h3>${d.id ? 'ইউজার এডিট' : 'নতুন এডমিন ইউজার'}</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <input type="text" id="usrName" class="form-control" placeholder="নাম *" value="${escapeHtml(d.name)}">
      <input type="email" id="usrEmail" class="form-control" placeholder="ইমেইল *" value="${escapeHtml(d.email)}">
      <input type="password" id="usrPass" class="form-control" placeholder="${d.id ? 'নতুন পাসওয়ার্ড (পরিবর্তন না করলে খালি রাখুন)' : 'পাসওয়ার্ড *'}">
      <input type="text" id="usrDesig" class="form-control" placeholder="পদবী" value="${escapeHtml(d.designation)}">
      <select id="usrRole" class="form-control">
        <option value="super_admin" ${d.role==='super_admin'?'selected':''}>Super Admin</option>
        <option value="admin" ${d.role==='admin'?'selected':''}>Admin</option>
        <option value="moderator" ${d.role==='moderator'?'selected':''}>Moderator</option>
        <option value="editor" ${d.role==='editor'?'selected':''}>Editor</option>
        <option value="quiz_manager" ${d.role==='quiz_manager'?'selected':''}>Quiz Manager</option>
      </select>
      <div>
        <strong>ড্যাশবোর্ড এক্সেস পারমিশন:</strong>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;">
          ${allPerms.map(p => `<label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" class="usr-perm-cb" value="${p}" ${(d.permissions||[]).includes(p)?'checked':''}> ${p}</label>`).join('')}
        </div>
      </div>
      <input type="file" id="usrFile" class="form-control" accept="image/*">
      <input type="text" id="usrPhoto" class="form-control" placeholder="ছবির URL" value="${escapeHtml(d.photo)}">
      <div class="img-preview-box" id="usrPrev">${d.photo ? `<img src="${escapeHtml(d.photo)}">` : 'প্রিভিউ'}</div>
      <button class="btn btn-primary" onclick="saveAdminUser(${d.id})">সংরক্ষণ করুন</button>
    </div>
  `);
  bindAdmImagePreview('usrFile', 'usrPhoto', 'usrPrev', 'users');
}

async function saveAdminUser(id) {
  const permissions = Array.from(document.querySelectorAll('.usr-perm-cb:checked')).map(c => c.value);
  await apiFetch('admin_save_user', {
    method:'POST',
    body: JSON.stringify({
      id, name: document.getElementById('usrName').value, email: document.getElementById('usrEmail').value,
      password: document.getElementById('usrPass').value, designation: document.getElementById('usrDesig').value,
      role: document.getElementById('usrRole').value, photo: document.getElementById('usrPhoto').value,
      permissions, status: 'active'
    })
  });
  closeAdmModal(); showToast('ইউজার সংরক্ষিত হয়েছে!'); loadAdminUsers();
}

async function deleteUser(id) {
  if (!confirm('ইউজার ডিলিট করবেন?')) return;
  const r = await apiFetch('admin_delete_user', { method:'POST', body:JSON.stringify({id}) });
  if (!r.ok) showToast(r.error); else loadAdminUsers();
}

// ==========================================
// 7. NOTICES, REPORTS & SITE SETTINGS
// ==========================================
async function loadAdminNotices() {
  const res = await apiFetch('admin_notices');
  const list = res.ok ? res.notices : [];
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <h3>নোটিশ ও ঘোষণা</h3>
      <button class="btn btn-primary btn-sm" onclick="openNoticeModal()">+ নতুন নোটিশ</button>
    </div>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>শিরোনাম</th><th>বিস্তারিত</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${list.map(n => `
            <tr>
              <td><strong>${escapeHtml(n.title)}</strong></td>
              <td>${escapeHtml(n.body)}</td>
              <td><span class="status-pill ${n.is_active ? 'st-approved' : 'st-pending'}">${n.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</span></td>
              <td><button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteNotice(${n.id})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openNoticeModal() {
  openAdmModal(`
    <h3>নতুন নোটিশ</h3>
    <div style="display:grid; gap:10px; margin-top:12px;">
      <input type="text" id="ntTitle" class="form-control" placeholder="নোটিশ শিরোনাম *">
      <textarea id="ntBody" class="form-control" rows="3" placeholder="বিস্তারিত..."></textarea>
      <button class="btn btn-primary" onclick="saveNotice()">প্রকাশ করুন</button>
    </div>
  `);
}

async function saveNotice() {
  await apiFetch('admin_save_notice', {
    method:'POST',
    body: JSON.stringify({ id:0, title: document.getElementById('ntTitle').value, body: document.getElementById('ntBody').value, priority:'high', is_active:1 })
  });
  closeAdmModal(); showToast('নোটিশ প্রকাশিত হয়েছে!'); loadAdminNotices();
}

async function deleteNotice(id) {
  await apiFetch('admin_delete_notice', { method:'POST', body:JSON.stringify({id}) });
  loadAdminNotices();
}

async function loadAdminReports() {
  const res = await apiFetch('admin_reports');
  const list = res.ok ? res.reports : [];
  document.getElementById('adminContent').innerHTML = `
    <h3 style="margin-bottom:12px;">রিপোর্ট ও কন্টাক্ট বার্তা</h3>
    <div class="data-table-wrap">
      <table>
        <thead><tr><th>প্রেরক</th><th>বিষয় ও বার্তা</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead>
        <tbody>
          ${list.map(r => `
            <tr>
              <td><strong>${escapeHtml(r.reporter_name)}</strong><br><small>${escapeHtml(r.reporter_contact)}</small></td>
              <td><strong>${escapeHtml(r.subject)}</strong><br>${escapeHtml(r.message)}</td>
              <td><span class="status-pill st-${r.status}">${r.status}</span></td>
              <td>${r.status==='pending' ? `<button class="btn btn-primary btn-sm" onclick="resolveReport(${r.id})">সমাধান</button>` : 'সমাধানকৃত'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function resolveReport(id) {
  await apiFetch('admin_update_report', { method:'POST', body:JSON.stringify({id, status:'resolved'}) });
  loadAdminReports();
}

async function loadAdminSettings() {
  const res = await apiFetch('admin_get_settings');
  const s = res.ok ? res.settings : {};
  document.getElementById('adminContent').innerHTML = `
    <div style="background:#fff; padding:22px; border-radius:16px; border:1px solid var(--border); max-width:760px;">
      <h3 style="margin-bottom:14px;">ওয়েবসাইটের তথ্য ও সিস্টেম সেটিংস</h3>
      <div style="display:grid; gap:10px;">
        <label>সাইটের নাম (বাংলা)</label>
        <input type="text" id="stNameBn" class="form-control" value="${escapeHtml(s.site_name_bn || '')}">
        <label>সাইটের নাম (ইংরেজি)</label>
        <input type="text" id="stNameEn" class="form-control" value="${escapeHtml(s.site_name_en || '')}">
        <label>স্লোগান (লোডার ও হেডার)</label>
        <input type="text" id="stSlogan" class="form-control" value="${escapeHtml(s.slogan || '')}">
        <label>টাইম লক পিন (Admin Security PIN)</label>
        <input type="text" id="stPin" class="form-control" value="${escapeHtml(s.time_lock_pin || '1971')}">
        <label>যোগাযোগ ফোন ও ইমেইল</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <input type="text" id="stPhone" class="form-control" value="${escapeHtml(s.contact_phone || '')}">
          <input type="text" id="stEmail" class="form-control" value="${escapeHtml(s.contact_email || '')}">
        </div>
        <label>ঠিকানা</label>
        <input type="text" id="stAddr" class="form-control" value="${escapeHtml(s.contact_address || '')}">
        <label>আমাদের সম্পর্কে (Hero Text)</label>
        <textarea id="stAbout" class="form-control" rows="3">${escapeHtml(s.about_text || '')}</textarea>
        <label>লোগো URL</label>
        <input type="text" id="stLogo" class="form-control" value="${escapeHtml(s.logo_url || '')}">
        <label>ফুটার টেক্সট</label>
        <input type="text" id="stFooter" class="form-control" value="${escapeHtml(s.footer_text || '')}">
        <button class="btn btn-primary" onclick="saveSiteSettings()">সেটিংস সংরক্ষণ করুন</button>
      </div>
    </div>
  `;
}

async function saveSiteSettings() {
  await apiFetch('admin_save_settings', {
    method:'POST',
    body: JSON.stringify({
      site_name_bn: document.getElementById('stNameBn').value,
      site_name_en: document.getElementById('stNameEn').value,
      slogan: document.getElementById('stSlogan').value,
      time_lock_pin: document.getElementById('stPin').value,
      contact_phone: document.getElementById('stPhone').value,
      contact_email: document.getElementById('stEmail').value,
      contact_address: document.getElementById('stAddr').value,
      about_text: document.getElementById('stAbout').value,
      logo_url: document.getElementById('stLogo').value,
      footer_text: document.getElementById('stFooter').value
    })
  });
  showToast('ওয়েবসাইটের তথ্য আপডেট হয়েছে!');
}

function quickViewProfile(p) {
  openAdmModal(`
    <div style="text-align:center;">
      <img src="${escapeHtml(p.photo || 'assets/images/logo.png')}" style="width:96px; height:96px; border-radius:50%; object-fit:cover; border:3px solid var(--primary);">
      <h3 style="margin-top:8px;">${escapeHtml(p.name)}</h3>
      <div style="color:var(--primary); font-weight:700;">SSC ${escapeHtml(p.ssc_batch)} • ${escapeHtml(p.profession)}</div>
    </div>
    <div style="margin-top:12px; font-size:0.92rem; display:grid; gap:6px;">
      <div><strong>শিক্ষাগত যোগ্যতা:</strong> ${escapeHtml(p.education)}</div>
      <div><strong>ব্লাড গ্রুপ:</strong> ${escapeHtml(p.blood_group || '-')}</div>
      <div><strong>বর্তমান ঠিকানা:</strong> ${escapeHtml(p.current_address)}</div>
      <div><strong>স্থায়ী ঠিকানা:</strong> ${escapeHtml(p.permanent_address)}</div>
      <div><strong>মোবাইল:</strong> ${escapeHtml(p.mobile)} | <strong>ইমেইল:</strong> ${escapeHtml(p.email)}</div>
      <div style="background:#f4f9f7; padding:10px; border-radius:8px;"><strong>স্বপ্ন:</strong> ${escapeHtml(p.future_dream)}</div>
    </div>
  `);
}
