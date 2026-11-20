const STORE = {
  whatsapp: '201091076268',
  adminEmail: 'eh1329706@gmail.com',
  reviewsDbUrl: 'https://new-life-reviews-default-rtdb.firebaseio.com/reviews.json',
  aiEndpoint:
    window.location.hostname.includes('ai.studio') || window.location.hostname === 'localhost'
      ? '/api/ai/chat'
      : 'https://newlife2026.ai.studio/api/ai/chat',
};

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDniNOwD6Rt3AiW6X4xD2R16YA-DD5m31k',
  authDomain: 'boxwood-yolk-zvc14.firebaseapp.com',
  projectId: 'boxwood-yolk-zvc14',
  storageBucket: 'boxwood-yolk-zvc14.firebasestorage.app',
  messagingSenderId: '696217937992',
  appId: '1:696217937992:web:a278af9bc92ebc0902107d',
};

const CATEGORY_SHORT = {
  'group-kitchen': 'الرفايع والمطبخ',
  'group-plastics': 'البلاستيكات',
  'group-glass': 'الزجاج والخزفيات',
  'group-distribution': 'التوزيع والحوافظ',
  'group-sets': 'الأطقم الفاخرة',
  'group-appliances': 'الأجهزة الكهربائية',
};

const TICKER_ITEMS = [
  'أدوات منزلية أصلية',
  'أجهزة كهربائية بضمان',
  'تجهيز العرائس بالكامل',
  'اطلب مباشرة عبر واتساب',
  'سجين الكوم - مركز قطور',
  'أسعار مناسبة وجودة مضمونة',
];

let fbAuth = null;
let fbDb = null;
let fbGoogleProvider = null;
let fbApi = null;
let firebaseInitPromise = null;
let unsubUserWishlist = null;
let unsubUserViewed = null;

const state = {
  activeTab: 'store',
  activeCategory: 'all',
  searchQuery: '',
  websiteGroups: [],
  firestoreProducts: [],
  mergedGroups: [],
  user: null,
  isAdmin: false,
  wishlist: loadLocal('nl_wishlist', []),
  viewedHistory: loadLocal('nl_viewed', []),
  reviews: [],
  chatMessages: loadLocal('nl_chat', [
    {
      role: 'assistant',
      text: 'أهلاً بك في معرض نيو لايف! اسألني عن أي منتج أو خامة أو جهاز عروسة وهساعدك فوراً.',
    },
  ]),
  chatBusy: false,
  ownerSection: 'products',
  ownerSearch: '',
  customers: [],
};

// Utilities
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeArabic(input) {
  return String(input || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .toLowerCase()
    .trim();
}

function toDocId(rawKey) {
  let hash1 = 2166136261;
  let hash2 = 0x811c9dc5;
  for (let i = 0; i < rawKey.length; i++) {
    const code = rawKey.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 16777619);
    hash2 ^= code + i;
    hash2 = Math.imul(hash2, 16777619);
  }
  const h1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  return `item_${h1}${h2}`;
}

function resolveImg(img) {
  const clean = String(img || '').trim();
  if (!clean) return './Logo.png';
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('/products/')) return `.${clean}`;
  if (clean === '/Logo.png') return './Logo.png';
  if (clean.startsWith('./')) return clean;
  return `./products/${clean}`;
}

function buildWaUrl(text) {
  return `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(text)}`;
}

