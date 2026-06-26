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
    const message = `مرحباً، أريد الاستفسار أو طلب شراء هذا المنتج: ${productName}`;
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
    const message = `مرحباً، أريد الحصول على منتج: ${productName}`;
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










function toggleAbout() {
    const modal = document.getElementById('aboutContainer');
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}