// 1. الإعدادات وتهيئة Firebase
const firebaseConfig = {
    apiKey: "هنا_ضع_الـ_API_KEY_الخاص_بمشروعك",
    authDomain: "new-life-reviews.firebaseapp.com",
    projectId: "new-life-reviews",
    storageBucket: "new-life-reviews.appspot.com",
    messagingSenderId: "رقم_الـ_Sender_Id",
    appId: "رقم_الـ_App_Id",
    databaseURL: "https://new-life-reviews-default-rtdb.firebaseio.com"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

// 2. دالة إرسال التقييم
const submitBtn = document.getElementById('submitBtn');
if (submitBtn) {
    submitBtn.addEventListener('click', function() {
        const name = document.getElementById('reviewerName').value.trim();
        const stars = parseInt(document.getElementById('reviewerStars').value);
        const text = document.getElementById('reviewerText').value.trim();
        if (name === '' || text === '') { alert('من فضلك اكتب اسمك ورأيك أولاً!'); return; }
        database.ref('reviews').push({ name, stars, text, timestamp: Date.now() }).then(() => {
            alert('تم نشر تقييمك بنجاح!');
            document.getElementById('reviewerName').value = '';
            document.getElementById('reviewerText').value = '';
        });
    });
}

// 3. قراءة وعرض التقييمات
const reviewsContainer = document.getElementById('reviewsContainer');
if (reviewsContainer) {
    database.ref('reviews').on('value', (snapshot) => {
        reviewsContainer.innerHTML = '';
        const data = snapshot.val();
        if (data) {
            Object.keys(data).reverse().forEach(key => {
                const review = data[key];
                let starsHTML = '★'.repeat(review.stars);
                const card = document.createElement('div');
                card.style.cssText = "background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); width: 280px; text-align: right; margin: 10px;";
                card.innerHTML = `<div style="color: #ffcc00; margin-bottom: 5px;">${starsHTML}</div><p style="margin: 0;">"${review.text}"</p><h4 style="margin: 10px 0 0 0;">${review.name}</h4>`;
                reviewsContainer.appendChild(card);
            });
        }
    });
}

// 4. دالة تشغيل الصور المكبرة (Lightbox) - تم توحيدها
document.querySelectorAll('.product-card img').forEach(img => {
    img.style.cursor = 'pointer'; 
    img.addEventListener('click', function() {
        const lightbox = document.getElementById('lightbox');
        const fullImg = document.getElementById('full-img');
        const lightboxDesc = document.getElementById('lightbox-description');
        
        const parentCard = this.closest('.product-card');
        const titleElem = parentCard.querySelector('h3');
        const descElem = parentCard.querySelector('p');
        
        const title = titleElem ? titleElem.innerText : "بدون عنوان";
        const description = descElem ? descElem.innerText : "لا يوجد وصف";
        
        if (lightbox && fullImg && lightboxDesc) {
            lightbox.style.display = 'flex';
            fullImg.src = this.src;
            lightboxDesc.innerHTML = `
                <h2 style="color: white; margin-bottom: 10px;">${title}</h2>
                <p style="color: #ddd; margin-bottom: 20px;">${description}</p>
                <button class="buy-btn" onclick="orderProduct('${title}')" 
                    style="background: #25d366; color: white; padding: 10px 25px; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: bold;">
                    <i class="fab fa-whatsapp"></i> اطلب الآن عبر الواتساب
                </button>
            `;
        }
    });
});

// إغلاق النافذة
const closeBtn = document.querySelector('.close-lightbox');
if (closeBtn) {
    closeBtn.addEventListener('click', () => {
        document.getElementById('lightbox').style.display = 'none';
    });
}

// 5. دالة طلب المنتج عبر الواتساب
function orderProduct(productName) {
    const phoneNumber = "201091076268"; 
    const message = `مرحباً، ايها الحج حسام اريد الاستفسار او طلب هذا المنتج : ${productName}`;
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}

// 6. دالة طلب منتج مخصص
function requestCustomProduct() {
    const input = document.getElementById('customProductName');
    const productName = input ? input.value : "";
    if (!productName || productName.trim() === "") {
        alert("من فضلك اكتب اسم المنتج الذي تبحث عنه أولاً!");
        return;
    }
    const phoneNumber = "201091076268";
    const message = `مرحباً، أريد الحصول على منتج غير موجود بالويب: ${productName}`;
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}

// 7. دالة قائمة التواصل
function toggleContactMenu() {
    const menu = document.querySelector('.contact-menu');
    if (menu) {
        menu.style.display = (menu.style.display === 'none' || menu.style.display === '') ? 'block' : 'none';
    }
}






















// ============================================================
let searchDebounceTimer = null;

function normalizeArabicText(text) {
    return text
        .replace(/[أإآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[ًٌٍَُِّْـ]/g, '')
        .toLowerCase()
        .trim();
}

function searchProducts() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        const input = document.getElementById('productSearchInput');
        const clearBtn = document.getElementById('clearSearchBtn');
        const noResultsBox = document.getElementById('noResultsBox');
        const missingProductName = document.getElementById('missingProductName');
        const resultsCount = document.getElementById('searchResultsCount');
        if (!input) return;

        const rawQuery = input.value.trim();
        if (clearBtn) clearBtn.style.display = rawQuery ? 'block' : 'none';

        if (rawQuery === '') {
            document.querySelectorAll('.product-card, .products-grid, .main-group').forEach(el => {
                el.classList.remove('search-hidden');
            });
            if (noResultsBox) noResultsBox.style.display = 'none';
            if (resultsCount) resultsCount.style.display = 'none';
            return;
        }

        const query = normalizeArabicText(rawQuery);
        let visibleCount = 0;

        document.querySelectorAll('.main-group').forEach(group => {
            let groupHasVisible = false;
            group.querySelectorAll('.product-card').forEach(card => {
                const titleEl = card.querySelector('h3');
                const descEl = card.querySelector('p');
                const title = titleEl ? normalizeArabicText(titleEl.innerText) : '';
                const desc = descEl ? normalizeArabicText(descEl.innerText) : '';
                const isMatch = title.includes(query) || desc.includes(query);
                const parentGrid = card.closest('.products-grid');

                if (isMatch) {
                    card.classList.remove('search-hidden');
                    if (parentGrid) parentGrid.classList.remove('search-hidden');
                    groupHasVisible = true;
                    visibleCount++;
                } else {
                    card.classList.add('search-hidden');
                }
            });
            group.classList.toggle('search-hidden', !groupHasVisible);
        });

        if (visibleCount === 0) {
            if (noResultsBox) noResultsBox.style.display = 'block';
            if (missingProductName) missingProductName.innerText = rawQuery;
            if (resultsCount) resultsCount.style.display = 'none';
        } else {
            if (noResultsBox) noResultsBox.style.display = 'none';
            if (resultsCount) {
                resultsCount.style.display = 'block';
                resultsCount.innerText = `تم العثور على ${visibleCount} منتج مطابق`;
            }
        }
    }, 200);
}

function clearSearch() {
    const input = document.getElementById('productSearchInput');
    if (!input) return;
    input.value = '';
    searchProducts();
    input.focus();
}

function sendMissingProductToWhatsapp() {
    const input = document.getElementById('productSearchInput');
    if (!input) return;
    const productName = input.value.trim();
    if (!productName) return;
    const phoneNumber = "201091076268";
    const message = `مرحباً، بحثت عن هذا المنتج ولم أجده في موقع نيو لايف: "${productName}" - هل يمكن توفيره؟`;
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}