function productKey(groupId, p) {
  return `${groupId}::${p.orderName || p.title}`;
}

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore quota limits
  }
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toastBox');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// Navigation
function switchTab(tab) {
  state.activeTab = tab;
  ['store', 'chat', 'account', 'admin'].forEach((t) => {
    const section = document.getElementById(`view-${t}`);
    if (section) section.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    if (btn.classList.contains('nav-link') || btn.classList.contains('mobile-tab')) {
      btn.classList.toggle('active', btn.dataset.nav === tab);
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'chat') renderChat();
  if (tab === 'account') renderAccount();
  if (tab === 'admin') renderOwnerDashboard();
}

// Catalog Merge (base JSON + live Firestore edits/hides)
function rebuildMergedGroups() {
  const overrideMap = new Map();
  for (const fp of state.firestoreProducts) {
    const k = fp.targetKey || `${fp.groupId}::${normalizeArabic(fp.title)}`;
    overrideMap.set(k, fp);
  }

  const groupMap = new Map();
  for (const g of state.websiteGroups) {
    groupMap.set(g.id, { id: g.id, title: g.title, products: [] });
  }

  const consumed = new Set();
  const seen = new Set();

  for (const g of state.websiteGroups) {
    for (const p of g.products || []) {
      const origKey = `${g.id}::${normalizeArabic(p.title)}`;
      const ov = overrideMap.get(origKey);
      if (ov) {
        consumed.add(origKey);
        if (ov.hidden) continue;
        const target = groupMap.get(ov.groupId) || {
          id: ov.groupId,
          title: ov.groupTitle,
          products: [],
        };
        groupMap.set(ov.groupId, target);
        const mk = `${ov.groupId}::${normalizeArabic(ov.title)}`;
        if (!seen.has(mk)) {
          seen.add(mk);
          target.products.push({
            badge: ov.badge || null,
            img: ov.img,
            title: ov.title,
            desc: ov.desc,
            orderName: ov.orderName || ov.title,
          });
        }
      } else {
        if (!seen.has(origKey)) {
          seen.add(origKey);
          groupMap.get(g.id).products.push(p);
        }
      }
    }
  }

  for (const fp of state.firestoreProducts) {
    const k = fp.targetKey || `${fp.groupId}::${normalizeArabic(fp.title)}`;
    if (consumed.has(k) || fp.hidden) continue;
    const target = groupMap.get(fp.groupId) || {
      id: fp.groupId,
      title: fp.groupTitle,
      products: [],
    };
    groupMap.set(fp.groupId, target);
    const key = `${fp.groupId}::${normalizeArabic(fp.title)}`;
    if (!seen.has(key)) {
      seen.add(key);
      target.products.unshift({
        badge: fp.badge || null,
        img: fp.img,
        title: fp.title,
        desc: fp.desc,
        orderName: fp.orderName || fp.title,
      });
    }
  }

  state.mergedGroups = Array.from(groupMap.values()).filter((g) => g.products.length > 0);
  const total = state.mergedGroups.reduce((a, g) => a + g.products.length, 0);
  document.getElementById('heroProductsCount').textContent = String(total);
  renderCategories();
  renderCatalog();
  if (state.activeTab === 'admin') renderOwnerProducts();
}

async function fetchBaseCatalog() {
  if (Array.isArray(window.__NEWLIFE_CATALOG__) && window.__NEWLIFE_CATALOG__.length > 0) {
    state.websiteGroups = window.__NEWLIFE_CATALOG__;
    rebuildMergedGroups();
  }
  if (window.location.protocol === 'file:') {
    return;
  }
  try {
    const res = await fetch(`./products-data.json?v=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load products-data.json');
    const arr = await res.json();
    state.websiteGroups = Array.isArray(arr) ? arr : arr.groups || [];
    rebuildMergedGroups();
  } catch (err) {
    console.error(err);
    if (!state.websiteGroups.length) {
      showToast('تعذّر تحميل ملف المنتجات');
    }
  }
}

async function initFirebaseAndSync() {
  if (window.location.protocol === 'file:') {
    return;
  }
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'),
    ]);
    const fbApp = appMod.initializeApp(FIREBASE_CONFIG);
    fbAuth = authMod.getAuth(fbApp);
    fbGoogleProvider = new authMod.GoogleAuthProvider();
    fbGoogleProvider.setCustomParameters({ prompt: 'select_account' });
    fbDb = fsMod.initializeFirestore(
      fbApp,
      { experimentalAutoDetectLongPolling: true },
      'ai-studio-1a346769-e469-490d-acfe-3d9acd64ccf7',
    );
    fbApi = { ...authMod, ...fsMod };

    fbApi.getRedirectResult(fbAuth).catch((err) => {
      if (err && err.code) {
        console.warn('Redirect sign-in note:', err.code, err.message);
      }
    });

    fbApi.onAuthStateChanged(fbAuth, async (user) => {
      state.user = user;
      let isOwner =
        !!user?.email &&
        user.emailVerified === true &&
        user.email.toLowerCase() === STORE.adminEmail.toLowerCase();

      if (user && !isOwner) {
        try {
          const adminSnap = await fbApi.getDoc(fbApi.doc(fbDb, 'admins', user.uid));
          isOwner = adminSnap.exists();
        } catch {
          isOwner = false;
        }
      }
      state.isAdmin = isOwner;

      document.getElementById('navAdminDesktop').classList.toggle('hidden', !state.isAdmin);
      document.getElementById('navAdminMobile').classList.toggle('hidden', !state.isAdmin);
      document.getElementById('navAdminFooter')?.classList.toggle('hidden', !state.isAdmin);
      document.getElementById('mobileNav').classList.toggle('has-admin', state.isAdmin);
      document.getElementById('heroAccountBtn').textContent = user
        ? 'قائمتي وسجل المشاهدات'
        : 'دخول العملاء وحفظ القائمة';

      if (unsubUserWishlist) {
        unsubUserWishlist();
        unsubUserWishlist = null;
      }
      if (unsubUserViewed) {
        unsubUserViewed();
        unsubUserViewed = null;
      }

      if (user) {
        await syncCustomerSummary();

        unsubUserWishlist = fbApi.onSnapshot(
          fbApi.query(
            fbApi.collection(fbDb, 'customers', user.uid, 'wishlist'),
            fbApi.orderBy('createdAt', 'desc'),
          ),
          (snap) => {
            state.wishlist = snap.docs.map((d) => {
              const data = d.data();
              return {
                groupId: String(data.groupId || 'group-appliances'),
                groupTitle: String(data.groupTitle || 'منتجات المعرض'),
                product: {
                  title: String(data.title || ''),
                  desc: String(data.desc || ''),
                  img: String(data.img || ''),
                  orderName: String(data.orderName || data.title || ''),
                },
              };
            });
            updateWishBadges();
            renderCatalog();
            if (state.activeTab === 'account') renderAccount();
          },
          () => {},
        );

        unsubUserViewed = fbApi.onSnapshot(
          fbApi.query(
            fbApi.collection(fbDb, 'customers', user.uid, 'viewedHistory'),
            fbApi.orderBy('lastViewedAt', 'desc'),
          ),
          (snap) => {
            state.viewedHistory = snap.docs.map((d) => {
              const data = d.data();
              return {
                groupId: String(data.groupId || 'group-appliances'),
                groupTitle: String(data.groupTitle || 'منتجات المعرض'),
                product: {
                  title: String(data.title || ''),
                  desc: String(data.desc || ''),
                  img: String(data.img || ''),
                  orderName: String(data.orderName || data.title || ''),
                },
              };
            });
            if (state.activeTab === 'account') renderAccount();
          },
          () => {},
        );
      } else {
        state.wishlist = loadLocal('nl_wishlist', []);
        state.viewedHistory = loadLocal('nl_viewed', []);
        updateWishBadges();
        renderCatalog();
      }

      if (state.activeTab === 'account') renderAccount();
      if (state.activeTab === 'admin') renderOwnerDashboard();
    });

    fbApi.onSnapshot(
      fbApi.query(fbApi.collection(fbDb, 'products'), fbApi.orderBy('updatedAt', 'desc')),
      (snap) => {
        state.firestoreProducts = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.title);
        rebuildMergedGroups();
      },
      () => {},
    );
  } catch (err) {
    console.warn('Firebase sync unavailable:', err);
  }
}

async function signInWithGoogleWebsite() {
  if (window.location.protocol === 'file:') {
    showToast('تسجيل الدخول يعمل عند فتح الموقع عبر رابط استضافة (مثل GitHub Pages)');
    return;
  }
  if (firebaseInitPromise) {
    await firebaseInitPromise;
  }
  if (!fbAuth || !fbApi || !fbGoogleProvider) {
    showToast('جاري تحميل نظام تسجيل الدخول، حاول مرة أخرى بعد لحظة');
    return;
  }
  try {
    await fbApi.signInWithPopup(fbAuth, fbGoogleProvider);
    showToast('تم تسجيل الدخول بنجاح');
  } catch (err) {
    const code = err?.code || '';
    console.error('Website Google sign-in error:', code, err);
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      try {
        await fbApi.signInWithRedirect(fbAuth, fbGoogleProvider);
        return;
      } catch (redirErr) {
        console.error('Redirect sign-in error:', redirErr);
      }
    }
    if (code === 'auth/unauthorized-domain') {
      showToast(
        `أضف الدومين (${window.location.hostname}) داخل Firebase Authentication -> Authorized domains`,
      );
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      showToast('تم إغلاق نافذة تسجيل الدخول');
      return;
    }
    showToast(`تعذّر تسجيل الدخول (${code || 'تأكد من إعدادات Firebase'})`);
  }
}

// Render Categories & Store Grid
function renderCategories() {
  const container = document.getElementById('categoryTabs');
  const total = state.mergedGroups.reduce((a, g) => a + g.products.length, 0);
  let html = `<button type="button" class="cat-btn ${
    state.activeCategory === 'all' ? 'active' : ''
  }" data-cat="all">الكل (${total})</button>`;

  for (const g of state.mergedGroups) {
    const label = CATEGORY_SHORT[g.id] || g.title.replace('مجموعة ', '');
    html += `<button type="button" class="cat-btn ${
      state.activeCategory === g.id ? 'active' : ''
    }" data-cat="${escapeHtml(g.id)}">${escapeHtml(label)} (${g.products.length})</button>`;
  }
  container.innerHTML = html;
}

function renderCatalog() {
  const container = document.getElementById('catalogContainer');
  const q = normalizeArabic(state.searchQuery);
  const savedSet = new Set(state.wishlist.map((w) => productKey(w.groupId, w.product)));

  const filtered = state.mergedGroups
    .filter((g) => state.activeCategory === 'all' || g.id === state.activeCategory)
    .map((g) => ({
      ...g,
      products: g.products.filter(
        (p) => !q || normalizeArabic(`${p.title} ${p.desc}`).includes(q),
      ),
    }))
    .filter((g) => g.products.length > 0);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="card empty-box">
        <h3 style="margin:0">مفيش نتائج مطابقة لـ «${escapeHtml(state.searchQuery)}»</h3>
        <p style="font-size:13px; color:var(--muted)">ابعت اسم المنتج للحج حسام على واتساب وهنوفّره لك بأفضل سعر.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:14px">
          <button type="button" class="btn btn-navy" id="emptyAskAiBtn">ابحث بالمساعد الذكي</button>
          <a class="btn btn-whatsapp" target="_blank" rel="noopener noreferrer"
             href="${buildWaUrl(`مرحباً أيها الحج حسام، أبحث عن هذا المنتج: "${state.searchQuery}" — هل متوفر؟`)}">
            اطلب توفير المنتج واتساب
          </a>
        </div>
      </div>`;
    document.getElementById('emptyAskAiBtn')?.addEventListener('click', () => {
      document.getElementById('chatInput').value = state.searchQuery;
      switchTab('chat');
      sendChat(state.searchQuery);
    });
    return;
  }

  container.innerHTML = filtered
    .map(
      (g) => `
      <section class="group-section">
        <div class="group-header">
          <h2 class="group-title">${escapeHtml(g.title)}</h2>
          <span class="group-count">${g.products.length} منتج</span>
        </div>
        <div class="products-grid">
          ${g.products
            .map((p) => {
              const id = productKey(g.id, p);
              const isSaved = savedSet.has(id);
              const imgSrc = resolveImg(p.img);
              const waUrl = buildWaUrl(
                `مرحباً أيها الحج حسام، عايز أستفسر عن سعر وتوفر: ${p.orderName || p.title}`,
              );
              return `
                <article class="product-card" data-gid="${escapeHtml(g.id)}" data-title="${escapeHtml(p.title)}">
                  <div class="product-media" data-action="detail">
                    ${p.badge ? `<span class="product-badge">${escapeHtml(p.badge)}</span>` : ''}
                    <button type="button" class="wish-btn ${isSaved ? 'saved' : ''}" data-action="wish" aria-label="حفظ في المفضلة">
                      ${isSaved ? '♥' : '♡'}
                    </button>
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.src='./Logo.png'" />
                  </div>
                  <div class="product-body">
                    <h3 class="product-title" data-action="detail">${escapeHtml(p.title)}</h3>
                    <p class="product-desc">${escapeHtml(p.desc)}</p>
                    <div class="product-actions">
                      <button type="button" class="btn btn-light" data-action="detail">تفاصيل</button>
                      <a class="btn btn-whatsapp" href="${waUrl}" target="_blank" rel="noopener noreferrer">واتساب</a>
                    </div>
                  </div>
                </article>`;
            })
            .join('')}
        </div>
      </section>`,
    )
    .join('');
}

function findProductEntry(groupId, title) {
  const g = state.mergedGroups.find((grp) => grp.id === groupId);
  if (!g) return null;
  const p = g.products.find((prod) => prod.title === title);
  return p ? { groupId: g.id, groupTitle: g.title, product: p } : null;
}

// Product Modal
function openProductModal(entry) {
  recordView(entry);
  const modal = document.getElementById('productModal');
  const body = document.getElementById('productModalBody');
  const waUrl = buildWaUrl(
    `مرحباً أيها الحج حسام، عايز أطلب أو أستفسر عن: ${entry.product.orderName || entry.product.title}`,
  );
  const isSaved = state.wishlist.some(
    (w) => productKey(w.groupId, w.product) === productKey(entry.groupId, entry.product),
  );
  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
      <span style="font-size:12px; font-weight:700; color:var(--muted)">${escapeHtml(entry.groupTitle)}</span>
      <button type="button" id="closeModalBtn" class="btn btn-light" style="min-height:36px; padding:4px 12px">✕</button>
    </div>
    <div style="background:var(--canvas); border-radius:16px; padding:16px; display:flex; justify-content:center; margin-bottom:14px">
      <img src="${escapeHtml(resolveImg(entry.product.img))}" alt="${escapeHtml(entry.product.title)}" style="max-height:240px; object-fit:contain" onerror="this.src='./Logo.png'" />
    </div>
    <h2 style="margin:0; font-size:18px; font-weight:800">${escapeHtml(entry.product.title)}</h2>
    <p style="margin:10px 0 18px; font-size:13px; color:var(--muted); white-space:pre-line">${escapeHtml(entry.product.desc)}</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap">
      <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="flex:1">اطلب عبر واتساب</a>
      <button type="button" id="modalWishBtn" class="btn btn-navy">${isSaved ? 'إزالة من المفضلة' : 'إضافة للمفضلة ♥'}</button>
    </div>
  `;
  modal.classList.remove('hidden');
  document.getElementById('closeModalBtn').onclick = () => modal.classList.add('hidden');
  document.getElementById('modalWishBtn').onclick = () => {
    toggleWishlist(entry.groupId, entry.groupTitle, entry.product);
    openProductModal(entry);
  };
}

// Wishlist & Viewed History (Local + Firestore sync when signed in)
async function syncCustomerSummary() {
  if (!state.user || !fbDb || !fbApi) return;
  const ref = fbApi.doc(fbDb, 'customers', state.user.uid);
  const safeName = String(
    state.user.displayName || state.user.email?.split('@')[0] || 'عميل نيو لايف',
  ).slice(0, 120);
  const safeEmail = String(state.user.email || '').slice(0, 160);
  const safePhoto = String(state.user.photoURL || '').slice(0, 500);
  try {
    const snap = await fbApi.getDoc(ref);
    if (!snap.exists()) {
      await fbApi.setDoc(ref, {
        uid: state.user.uid,
        displayName: safeName,
        email: safeEmail,
        photoURL: safePhoto,
        wishlistCount: state.wishlist.length,
        viewedCount: state.viewedHistory.length,
        createdAt: fbApi.serverTimestamp(),
        lastActiveAt: fbApi.serverTimestamp(),
      });
    } else {
      await fbApi.updateDoc(ref, {
        displayName: safeName,
        email: safeEmail,
        photoURL: safePhoto,
        wishlistCount: state.wishlist.length,
        viewedCount: state.viewedHistory.length,
        lastActiveAt: fbApi.serverTimestamp(),
      });
    }
  } catch {
    // Ignore
  }
}

async function toggleWishlist(groupId, groupTitle, product) {
  const id = productKey(groupId, product);
  const docId = toDocId(`${groupId}::${product.title}`);
  const exists = state.wishlist.some((w) => productKey(w.groupId, w.product) === id);
  if (exists) {
    state.wishlist = state.wishlist.filter((w) => productKey(w.groupId, w.product) !== id);
    showToast('تمت الإزالة من قائمتك والمفضلة');
    if (state.user && fbDb && fbApi) {
      fbApi
        .deleteDoc(fbApi.doc(fbDb, 'customers', state.user.uid, 'wishlist', docId))
        .catch(() => {});
    }
  } else {
    const entry = { groupId, groupTitle, product, addedAt: Date.now() };
    state.wishlist.unshift(entry);
    showToast('تمت الإضافة لقائمتك والمفضلة');
    if (state.user && fbDb && fbApi) {
      fbApi
        .setDoc(fbApi.doc(fbDb, 'customers', state.user.uid, 'wishlist', docId), {
          uid: state.user.uid,
          groupId: String(groupId).slice(0, 64),
          groupTitle: String(groupTitle).slice(0, 120),
          title: String(product.title).slice(0, 200),
          desc: String(product.desc || '').slice(0, 2500),
          img: String(product.img || '').slice(0, 1000),
          orderName: String(product.orderName || product.title).slice(0, 200),
          createdAt: fbApi.serverTimestamp(),
        })
        .catch(() => {});
    }
  }
  saveLocal('nl_wishlist', state.wishlist);
  updateWishBadges();
  renderCatalog();
  if (state.activeTab === 'account') renderAccount();
  void syncCustomerSummary();
}

async function recordView(entry) {
  const id = productKey(entry.groupId, entry.product);
  const docId = toDocId(`${entry.groupId}::${entry.product.title}`);
  const item = {
    groupId: entry.groupId,
    groupTitle: entry.groupTitle,
    product: entry.product,
    viewedAt: Date.now(),
  };
  state.viewedHistory = [
    item,
    ...state.viewedHistory.filter((v) => productKey(v.groupId, v.product) !== id),
  ].slice(0, 30);
  saveLocal('nl_viewed', state.viewedHistory);
  if (state.user && fbDb && fbApi) {
    try {
      const ref = fbApi.doc(fbDb, 'customers', state.user.uid, 'viewedHistory', docId);
      const snap = await fbApi.getDoc(ref);
      const payloadBase = {
        groupId: String(entry.groupId).slice(0, 64),
        groupTitle: String(entry.groupTitle).slice(0, 120),
        title: String(entry.product.title).slice(0, 200),
        desc: String(entry.product.desc || '').slice(0, 2500),
        img: String(entry.product.img || '').slice(0, 1000),
        orderName: String(entry.product.orderName || entry.product.title).slice(0, 200),
      };
      if (!snap.exists()) {
        await fbApi.setDoc(ref, {
          uid: state.user.uid,
          ...payloadBase,
          viewCount: 1,
          firstViewedAt: fbApi.serverTimestamp(),
          lastViewedAt: fbApi.serverTimestamp(),
        });
      } else {
        const prevCount = Number(snap.data()?.viewCount) || 1;
        await fbApi.updateDoc(ref, {
          ...payloadBase,
          viewCount: prevCount + 1,
          lastViewedAt: fbApi.serverTimestamp(),
        });
      }
      void syncCustomerSummary();
    } catch {
      // Ignore
    }
  }
}

function updateWishBadges() {
  const count = String(state.wishlist.length);
  document.getElementById('wishCountDesktop').textContent = count;
  document.getElementById('wishCountMobile').textContent = count;
}

// Account View
function renderAccount() {
  const authCard = document.getElementById('accountAuthCard');
  if (state.user) {
    authCard.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px">
        <div style="display:flex; align-items:center; gap:12px">
          <img src="${escapeHtml(state.user.photoURL || './Logo.png')}" alt="صورة الحساب" style="width:48px; height:48px; border-radius:999px; object-fit:cover; border:1px solid var(--line)" />
          <div>
            <strong style="font-size:15px">${escapeHtml(state.user.displayName || 'عميل نيو لايف')}</strong>
            <div style="font-size:12px; color:var(--muted)">${escapeHtml(state.user.email || '')}</div>
          </div>
        </div>
        <button type="button" id="logoutBtn" class="btn btn-light">تسجيل الخروج</button>
      </div>`;
    document.getElementById('logoutBtn').onclick = () =>
      fbAuth && fbApi && fbApi.signOut(fbAuth);
  } else {
    authCard.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px">
        <div>
          <strong style="font-size:15px">سجّل دخولك بحساب Google</strong>
          <div style="font-size:12px; color:var(--muted)">احفظ قائمة العروسة والمفضلة وسجل مشاهداتك على كل أجهزتك</div>
        </div>
        <button type="button" id="loginGoogleBtn" class="btn btn-navy">تسجيل الدخول بـ Google</button>
      </div>`;
    document.getElementById('loginGoogleBtn').onclick = () => {
      void signInWithGoogleWebsite();
    };
  }

  const wishBox = document.getElementById('wishlistContainer');
  wishBox.innerHTML =
    state.wishlist.length === 0
      ? '<p style="font-size:13px; color:var(--muted)">قائمتك فارغة حالياً — اضغط على القلب ♡ لحفظ أي منتج.</p>'
      : state.wishlist
          .map(
            (w) => `
          <div class="owner-row">
            <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:180px">
              <img src="${escapeHtml(resolveImg(w.product.img))}" alt="${escapeHtml(w.product.title)}" style="width:44px; height:44px; object-fit:contain; border-radius:8px" onerror="this.src='./Logo.png'" />
              <div>
                <strong style="font-size:13px">${escapeHtml(w.product.title)}</strong>
                <div style="font-size:11px; color:var(--muted)">${escapeHtml(w.groupTitle)}</div>
              </div>
            </div>
            <button type="button" class="btn btn-light" data-remove-wish="${escapeHtml(productKey(w.groupId, w.product))}" style="min-height:36px; font-size:12px">حذف</button>
          </div>`,
          )
          .join('');

  wishBox.querySelectorAll('[data-remove-wish]').forEach((btn) => {
    btn.onclick = () => {
      const target = state.wishlist.find(
        (w) => productKey(w.groupId, w.product) === btn.dataset.removeWish,
      );
      if (target) toggleWishlist(target.groupId, target.groupTitle, target.product);
    };
  });

  const histBox = document.getElementById('viewedHistoryContainer');
  histBox.innerHTML =
    state.viewedHistory.length === 0
      ? '<p style="font-size:13px; color:var(--muted)">لم تفتح تفاصيل أي منتج بعد.</p>'
      : state.viewedHistory
          .slice(0, 10)
          .map(
            (v) => `
          <div class="owner-row">
            <div style="display:flex; align-items:center; gap:10px">
              <img src="${escapeHtml(resolveImg(v.product.img))}" alt="${escapeHtml(v.product.title)}" style="width:40px; height:40px; object-fit:contain; border-radius:8px" onerror="this.src='./Logo.png'" />
              <strong style="font-size:13px">${escapeHtml(v.product.title)}</strong>
            </div>
          </div>`,
          )
          .join('');
}

// Reviews
async function fetchReviews() {
  try {
    const res = await fetch(STORE.reviewsDbUrl);
    if (!res.ok) return;
    const data = (await res.json()) || {};
    state.reviews = Object.entries(data)
      .map(([id, val]) => ({ id, ...val }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderReviews();
  } catch {
    // Ignore
  }
}

function renderReviews() {
  document.getElementById('reviewsCountBadge').textContent = `${state.reviews.length} تقييم`;
  const list = document.getElementById('reviewsList');
  list.innerHTML =
    state.reviews.length === 0
      ? '<div class="review-item">لا توجد تقييمات بعد — كن أول من يشارك رأيه!</div>'
      : state.reviews
          .slice(0, 12)
          .map((r) => {
            const stars = '★'.repeat(Number(r.rating) || 5) + '☆'.repeat(5 - (Number(r.rating) || 5));
            return `
              <div class="review-item">
                <div class="review-head">
                  <strong>${escapeHtml(r.name || 'عميل')} ${r.city ? `— <span style="font-weight:400; color:var(--muted)">${escapeHtml(r.city)}</span>` : ''}</strong>
                  <span class="stars">${stars}</span>
                </div>
                <p style="margin:0; font-size:13px; color:var(--muted)">${escapeHtml(r.comment || '')}</p>
              </div>`;
          })
          .join('');
}

// AI Chat (SSE streaming)
function formatChatMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong style="font-size:14px;display:block;margin:6px 0 4px">$1</strong>')
    .replace(/^[-*]\s+(.+)$/gm, '• $1');
}

function renderChat() {
  const box = document.getElementById('chatMessages');
  box.innerHTML = state.chatMessages
    .map((m) => {
      const matchedHtml =
        m.matchedProducts && m.matchedProducts.length
          ? `<div class="chat-products-mini">${m.matchedProducts
              .map(
                (entry) => `
              <div class="chat-mini-card" data-chat-gid="${escapeHtml(entry.groupId)}" data-chat-title="${escapeHtml(entry.product.title)}">
                <img src="${escapeHtml(resolveImg(entry.product.img))}" alt="${escapeHtml(entry.product.title)}" onerror="this.src='./Logo.png'" />
                <div style="font-size:11px; font-weight:800">${escapeHtml(entry.product.title)}</div>
              </div>`,
              )
              .join('')}</div>`
          : '';
      const waHtml = m.missingItemName
        ? `<a href="${buildWaUrl(`مرحباً إدارة معرض نيو لايف، عميل يبحث عن صنف غير موجود: ${m.missingItemName}`)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="margin-top:6px; min-height:38px; font-size:12px">إرسال طلب الصنف لواتساب الإدارة</a>`
        : '';
      return `
        <div class="msg-row ${m.role}">
          <div class="msg-bubble">${formatChatMarkdown(m.text)}</div>
          ${matchedHtml}
          ${waHtml}
        </div>`;
    })
    .join('');

  box.querySelectorAll('.chat-mini-card').forEach((card) => {
    card.onclick = () => {
      const found = findProductEntry(card.dataset.chatGid, card.dataset.chatTitle);
      if (found) openProductModal(found);
    };
  });
  box.scrollTop = box.scrollHeight;
}

async function sendChat(text) {
  const clean = String(text || '').trim();
  if (!clean || state.chatBusy) return;
  state.chatBusy = true;
  document.getElementById('chatSendBtn').disabled = true;

  state.chatMessages.push({ role: 'user', text: clean });
  const assistantMsg = { role: 'assistant', text: '...' };
  state.chatMessages.push(assistantMsg);
  renderChat();

  try {
    const res = await fetch(STORE.aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        stream: true,
        messages: state.chatMessages
          .slice(0, -1)
          .slice(-10)
          .map((m) => ({ role: m.role, text: m.text })),
        wishlistTitles: state.wishlist.map((w) => w.product.title),
      }),
    });

    const ct = res.headers.get('content-type') || '';
    if (!res.ok) throw new Error('تعذّر الاتصال بالمساعد الذكي');

    if (ct.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      let buffer = '';
      assistantMsg.text = '';

      const handleBlock = (block) => {
        const lines = block.split('\n');
        let ev = 'message';
        const dataLines = [];
        for (const l of lines) {
          if (l.startsWith('event:')) ev = l.slice(6).trim();
          else if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
        }
        if (!dataLines.length) return;
        const payload = JSON.parse(dataLines.join('\n'));
        if (ev === 'delta' && payload.text) {
          assistantMsg.text += payload.text;
          renderChat();
        } else if (ev === 'replace' && payload.text) {
          assistantMsg.text = payload.text;
          renderChat();
        } else if (ev === 'done') {
          assistantMsg.text = payload.reply || assistantMsg.text;
          assistantMsg.missingItemName = payload.missingItemName || '';
          assistantMsg.matchedProducts = (payload.matchedTitles || [])
            .map((title) => {
              for (const g of state.mergedGroups) {
                const found = g.products.find((p) => p.title === title);
                if (found) return { groupId: g.id, groupTitle: g.title, product: found };
              }
              return null;
            })
            .filter(Boolean);
          if (Array.isArray(payload.addedToWishlist) && payload.addedToWishlist.length) {
            for (const title of payload.addedToWishlist) {
              for (const g of state.mergedGroups) {
                const found = g.products.find((p) => p.title === title);
                if (found && !state.wishlist.some((w) => productKey(w.groupId, w.product) === productKey(g.id, found))) {
                  void toggleWishlist(g.id, g.title, found);
                }
              }
            }
          }
          renderChat();
        } else if (ev === 'error') {
          throw new Error(payload.error || 'خطأ في الرد');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const blk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (blk.trim()) handleBlock(blk);
          idx = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim()) handleBlock(buffer);
    } else {
      const data = await res.json();
      assistantMsg.text = data.reply || '';
      assistantMsg.missingItemName = data.missingItemName || '';
      renderChat();
    }
    saveLocal('nl_chat', state.chatMessages.slice(-20));
  } catch (err) {
    assistantMsg.text = `عذراً، تعذّر إتمام الرد الآن: ${err.message || 'حاول مرة أخرى'}`;
    renderChat();
  } finally {
    state.chatBusy = false;
    document.getElementById('chatSendBtn').disabled = false;
  }
}

// Owner Dashboard
function renderOwnerDashboard() {
  const gate = document.getElementById('ownerGateCard');
  const content = document.getElementById('ownerContent');
  gate.classList.toggle('hidden', state.isAdmin);
  content.classList.toggle('hidden', !state.isAdmin);
  if (!state.isAdmin) return;
  renderOwnerProducts();
  loadCustomers();
}

function renderOwnerProducts() {
  const listEl = document.getElementById('ownerProductsList');
  const rows = [];
  for (const g of state.mergedGroups) {
    for (const p of g.products) {
      rows.push({ groupId: g.id, groupTitle: g.title, ...p });
    }
  }
  const q = normalizeArabic(state.ownerSearch);
  const filtered = rows.filter(
    (r) => !q || normalizeArabic(`${r.title} ${r.desc}`).includes(q),
  );
  document.getElementById('ownerProductsTotal').textContent = String(rows.length);

  listEl.innerHTML = filtered
    .map(
      (r) => `
      <div class="owner-row">
        <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:160px">
          <img src="${escapeHtml(resolveImg(r.img))}" alt="${escapeHtml(r.title)}" style="width:42px; height:42px; object-fit:contain; border-radius:8px" onerror="this.src='./Logo.png'" />
          <div>
            <strong style="font-size:13px">${escapeHtml(r.title)}</strong>
            <div style="font-size:11px; color:var(--muted)">${escapeHtml(r.groupTitle)}</div>
          </div>
        </div>
        <div style="display:flex; gap:6px">
          <button type="button" class="btn btn-light" data-edit-gid="${escapeHtml(r.groupId)}" data-edit-title="${escapeHtml(r.title)}" style="min-height:34px; padding:4px 10px; font-size:11px">تعديل</button>
          <button type="button" class="btn btn-crimson" data-del-gid="${escapeHtml(r.groupId)}" data-del-title="${escapeHtml(r.title)}" style="min-height:34px; padding:4px 10px; font-size:11px">حذف</button>
        </div>
      </div>`,
    )
    .join('');

  listEl.querySelectorAll('[data-edit-title]').forEach((btn) => {
    btn.onclick = () => {
      const entry = findProductEntry(btn.dataset.editGid, btn.dataset.editTitle);
      if (!entry) return;
      document.getElementById('ownerFormHeading').textContent = `تعديل: ${entry.product.title}`;
      document.getElementById('ownerEditTargetKey').value = `${entry.groupId}::${normalizeArabic(entry.product.title)}`;
      document.getElementById('ownerProdGroup').value = entry.groupId;
      document.getElementById('ownerProdTitle').value = entry.product.title;
      document.getElementById('ownerProdDesc').value = entry.product.desc;
      document.getElementById('ownerProdImg').value = entry.product.img || '';
      document.getElementById('ownerProdBadge').value = entry.product.badge || '';
      document.getElementById('ownerCancelEditBtn').classList.remove('hidden');
    };
  });

  listEl.querySelectorAll('[data-del-title]').forEach((btn) => {
    btn.onclick = async () => {
      const targetKey = `${btn.dataset.delGid}::${normalizeArabic(btn.dataset.delTitle)}`;
      const fsExisting = state.firestoreProducts.find(
        (fp) => (fp.targetKey || `${fp.groupId}::${normalizeArabic(fp.title)}`) === targetKey,
      );
      if (!fbDb || !fbApi) return showToast('يتطلب اتصال بالإنترنت عبر استضافة الموقع');
      try {
        if (fsExisting && !state.websiteGroups.some((g) => g.products.some((p) => `${g.id}::${normalizeArabic(p.title)}` === targetKey))) {
          await fbApi.deleteDoc(fbApi.doc(fbDb, 'products', fsExisting.id));
        } else {
          const entry = findProductEntry(btn.dataset.delGid, btn.dataset.delTitle);
          const ref = fbApi.doc(fbDb, 'products', toDocId(targetKey));
          const existingSnap = await fbApi.getDoc(ref);
          const prodPayload = {
            targetKey: targetKey.slice(0, 280),
            groupId: btn.dataset.delGid,
            groupTitle: CATEGORY_SHORT[btn.dataset.delGid] || 'منتجات المعرض',
            title: String(btn.dataset.delTitle || '').slice(0, 200),
            desc: String(entry?.product.desc || '').slice(0, 2500),
            img: String(entry?.product.img || './Logo.png').slice(0, 1000),
            orderName: String(entry?.product.orderName || btn.dataset.delTitle || '').slice(0, 200),
            source: 'website',
            hidden: true,
            updatedAt: fbApi.serverTimestamp(),
          };
          if (!existingSnap.exists()) {
            await fbApi.setDoc(ref, { ...prodPayload, createdAt: fbApi.serverTimestamp() });
          } else {
            await fbApi.updateDoc(ref, prodPayload);
          }
        }
        showToast('تم حذف الصنف بنجاح');
      } catch {
        showToast('تعذّر حذف الصنف');
      }
    };
  });
}

async function loadCustomers() {
  if (!state.isAdmin || !fbDb || !fbApi) return;
  try {
    const snap = await fbApi.getDocs(
      fbApi.query(fbApi.collection(fbDb, 'customers'), fbApi.orderBy('lastActiveAt', 'desc')),
    );
    const box = document.getElementById('ownerCustomersList');
    const customers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    box.innerHTML =
      customers.length === 0
        ? '<p style="font-size:13px; color:var(--muted)">لا يوجد عملاء مسجلون بعد.</p>'
        : customers
            .map(
              (c) => `
            <div class="owner-row" style="cursor:pointer" data-cust-uid="${escapeHtml(c.uid)}">
              <div>
                <strong style="font-size:13px">${escapeHtml(c.displayName || 'عميل')}</strong>
                <div style="font-size:11px; color:var(--muted)">${escapeHtml(c.email || '')}</div>
              </div>
              <span style="font-size:11px; font-weight:700">مفضلة: ${c.wishlistCount || 0}</span>
            </div>`,
            )
            .join('');

    box.querySelectorAll('[data-cust-uid]').forEach((row) => {
      row.onclick = async () => {
        const uid = row.dataset.custUid;
        const [wSnap, vSnap] = await Promise.all([
          fbApi.getDocs(fbApi.collection(fbDb, 'customers', uid, 'wishlist')),
          fbApi.getDocs(fbApi.collection(fbDb, 'customers', uid, 'viewedHistory')),
        ]);
        const detail = document.getElementById('ownerCustomerDetail');
        detail.innerHTML = `
          <h3 style="margin:0 0 10px; font-size:15px">تفاصيل العميل</h3>
          <p style="font-size:12px; font-weight:700">المفضلة (${wSnap.size}):</p>
          <ul style="font-size:12px; color:var(--muted)">${wSnap.docs.map((d) => `<li>${escapeHtml(d.data().title || d.data().product?.title || '')}</li>`).join('')}</ul>
          <p style="font-size:12px; font-weight:700; margin-top:12px">سجل المشاهدات (${vSnap.size}):</p>
          <ul style="font-size:12px; color:var(--muted)">${vSnap.docs.map((d) => `<li>${escapeHtml(d.data().title || d.data().product?.title || '')}</li>`).join('')}</ul>
        `;
      };
    });
  } catch {
    // Ignore
  }
}

// Event Listeners & Boot
function initTicker() {
  const track = document.getElementById('tickerTrack');
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  track.innerHTML = items
    .map(
      (txt) =>
        `<span class="ticker-item"><span>${escapeHtml(txt)}</span><span class="ticker-dot">·</span></span>`,
    )
    .join('');
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      switchTab(navBtn.dataset.nav);
      return;
    }
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      state.activeCategory = catBtn.dataset.cat;
      renderCategories();
      renderCatalog();
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      sendChat(chip.dataset.chip);
      return;
    }
    const cardAction = e.target.closest('[data-action]');
    if (cardAction) {
      const card = cardAction.closest('.product-card');
      const entry = findProductEntry(card.dataset.gid, card.dataset.title);
      if (!entry) return;
      if (cardAction.dataset.action === 'wish') {
        toggleWishlist(entry.groupId, entry.groupTitle, entry.product);
      } else {
        openProductModal(entry);
      }
    }
  });

  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    clearBtn.classList.toggle('hidden', !state.searchQuery);
    renderCatalog();
  });
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.classList.add('hidden');
    renderCatalog();
  });

  document.getElementById('askAiFromSearchBtn').addEventListener('click', () => {
    const q = searchInput.value.trim();
    switchTab('chat');
    if (q) sendChat(q);
  });

  document.getElementById('refreshCatalogBtn').addEventListener('click', () => {
    void fetchBaseCatalog().then(() => showToast('تم تحديث الأصناف'));
  });

  document.getElementById('productModal').addEventListener('click', (e) => {
    if (e.target.id === 'productModal') e.target.classList.add('hidden');
  });

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const txt = input.value;
    input.value = '';
    sendChat(txt);
  });

  document.getElementById('newChatBtn').addEventListener('click', () => {
    state.chatMessages = [
      { role: 'assistant', text: 'تم بدء محادثة جديدة! كيف يمكنني مساعدتك؟' },
    ];
    saveLocal('nl_chat', state.chatMessages);
    renderChat();
  });

  document.getElementById('sendWishlistWaBtn').addEventListener('click', () => {
    if (state.wishlist.length === 0) return showToast('قائمتك فارغة');
    const listText = state.wishlist.map((w, i) => `${i + 1}. ${w.product.title}`).join('\n');
    window.open(
      buildWaUrl(`مرحباً أيها الحج حسام، هذه قائمتي من موقع نيو لايف:\n${listText}`),
      '_blank',
    );
  });

  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    state.viewedHistory = [];
    saveLocal('nl_viewed', []);
    renderAccount();
    showToast('تم مسح سجل المشاهدات');
  });

  document.getElementById('reviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('revName').value.trim(),
      city: document.getElementById('revCity').value.trim(),
      rating: Number(document.getElementById('revRating').value) || 5,
      comment: document.getElementById('revComment').value.trim(),
      createdAt: Date.now(),
    };
    try {
      await fetch(STORE.reviewsDbUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      e.target.reset();
      showToast('شكراً لتقييمك!');
      void fetchReviews();
    } catch {
      showToast('تعذّر إرسال التقييم');
    }
  });

  document.getElementById('ownerLoginBtn').addEventListener('click', () => {
    void signInWithGoogleWebsite();
  });

  document.getElementById('ownerTabProducts').addEventListener('click', () => {
    document.getElementById('ownerProductsPanel').classList.remove('hidden');
    document.getElementById('ownerCustomersPanel').classList.add('hidden');
  });

  document.getElementById('ownerTabCustomers').addEventListener('click', () => {
    document.getElementById('ownerProductsPanel').classList.add('hidden');
    document.getElementById('ownerCustomersPanel').classList.remove('hidden');
    void loadCustomers();
  });

  document.getElementById('ownerProdSearch').addEventListener('input', (e) => {
    state.ownerSearch = e.target.value;
    renderOwnerProducts();
  });

  document.getElementById('ownerCancelEditBtn').addEventListener('click', () => {
    document.getElementById('ownerProductForm').reset();
    document.getElementById('ownerEditTargetKey').value = '';
    document.getElementById('ownerFormHeading').textContent = 'إضافة صنف جديد';
    document.getElementById('ownerCancelEditBtn').classList.add('hidden');
  });

  document.getElementById('ownerProductForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.isAdmin || !fbDb || !fbApi) return;
    const groupId = document.getElementById('ownerProdGroup').value;
    const title = document.getElementById('ownerProdTitle').value.trim();
    const desc = document.getElementById('ownerProdDesc').value.trim();
    const img = document.getElementById('ownerProdImg').value.trim() || './Logo.png';
    const badge = document.getElementById('ownerProdBadge').value.trim();
    const editTarget = document.getElementById('ownerEditTargetKey').value.trim();
    const targetKey = editTarget || `${groupId}::${normalizeArabic(title)}`;

    try {
      const ref = fbApi.doc(fbDb, 'products', toDocId(targetKey));
      const existingSnap = await fbApi.getDoc(ref);
      const prodPayload = {
        targetKey: targetKey.slice(0, 280),
        groupId,
        groupTitle: CATEGORY_SHORT[groupId] || 'منتجات المعرض',
        title: title.slice(0, 200),
        desc: desc.slice(0, 2500),
        img: img.slice(0, 1000),
        badge: badge.slice(0, 40),
        orderName: title.slice(0, 200),
        hidden: false,
        source: editTarget ? 'website' : 'admin',
        updatedAt: fbApi.serverTimestamp(),
      };
      if (!existingSnap.exists()) {
        await fbApi.setDoc(ref, { ...prodPayload, createdAt: fbApi.serverTimestamp() });
      } else {
        await fbApi.updateDoc(ref, prodPayload);
      }
      e.target.reset();
      document.getElementById('ownerEditTargetKey').value = '';
      document.getElementById('ownerFormHeading').textContent = 'إضافة صنف جديد';
      document.getElementById('ownerCancelEditBtn').classList.add('hidden');
      showToast('تم حفظ الصنف ونشره فوراً');
    } catch {
      showToast('تعذّر حفظ الصنف');
    }
  });

  const scrollBtn = document.getElementById('scrollTopBtn');
  window.addEventListener('scroll', () => {
    scrollBtn.classList.toggle('hidden', window.scrollY < 450);
  });
  scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// Boot
initTicker();
bindEvents();
updateWishBadges();
void fetchBaseCatalog();
firebaseInitPromise = initFirebaseAndSync();
void fetchReviews();
