/* ===================================================
   AquaGo – Auth Page Logic
   =================================================== */

let currentRole = 'user'; // 'user' | 'driver'
let currentTab = 'login';

// Demo accounts (matches storage.js defaults)
const DEMO_ACCOUNTS = {
    user: { phone: '+998907654321', password: '123456', role: 'user' },
    driver: { phone: '+998901234567', password: '123456', role: 'driver' }
};

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => {
    // If already logged in, redirect
    const session = DB.getCurrentUser();
    if (session) {
        redirectUser(session);
        return;
    }
});

// ---- Demo Quick Login ----
function fillDemo(type) {
    const acc = DEMO_ACCOUNTS[type];

    // Switch to correct role & login tab
    selectRole(acc.role);
    switchTab('login');

    // Fill fields
    document.getElementById('loginPhone').value = acc.phone;
    document.getElementById('loginPassword').value = acc.password;
    document.getElementById('loginError').textContent = '';

    // Animate button
    const btn = type === 'user'
        ? document.querySelector('.demo-btn.demo-user')
        : document.querySelector('.demo-btn.demo-driver');

    if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Kirilmoqda...';
        btn.disabled = true;

        setTimeout(() => {
            // Find the user in DB
            const cleanPhone = acc.phone.replace(/\s/g, '');
            const user = DB.getUserByPhone(cleanPhone);

            if (user && user.password === acc.password) {
                DB.setCurrentUser(user);
                showSuccessFlash();
                setTimeout(() => redirectUser(user), 600);
            } else {
                btn.innerHTML = originalText;
                btn.disabled = false;
                document.getElementById('loginError').textContent =
                    '❌ Demo akkaunt topilmadi – sahifani yangilang (F5)';
            }
        }, 750);
    }
}

// ---- Role Selection ----
function selectRole(role) {
    currentRole = role;
    document.getElementById('btnUser').classList.toggle('active', role === 'user');
    document.getElementById('btnDriver').classList.toggle('active', role === 'driver');

    const vehicleGroup = document.getElementById('vehicleGroup');
    if (vehicleGroup) {
        vehicleGroup.style.display = role === 'driver' ? 'flex' : 'none';
    }
}

// ---- Tab Switching ----
function switchTab(tab) {
    currentTab = tab;
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');

        const vehicleGroup = document.getElementById('vehicleGroup');
        if (vehicleGroup) {
            vehicleGroup.style.display = currentRole === 'driver' ? 'flex' : 'none';
        }
    }

    document.getElementById('loginError').textContent = '';
    document.getElementById('registerError').textContent = '';
}

// ---- Toggle Password Visibility ----
function togglePass(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

// ---- Handle Login ----
function handleLogin(e) {
    e.preventDefault();
    const errorEl = document.getElementById('loginError');
    const loader = document.getElementById('loginLoader');

    const phone = document.getElementById('loginPhone').value.trim().replace(/\s/g, '');
    const password = document.getElementById('loginPassword').value;

    if (!phone || !password) {
        errorEl.textContent = '⚠️ Telefon va parolni kiriting';
        return;
    }

    loader.classList.add('active');

    setTimeout(() => {
        loader.classList.remove('active');

        const user = DB.getUserByPhone(phone);

        if (!user) {
            errorEl.textContent = '❌ Bu telefon raqam roʻyxatdan oʻtmagan';
            shake(document.getElementById('loginForm'));
            return;
        }

        if (user.password !== password) {
            errorEl.textContent = '❌ Parol notoʻgʻri';
            shake(document.getElementById('loginForm'));
            return;
        }

        if (user.role !== currentRole) {
            const roleName = user.role === 'driver' ? 'Suvchi' : 'Mijoz';
            errorEl.textContent = `❌ Bu akkaunt ${roleName} uchun roʻyxatdan oʻtgan`;
            shake(document.getElementById('loginForm'));
            return;
        }

        // Success
        DB.setCurrentUser(user);
        showSuccessFlash();
        setTimeout(() => redirectUser(user), 600);
    }, 900);
}

// ---- Handle Register ----
function handleRegister(e) {
    e.preventDefault();
    const errorEl = document.getElementById('registerError');
    const loader = document.getElementById('registerLoader');

    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim().replace(/\s/g, '');
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    const vehicleEl = document.getElementById('regVehicle');
    const vehicle = vehicleEl ? vehicleEl.value.trim() : '';

    if (!name || !phone || !password || !password2) {
        errorEl.textContent = '⚠️ Barcha maydonlarni toʻldiring';
        return;
    }

    if (phone.length < 9) {
        errorEl.textContent = '⚠️ Notoʻgʻri telefon raqam';
        return;
    }

    if (password.length < 6) {
        errorEl.textContent = '⚠️ Parol kamida 6 ta belgidan iborat boʻlsin';
        return;
    }

    if (password !== password2) {
        errorEl.textContent = '❌ Parollar mos kelmaydi';
        shake(document.getElementById('registerForm'));
        return;
    }

    if (DB.getUserByPhone(phone)) {
        errorEl.textContent = '❌ Bu telefon raqam allaqachon roʻyxatdan oʻtgan';
        shake(document.getElementById('registerForm'));
        return;
    }

    loader.style.display = 'block';

    setTimeout(() => {
        loader.style.display = 'none';

        const newUser = {
            id: DB.generateId(),
            name,
            phone,
            password,
            vehicle: vehicle || null,
            role: currentRole,
            createdAt: Date.now(),
            todayEarnings: 0,
            completedCount: 0
        };

        DB.addUser(newUser);
        DB.setCurrentUser(newUser);

        showSuccessFlash();
        setTimeout(() => redirectUser(newUser), 600);
    }, 800);
}

// ---- Redirects ----
function redirectUser(user) {
    if (user.role === 'driver') {
        window.location.href = 'driver.html';
    } else {
        window.location.href = 'user.html';
    }
}

// ---- UI Helpers ----
function shake(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shakeAnim 0.5s ease';
    setTimeout(() => { el.style.animation = ''; }, 500);
}

function showSuccessFlash() {
    const wrapper = document.querySelector('.auth-wrapper');
    wrapper.style.boxShadow = '0 0 0 2px var(--success), 0 8px 32px rgba(34, 197, 94, 0.3)';
    setTimeout(() => { wrapper.style.boxShadow = ''; }, 700);
}

// Inject shake animation
const _authStyle = document.createElement('style');
_authStyle.textContent = `
  @keyframes shakeAnim {
    0%,100% { transform: translateX(0); }
    20%      { transform: translateX(-8px); }
    40%      { transform: translateX(8px); }
    60%      { transform: translateX(-5px); }
    80%      { transform: translateX(5px); }
  }
`;
document.head.appendChild(_authStyle);
