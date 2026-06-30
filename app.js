// Caffeine Coffee POS Application Logic
// Handles State, UI view switching, Employee Login, POS Cart operations, Loyalty Points, Database Sync, and Charts.

// ==========================================
// Safe LocalStorage Wrapper (Prevents crashes in incognito or restricted iframe environments)
// ==========================================
const safeStorage = {
    _data: {},
    getItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('LocalStorage access blocked. Using memory storage.', e);
            return this._data[key] || null;
        }
    },
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn('LocalStorage access blocked. Saving to memory storage.', e);
            this._data[key] = String(value);
            return false;
        }
    },
    removeItem(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('LocalStorage access blocked. Removing from memory storage.', e);
            delete this._data[key];
            return false;
        }
    }
};

// ==========================================
// 1. Initial State & Configuration
// ==========================================

const DEFAULT_PRODUCTS = [
    { id: 1, name: 'เอสเพรสโซ่ (Espresso)', category: 'coffee', price: 50.00, icon: '☕' },
    { id: 2, name: 'อเมริกาโน่ (Americano)', category: 'coffee', price: 50.00, icon: '☕' },
    { id: 3, name: 'คาปูชิโน่ (Cappuccino)', category: 'coffee', price: 60.00, icon: '🥛' },
    { id: 4, name: 'ลาเต้ (Latte)', category: 'coffee', price: 60.00, icon: '☕' },
    { id: 5, name: 'มอคค่า (Mocha)', category: 'coffee', price: 65.00, icon: '🍫' },
    { id: 6, name: 'มัทฉะลาเต้ (Matcha Latte)', category: 'coffee', price: 70.00, icon: '🍵' },
    { id: 7, name: 'คาราเมลมัคคิอาโต (Caramel Macchiato)', category: 'coffee', price: 75.00, icon: '🍯' },
    { id: 8, name: 'ครัวซองต์เนยสด (Butter Croissant)', category: 'bakery', price: 65.00, icon: '🥐' },
    { id: 9, name: 'เค้กช็อกโกแลตฟัดจ์ (Chocolate Fudge)', category: 'bakery', price: 85.00, icon: '🍰' },
    { id: 10, name: 'บราวนี่อัลมอนด์ (Almond Brownie)', category: 'bakery', price: 55.00, icon: '🍫' },
    { id: 11, name: 'บลูเบอร์รี่ชีสพาย (Blueberry Cheese Pie)', category: 'bakery', price: 95.00, icon: '🍰' },
    { id: 12, name: 'ครอฟเฟิลน้ำผึ้ง (Honey Croffle)', category: 'bakery', price: 45.00, icon: '🧇' }
];

const DEFAULT_EMPLOYEES = [
    { pin: '1234', name: 'สมศรี มีดี', role: 'แคชเชียร์' },
    { pin: '9999', name: 'สมชาย ผู้บริหาร', role: 'ผู้จัดการร้าน' }
];

const DEFAULT_CUSTOMERS = [
    { id: 'c1', name: 'กิตติศักดิ์ แก้วกล้า', phone: '0812345678', points: 150, created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'c2', name: 'มุกดา สุขใจ', phone: '0956789012', points: 45, created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'c3', name: 'ธนพล มั่งคั่ง', phone: '0898765432', points: 320, created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }
];

// POS System State Variables
let state = {
    currentUser: null,
    cart: [],
    selectedCustomer: null,
    usePointsRedeem: false,
    currentCategory: 'all',
    pinBuffer: '',
    paymentMethod: 'cash',
    cashReceived: 0,
    tempProduct: null, // used for modifiers modal
    selectedType: 'ร้อน',
    selectedTypeExtra: 0,
    selectedSweetness: 'หวาน 100% (หวานปกติ)',
    supabaseConfig: { url: '', key: '' },
    databaseMode: 'demo' // 'demo' or 'supabase'
};

// Supabase Client instance placeholder
let supabaseClient = null;

// Chart instance references
let salesChartInstance = null;
let categoryChartInstance = null;

// ==========================================
// 2. Database Service (Bridging Local & Supabase)
// ==========================================

const dbService = {
    async init() {
        // Load settings from SafeStorage
        const savedMode = safeStorage.getItem('db_mode');
        const savedUrl = safeStorage.getItem('supabase_url');
        const savedKey = safeStorage.getItem('supabase_key');
        
        if (savedMode) state.databaseMode = savedMode;
        if (savedUrl) state.supabaseConfig.url = savedUrl;
        if (savedKey) state.supabaseConfig.key = savedKey;
        
        // Update inputs
        document.getElementById('database-mode-select').value = state.databaseMode;
        document.getElementById('supabase-url-input').value = state.supabaseConfig.url;
        document.getElementById('supabase-key-input').value = state.supabaseConfig.key;
        
        if (state.databaseMode === 'supabase') {
            document.getElementById('supabase-config-inputs').classList.remove('hidden');
            await this.connectSupabase();
        } else {
            this.updateStatus(false, 'ทำงานในโหมดทดลองใช้ (Demo Mode)');
            // Initialize local data if empty
            if (!safeStorage.getItem('products')) safeStorage.setItem('products', JSON.stringify(DEFAULT_PRODUCTS));
            if (!safeStorage.getItem('employees')) safeStorage.setItem('employees', JSON.stringify(DEFAULT_EMPLOYEES));
            if (!safeStorage.getItem('customers')) safeStorage.setItem('customers', JSON.stringify(DEFAULT_CUSTOMERS));
            if (!safeStorage.getItem('transactions')) safeStorage.setItem('transactions', JSON.stringify([]));
        }
    },

    async connectSupabase() {
        const { url, key } = state.supabaseConfig;
        if (!url || !key) {
            this.updateStatus(false, 'กรุณากรอก URL และ Key ของ Supabase');
            return false;
        }

        try {
            if (!window.supabase) {
                throw new Error('ระบบโหลดไลบรารี Supabase CDN ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต');
            }
            supabaseClient = window.supabase.createClient(url, key);
            
            // Test connection by reading products count
            const { data, error } = await supabaseClient.from('products').select('count', { count: 'exact', head: true });
            
            if (error) throw error;
            
            this.updateStatus(true, 'เชื่อมต่อ Supabase Live Database สำเร็จ');
            return true;
        } catch (err) {
            console.error('Supabase connection error:', err);
            this.updateStatus(false, 'การเชื่อมต่อล้มเหลว: ' + err.message);
            return false;
        }
    },

    updateStatus(connected, text) {
        const indicator = document.getElementById('supabase-status-indicator');
        const statusText = document.getElementById('supabase-status-text');
        
        if (connected) {
            indicator.className = 'supabase-status connected';
            statusText.textContent = text;
        } else {
            indicator.className = 'supabase-status disconnected';
            statusText.textContent = text;
        }
    },

    // --- Core Queries ---
    async verifyEmployeePIN(pin) {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient
                    .from('employees')
                    .select('*')
                    .eq('pin', pin)
                    .single();
                
                if (error) return null;
                return data;
            } catch (err) {
                console.error(err);
                return null;
            }
        } else {
            const employees = JSON.parse(safeStorage.getItem('employees')) || DEFAULT_EMPLOYEES;
            return employees.find(emp => emp.pin === pin) || null;
        }
    },

    async getProducts() {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient.from('products').select('*');
                if (error) throw error;
                return data;
            } catch (err) {
                console.error(err);
                return DEFAULT_PRODUCTS;
            }
        } else {
            return JSON.parse(safeStorage.getItem('products')) || DEFAULT_PRODUCTS;
        }
    },

    async getCustomers() {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient.from('customers').select('*').order('name');
                if (error) throw error;
                return data;
            } catch (err) {
                console.error(err);
                return DEFAULT_CUSTOMERS;
            }
        } else {
            return JSON.parse(safeStorage.getItem('customers')) || DEFAULT_CUSTOMERS;
        }
    },

    async searchCustomerByPhone(phone) {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient
                    .from('customers')
                    .select('*')
                    .eq('phone', phone)
                    .maybeSingle();
                if (error) throw error;
                return data;
            } catch (err) {
                console.error(err);
                return null;
            }
        } else {
            const customers = JSON.parse(safeStorage.getItem('customers')) || DEFAULT_CUSTOMERS;
            return customers.find(c => c.phone === phone) || null;
        }
    },

    async createOrUpdateCustomer(customer) {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                let result;
                if (customer.id) {
                    // Update
                    const { data, error } = await supabaseClient
                        .from('customers')
                        .update({ name: customer.name, phone: customer.phone, points: customer.points })
                        .eq('id', customer.id)
                        .select()
                        .single();
                    if (error) throw error;
                    result = data;
                } else {
                    // Insert
                    const { data, error } = await supabaseClient
                        .from('customers')
                        .insert([{ name: customer.name, phone: customer.phone, points: customer.points }])
                        .select()
                        .single();
                    if (error) throw error;
                    result = data;
                }
                return result;
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดกับฐานข้อมูล Supabase: ' + err.message);
                return null;
            }
        } else {
            const customers = JSON.parse(safeStorage.getItem('customers')) || DEFAULT_CUSTOMERS;
            if (customer.id) {
                const index = customers.findIndex(c => c.id === customer.id);
                if (index !== -1) {
                    customers[index] = { ...customers[index], name: customer.name, phone: customer.phone, points: customer.points };
                }
            } else {
                customer.id = 'c_' + Date.now();
                customer.created_at = new Date().toISOString();
                customers.push(customer);
            }
            safeStorage.setItem('customers', JSON.stringify(customers));
            return customer;
        }
    },

    async getTransactions() {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient
                    .from('transactions')
                    .select('*')
                    .order('created_at', { ascending: false });
                if (error) throw error;
                return data;
            } catch (err) {
                console.error(err);
                return [];
            }
        } else {
            return JSON.parse(safeStorage.getItem('transactions')) || [];
        }
    },

    async saveTransaction(transaction) {
        if (state.databaseMode === 'supabase' && supabaseClient) {
            try {
                const { data, error } = await supabaseClient
                    .from('transactions')
                    .insert([transaction])
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดในการบันทึกคำสั่งซื้อไปยัง Supabase: ' + err.message);
                return null;
            }
        } else {
            const transactions = JSON.parse(safeStorage.getItem('transactions')) || [];
            transactions.unshift(transaction);
            safeStorage.setItem('transactions', JSON.stringify(transactions));
            return transaction;
        }
    }
};

// ==========================================
// 3. User Authentication (PIN Logic)
// ==========================================

function pressPin(num) {
    if (state.pinBuffer.length < 4) {
        state.pinBuffer += num;
        updatePinDots();
        
        if (state.pinBuffer.length === 4) {
            // Automatically trigger login on 4 digits
            setTimeout(handleLogin, 300);
        }
    }
}

function clearPin() {
    state.pinBuffer = '';
    updatePinDots();
    document.getElementById('auth-error').textContent = '';
}

function deletePin() {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    updatePinDots();
    document.getElementById('auth-error').textContent = '';
}

function updatePinDots() {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById(`dot-${i}`);
        if (i <= state.pinBuffer.length) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    }
}

async function handleLogin() {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = 'กำลังตรวจสอบ...';
    
    const employee = await dbService.verifyEmployeePIN(state.pinBuffer);
    
    if (employee) {
        state.currentUser = employee;
        
        // Update user UI
        document.getElementById('emp-avatar').textContent = employee.name.charAt(0);
        document.getElementById('emp-name').textContent = employee.name;
        document.getElementById('emp-role').textContent = employee.role;
        
        // Hide Login overlay
        document.getElementById('auth-overlay').classList.add('hidden');
        
        // Load initial system data
        clearPin();
        initPOSWorkspace();
    } else {
        errorDiv.textContent = 'รหัส PIN พนักงานไม่ถูกต้อง!';
        state.pinBuffer = '';
        updatePinDots();
        
        // Trigger small vibration/shake animation
        const card = document.querySelector('.auth-card');
        card.style.animation = 'none';
        void card.offsetWidth; // trigger reflow
        card.style.animation = 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
    }
}

function logout() {
    state.currentUser = null;
    document.getElementById('auth-overlay').classList.remove('hidden');
    clearCart();
}

// ==========================================
// 4. View Controller & Routing
// ==========================================

function switchView(viewName) {
    // Remove active from all tabs & views
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
    
    // Set active
    document.getElementById(`menu-${viewName}`).classList.add('active');
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    // View specific initializers
    if (viewName === 'pos') {
        initPOSWorkspace();
    } else if (viewName === 'dashboard') {
        renderDashboardData();
    } else if (viewName === 'customers') {
        loadMembersTable();
    } else if (viewName === 'transactions') {
        loadTransactionsTable();
    }
}

// ==========================================
// 5. POS Catalog & Cart Operations
// ==========================================

let allProducts = [];

async function initPOSWorkspace() {
    allProducts = await dbService.getProducts();
    renderProductsGrid();
    renderCart();
    
    // Custom header subtitle with greeting based on time
    const subtitle = document.getElementById('pos-subtitle');
    const hour = new Date().getHours();
    let greet = 'อรุณสวัสดิ์ยามเช้า เสิร์ฟกาแฟหอมกรุ่นกันเถอะ';
    if (hour >= 12 && hour < 17) greet = 'ยินดีต้อนรับยามบ่าย เติมพลังด้วยลาเต้เย็นๆ กันดีไหม';
    if (hour >= 17) greet = 'เปิดร้านยามเย็น พร้อมบริการเบเกอรี่แสนอร่อย';
    subtitle.textContent = greet;
}

function filterCategory(category) {
    state.currentCategory = category;
    document.querySelectorAll('#category-tabs .category-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Highlight correct tab
    if (category === 'all') document.querySelectorAll('#category-tabs .category-tab')[0].classList.add('active');
    else if (category === 'coffee') document.querySelectorAll('#category-tabs .category-tab')[1].classList.add('active');
    else if (category === 'bakery') document.querySelectorAll('#category-tabs .category-tab')[2].classList.add('active');
    
    renderProductsGrid();
}

function renderProductsGrid() {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';
    
    const filtered = allProducts.filter(p => state.currentCategory === 'all' || p.category === state.currentCategory);
    
    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">ไม่พบข้อมูลสินค้า</div>`;
        return;
    }
    
    filtered.forEach(p => {
        const card = document.createElement('div');
        card.className = 'product-card bounce-in';
        card.onclick = () => selectProduct(p);
        
        card.innerHTML = `
            <div class="product-image-container">
                ${p.icon || '☕'}
                <span class="product-category-tag ${p.category}">
                    ${p.category === 'coffee' ? 'กาแฟ' : 'เบเกอรี่'}
                </span>
            </div>
            <div class="product-name">${p.name}</div>
            <div class="product-price">฿${parseFloat(p.price).toFixed(2)}</div>
        `;
        grid.appendChild(card);
    });
}

function selectProduct(product) {
    if (product.category === 'coffee') {
        // Open options modifiers modal for coffee
        state.tempProduct = product;
        state.selectedType = 'ร้อน';
        state.selectedTypeExtra = 0;
        state.selectedSweetness = 'หวาน 100% (หวานปกติ)';
        
        // Reset active modifier btns
        document.querySelectorAll('#mod-group-type .option-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('opt-type-hot').classList.add('active');
        
        document.querySelectorAll('#mod-group-sweet .option-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('opt-sweet-100').classList.add('active');
        
        document.getElementById('mod-product-name').textContent = product.name;
        document.getElementById('modifier-modal').classList.add('active');
    } else {
        // Direct add to cart for bakery
        addToCart(product, 'ทั่วไป', 0, '');
    }
}

function selectTypeOption(type, extraCost) {
    state.selectedType = type;
    state.selectedTypeExtra = extraCost;
    
    document.querySelectorAll('#mod-group-type .option-btn').forEach(b => b.classList.remove('active'));
    if (type === 'ร้อน') document.getElementById('opt-type-hot').classList.add('active');
    if (type === 'เย็น') document.getElementById('opt-type-iced').classList.add('active');
    if (type === 'ปั่น') document.getElementById('opt-type-blended').classList.add('active');
}

function selectSweetOption(sweet) {
    state.selectedSweetness = sweet;
    
    document.querySelectorAll('#mod-group-sweet .option-btn').forEach(b => b.classList.remove('active'));
    if (sweet.includes('0%')) document.getElementById('opt-sweet-0').classList.add('active');
    if (sweet.includes('25%')) document.getElementById('opt-sweet-25').classList.add('active');
    if (sweet.includes('50%')) document.getElementById('opt-sweet-50').classList.add('active');
    if (sweet.includes('100%')) document.getElementById('opt-sweet-100').classList.add('active');
}

function closeModifierModal() {
    document.getElementById('modifier-modal').classList.remove('active');
    state.tempProduct = null;
}

function confirmProductModifiers() {
    if (!state.tempProduct) return;
    
    const modifierText = `${state.selectedType} / ${state.selectedSweetness}`;
    addToCart(state.tempProduct, state.selectedType, state.selectedTypeExtra, modifierText);
    closeModifierModal();
}

function addToCart(product, serveType, extraCost, modifierText) {
    const itemPrice = parseFloat(product.price) + parseFloat(extraCost);
    
    // Check if matching item is already in cart
    const existingIndex = state.cart.findIndex(item => 
        item.product.id === product.id && 
        item.serveType === serveType && 
        item.modifierText === modifierText
    );
    
    if (existingIndex !== -1) {
        state.cart[existingIndex].quantity += 1;
    } else {
        state.cart.push({
            id: 'cart_' + Date.now(),
            product: product,
            serveType: serveType,
            modifierText: modifierText,
            price: itemPrice,
            quantity: 1
        });
    }
    
    renderCart();
}

function updateCartQuantity(cartItemId, amount) {
    const index = state.cart.findIndex(i => i.id === cartItemId);
    if (index === -1) return;
    
    state.cart[index].quantity += amount;
    if (state.cart[index].quantity <= 0) {
        state.cart.splice(index, 1);
    }
    renderCart();
}

function removeFromCart(cartItemId) {
    state.cart = state.cart.filter(i => i.id !== cartItemId);
    renderCart();
}

function clearCart() {
    state.cart = [];
    state.selectedCustomer = null;
    state.usePointsRedeem = false;
    
    const cb = document.getElementById('use-points-checkbox');
    if (cb) cb.checked = false;
    
    const phoneInput = document.getElementById('customer-search-phone');
    if (phoneInput) phoneInput.value = '';
    
    const searchContainer = document.getElementById('loyalty-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');
    
    const activeUser = document.getElementById('loyalty-active-user');
    if (activeUser) activeUser.classList.add('hidden');
    
    renderCart();
}

function renderCart() {
    const cartContainer = document.getElementById('cart-items');
    if (!cartContainer) return;
    
    cartContainer.innerHTML = '';
    
    if (state.cart.length === 0) {
        cartContainer.innerHTML = `
            <div class="empty-cart-state">
                <i class="fa-solid fa-shopping-basket"></i>
                <p>ยังไม่มีสินค้าในตะกร้า</p>
            </div>
        `;
        
        document.getElementById('cart-subtotal').textContent = '฿0.00';
        document.getElementById('cart-total').textContent = '฿0.00';
        document.getElementById('discount-row').style.display = 'none';
        document.getElementById('checkout-btn').disabled = true;
        document.getElementById('earn-points-alert').classList.add('hidden');
        
        // Hide points box
        document.getElementById('redeem-points-box').classList.add('hidden');
        return;
    }
    
    let subtotal = 0;
    
    state.cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        
        const row = document.createElement('div');
        row.className = 'cart-item bounce-in';
        row.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.product.name}</div>
                ${item.modifierText ? `<div class="cart-item-modifiers">${item.modifierText}</div>` : ''}
                <div class="cart-item-price">฿${itemTotal.toFixed(2)}</div>
            </div>
            <div class="cart-item-actions">
                <div class="quantity-controller">
                    <button class="quantity-btn" onclick="updateCartQuantity('${item.id}', -1)">-</button>
                    <span class="quantity-val">${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateCartQuantity('${item.id}', 1)">+</button>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">ลบออก</button>
            </div>
        `;
        cartContainer.appendChild(row);
    });
    
    // Points deduction logic
    let discount = 0;
    if (state.selectedCustomer && state.usePointsRedeem) {
        // Redeem 100 points = 50 Baht
        if (state.selectedCustomer.points >= 100) {
            discount = 50.00;
        } else {
            // Uncheck if points became insufficient
            state.usePointsRedeem = false;
            const cb = document.getElementById('use-points-checkbox');
            if (cb) cb.checked = false;
        }
    }
    
    const grandTotal = Math.max(0, subtotal - discount);
    
    // Earned points: 1 point for every 10 baht of grandTotal
    const earnedPoints = Math.floor(grandTotal / 10);
    
    document.getElementById('cart-subtotal').textContent = `฿${subtotal.toFixed(2)}`;
    
    if (discount > 0) {
        document.getElementById('discount-row').style.display = 'flex';
        document.getElementById('cart-discount').textContent = `-฿${discount.toFixed(2)}`;
    } else {
        document.getElementById('discount-row').style.display = 'none';
    }
    
    document.getElementById('cart-total').textContent = `฿${grandTotal.toFixed(2)}`;
    document.getElementById('checkout-btn').disabled = false;
    
    // Update earned points notification
    if (state.selectedCustomer) {
        document.getElementById('earn-points-alert').classList.remove('hidden');
        document.getElementById('earned-points-value').textContent = earnedPoints;
        
        // Show redeem points box
        document.getElementById('redeem-points-box').classList.remove('hidden');
        const cbLabel = document.querySelector('.redeem-toggle span');
        if (cbLabel) {
            cbLabel.textContent = `ใช้ 100 แต้ม แลกส่วนลด 50 บาท (มี ${state.selectedCustomer.points} แต้ม)`;
        }
        
        // Disable checkbox if customer points < 100
        const cb = document.getElementById('use-points-checkbox');
        if (cb) {
            if (state.selectedCustomer.points < 100) {
                cb.disabled = true;
                cb.checked = false;
            } else {
                cb.disabled = false;
            }
        }
    } else {
        document.getElementById('earn-points-alert').classList.add('hidden');
        document.getElementById('redeem-points-box').classList.add('hidden');
    }
}

// ==========================================
// 6. Loyalty Point Customer Actions
// ==========================================

async function searchLoyaltyCustomer() {
    const phoneInput = document.getElementById('customer-search-phone').value.trim();
    if (!phoneInput) {
        alert('กรุณากรอกเบอร์โทรศัพท์ของลูกค้า!');
        return;
    }
    
    const customer = await dbService.searchCustomerByPhone(phoneInput);
    
    if (customer) {
        state.selectedCustomer = customer;
        
        // Update Cart Loyalty section
        document.getElementById('loyalty-search-container').classList.add('hidden');
        document.getElementById('loyalty-active-user').classList.remove('hidden');
        document.getElementById('active-customer-name').textContent = customer.name;
        document.getElementById('active-customer-points').textContent = `แต้มสะสมคงเหลือ: ${customer.points} แต้ม`;
        
        // Recalculate cart
        renderCart();
    } else {
        // Customer not found, ask if they want to create one
        const registerNew = confirm(`ไม่พบสมาชิกเบอร์โทร ${phoneInput} ในระบบ\nต้องการลงทะเบียนสมาชิกใหม่ใช่หรือไม่?`);
        if (registerNew) {
            switchView('customers');
            document.getElementById('customer-phone-input').value = phoneInput;
            document.getElementById('customer-name-input').focus();
        }
    }
}

function removeLoyaltyCustomer() {
    state.selectedCustomer = null;
    state.usePointsRedeem = false;
    
    const cb = document.getElementById('use-points-checkbox');
    if (cb) cb.checked = false;
    
    const phoneInput = document.getElementById('customer-search-phone');
    if (phoneInput) phoneInput.value = '';
    
    document.getElementById('loyalty-search-container').classList.remove('hidden');
    document.getElementById('loyalty-active-user').classList.add('hidden');
    
    renderCart();
}

function togglePointsRedemption() {
    const cb = document.getElementById('use-points-checkbox');
    if (cb) {
        state.usePointsRedeem = cb.checked;
        renderCart();
    }
}

// ==========================================
// 7. Checkout & Receipt Management
// ==========================================

function openPaymentModal() {
    const subtotalStr = document.getElementById('cart-total').textContent.replace('฿', '');
    const grandTotal = parseFloat(subtotalStr);
    
    state.cashReceived = 0;
    document.getElementById('cash-received-input').value = '';
    document.getElementById('cash-change-display').textContent = '฿0.00';
    document.getElementById('payment-total-display').textContent = `฿${grandTotal.toFixed(2)}`;
    
    // Default payment method
    selectPaymentMethod('cash');
    
    document.getElementById('payment-modal').classList.add('active');
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.remove('active');
}

function selectPaymentMethod(method) {
    state.paymentMethod = method;
    
    document.querySelectorAll('#payment-modal .option-btn').forEach(btn => btn.classList.remove('active'));
    
    const cashSection = document.getElementById('cash-calculator-section');
    
    if (method === 'cash') {
        document.getElementById('pay-cash-btn').classList.add('active');
        if (cashSection) cashSection.style.display = 'block';
        document.getElementById('confirm-payment-btn').disabled = true; // wait for cash input
    } else {
        if (method === 'qr') document.getElementById('pay-qr-btn').classList.add('active');
        if (method === 'card') document.getElementById('pay-card-btn').classList.add('active');
        if (cashSection) cashSection.style.display = 'none';
        document.getElementById('confirm-payment-btn').disabled = false; // direct confirm
    }
}

function quickCash(amount) {
    const input = document.getElementById('cash-received-input');
    if (!input) return;
    const currentVal = parseFloat(input.value) || 0;
    input.value = currentVal + amount;
    calculateChange();
}

function calculateChange() {
    const totalEl = document.getElementById('cart-total');
    const inputEl = document.getElementById('cash-received-input');
    if (!totalEl || !inputEl) return;
    
    const grandTotal = parseFloat(totalEl.textContent.replace('฿', ''));
    const inputVal = parseFloat(inputEl.value) || 0;
    
    state.cashReceived = inputVal;
    
    const change = inputVal - grandTotal;
    const confirmBtn = document.getElementById('confirm-payment-btn');
    
    if (change >= 0) {
        document.getElementById('cash-change-display').textContent = `฿${change.toFixed(2)}`;
        confirmBtn.disabled = false;
    } else {
        document.getElementById('cash-change-display').textContent = 'เงินสดไม่พอชำระ';
        confirmBtn.disabled = true;
    }
}

async function processCheckout() {
    const subtotal = parseFloat(document.getElementById('cart-subtotal').textContent.replace('฿', ''));
    const discount = parseFloat((document.getElementById('cart-discount').textContent || '0').replace('-฿', '').replace('฿', '')) || 0;
    const total = parseFloat(document.getElementById('cart-total').textContent.replace('฿', ''));
    
    const pointsEarned = state.selectedCustomer ? Math.floor(total / 10) : 0;
    const pointsRedeemed = state.selectedCustomer && state.usePointsRedeem ? 100 : 0;
    
    const transactionId = 'TX-' + Math.floor(100000 + Math.random() * 900000);
    const dateNow = new Date().toISOString();
    
    const paymentMethodsTh = {
        'cash': 'เงินสด',
        'qr': 'QR Code',
        'card': 'บัตรเครดิต'
    };
    
    // Create transaction object
    const transaction = {
        id: transactionId,
        created_at: dateNow,
        employee_name: state.currentUser ? state.currentUser.name : 'ทั่วไป',
        customer_name: state.selectedCustomer ? state.selectedCustomer.name : null,
        customer_phone: state.selectedCustomer ? state.selectedCustomer.phone : null,
        subtotal: subtotal,
        discount: discount,
        total: total,
        points_earned: pointsEarned,
        points_redeemed: pointsRedeemed,
        payment_method: paymentMethodsTh[state.paymentMethod],
        items: JSON.stringify(state.cart)
    };
    
    // Save to DB
    await dbService.saveTransaction(transaction);
    
    // Handle customer points update
    if (state.selectedCustomer) {
        // Calculate new points
        let updatedPoints = state.selectedCustomer.points - pointsRedeemed + pointsEarned;
        
        state.selectedCustomer.points = updatedPoints;
        await dbService.createOrUpdateCustomer(state.selectedCustomer);
    }
    
    // Prepare receipt modal UI
    document.getElementById('receipt-bill-id').textContent = `#${transactionId}`;
    document.getElementById('receipt-time').textContent = new Date(dateNow).toLocaleString('th-TH');
    document.getElementById('receipt-cashier').textContent = transaction.employee_name;
    
    const custRow = document.getElementById('receipt-customer-row');
    if (state.selectedCustomer) {
        custRow.style.display = 'flex';
        document.getElementById('receipt-customer').textContent = `${state.selectedCustomer.name} (${state.selectedCustomer.phone})`;
    } else {
        custRow.style.display = 'none';
    }
    
    // Render list items in receipt
    const itemsList = document.getElementById('receipt-items-list');
    itemsList.innerHTML = '';
    state.cart.forEach(item => {
        const itemRow = document.createElement('div');
        itemRow.className = 'receipt-item-row';
        itemRow.innerHTML = `
            <span>${item.product.name} (x${item.quantity}) ${item.serveType !== 'ทั่วไป' ? `<br><small style="color:var(--text-muted);">${item.modifierText}</small>` : ''}</span>
            <span>฿${(item.price * item.quantity).toFixed(2)}</span>
        `;
        itemsList.appendChild(itemRow);
    });
    
    document.getElementById('receipt-payment-method').textContent = transaction.payment_method;
    document.getElementById('receipt-grand-total').textContent = `฿${total.toFixed(2)}`;
    
    const cashRecRow = document.getElementById('receipt-cash-received-row');
    const changeRow = document.getElementById('receipt-change-row');
    
    if (state.paymentMethod === 'cash') {
        if (cashRecRow) cashRecRow.style.display = 'flex';
        if (changeRow) changeRow.style.display = 'flex';
        document.getElementById('receipt-cash-received').textContent = `฿${state.cashReceived.toFixed(2)}`;
        const change = state.cashReceived - total;
        document.getElementById('receipt-change').textContent = `฿${change.toFixed(2)}`;
    } else {
        if (cashRecRow) cashRecRow.style.display = 'none';
        if (changeRow) changeRow.style.display = 'none';
    }
    
    const ptsSection = document.getElementById('receipt-points-section');
    if (state.selectedCustomer) {
        ptsSection.style.display = 'flex';
        document.getElementById('receipt-points-summary').textContent = `+${pointsEarned} แต้ม (ยอดคงเหลือ: ${state.selectedCustomer.points} แต้ม)`;
    } else {
        ptsSection.style.display = 'none';
    }
    
    // Close payment modal, Open receipt modal
    closePaymentModal();
    document.getElementById('receipt-modal-overlay').classList.add('active');
}

function closeReceiptAndReset() {
    document.getElementById('receipt-modal-overlay').classList.remove('active');
    clearCart();
}

// ==========================================
// 8. Members Management (Loyalty CRM)
// ==========================================

let allMembers = [];

async function loadMembersTable() {
    allMembers = await dbService.getCustomers();
    renderMembersTable(allMembers);
}

function renderMembersTable(members) {
    const tbody = document.getElementById('members-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (members.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">ไม่พบข้อมูลสมาชิก</td></tr>`;
        return;
    }
    
    members.forEach(member => {
        const tr = document.createElement('tr');
        const regDate = member.created_at ? new Date(member.created_at).toLocaleDateString('th-TH') : '-';
        tr.innerHTML = `
            <td style="font-weight:600;">${member.name}</td>
            <td>${member.phone}</td>
            <td style="font-weight:700; color:var(--matcha);"><i class="fa-solid fa-star" style="font-size:12px; margin-right:4px;"></i>${member.points}</td>
            <td>${regDate}</td>
            <td>
                <button class="clear-cart-btn" style="color: var(--primary-light); margin-right: 12px; font-weight:600;" onclick="editCustomer('${member.id}')"><i class="fa-solid fa-edit"></i> แก้ไข</button>
                <button class="clear-cart-btn" style="color: var(--danger); font-weight:600;" onclick="deleteCustomer('${member.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function searchMembers() {
    const query = document.getElementById('member-search-input').value.toLowerCase().trim();
    if (!query) {
        renderMembersTable(allMembers);
        return;
    }
    
    const filtered = allMembers.filter(m => 
        m.name.toLowerCase().includes(query) || 
        m.phone.includes(query)
    );
    renderMembersTable(filtered);
}

async function handleCustomerSubmit(event) {
    event.preventDefault();
    
    const id = document.getElementById('customer-id-input').value;
    const name = document.getElementById('customer-name-input').value.trim();
    const phone = document.getElementById('customer-phone-input').value.trim();
    const points = parseInt(document.getElementById('customer-points-input').value) || 0;
    
    // Check if phone unique (only for new customer)
    if (!id) {
        const exists = allMembers.some(m => m.phone === phone);
        if (exists) {
            alert('เบอร์โทรศัพท์นี้ลงทะเบียนในระบบแล้ว!');
            return;
        }
    }
    
    const customer = { name, phone, points };
    if (id) customer.id = id;
    
    const saved = await dbService.createOrUpdateCustomer(customer);
    if (saved) {
        resetCustomerForm();
        loadMembersTable();
    }
}

function editCustomer(id) {
    const member = allMembers.find(m => m.id === id);
    if (!member) return;
    
    document.getElementById('customer-id-input').value = member.id;
    document.getElementById('customer-name-input').value = member.name;
    document.getElementById('customer-phone-input').value = member.phone;
    document.getElementById('customer-points-input').value = member.points;
    
    document.getElementById('customer-form-title').textContent = 'แก้ไขข้อมูลสมาชิก';
    document.getElementById('customer-form-btn').textContent = 'บันทึกการแก้ไข';
    document.getElementById('customer-form-cancel-btn').classList.remove('hidden');
}

async function deleteCustomer(id) {
    if (!confirm('ยืนยันที่จะลบสมาชิกท่านนี้ออกจากระบบ?')) return;
    
    if (state.databaseMode === 'supabase' && supabaseClient) {
        const { error } = await supabaseClient.from('customers').delete().eq('id', id);
        if (error) {
            alert('ลบข้อมูลไม่สำเร็จ: ' + error.message);
            return;
        }
    } else {
        let list = JSON.parse(safeStorage.getItem('customers')) || DEFAULT_CUSTOMERS;
        list = list.filter(c => c.id !== id);
        safeStorage.setItem('customers', JSON.stringify(list));
    }
    loadMembersTable();
}

function resetCustomerForm() {
    document.getElementById('customer-id-input').value = '';
    document.getElementById('customer-name-input').value = '';
    document.getElementById('customer-phone-input').value = '';
    document.getElementById('customer-points-input').value = '0';
    
    document.getElementById('customer-form-title').textContent = 'สมัครสมาชิกใหม่';
    document.getElementById('customer-form-btn').textContent = 'บันทึกข้อมูล';
    document.getElementById('customer-form-cancel-btn').classList.add('hidden');
}

// ==========================================
// 9. Transaction History Views
// ==========================================

async function loadTransactionsTable() {
    const list = await dbService.getTransactions();
    const tbody = document.getElementById('transactions-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">ยังไม่มีประวัติการขายสินค้า</td></tr>`;
        return;
    }
    
    list.forEach(tx => {
        const tr = document.createElement('tr');
        const dateStr = new Date(tx.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
        const customerName = tx.customer_name ? `${tx.customer_name} (${tx.customer_phone})` : '-';
        
        tr.innerHTML = `
            <td style="font-weight: 600;">#${tx.id}</td>
            <td>${dateStr}</td>
            <td>${tx.employee_name}</td>
            <td>${customerName}</td>
            <td style="font-weight: 700; color: var(--primary-light);">฿${parseFloat(tx.total).toFixed(2)}</td>
            <td style="color: var(--danger); font-weight: 500;">${tx.points_redeemed > 0 ? `฿${parseFloat(tx.discount).toFixed(2)} (-${tx.points_redeemed}แต้ม)` : '-'}</td>
            <td style="color: var(--matcha); font-weight: 500;">${tx.points_earned > 0 ? `+${tx.points_earned} แต้ม` : '-'}</td>
            <td>
                <button class="clear-cart-btn" style="color: var(--primary);" onclick="viewReceiptDetail('${tx.id}')"><i class="fa-solid fa-eye"></i> ดูใบเสร็จ</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function viewReceiptDetail(txId) {
    const transactions = await dbService.getTransactions();
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;
    
    // Set up receipt details Modal
    document.getElementById('receipt-bill-id').textContent = `#${tx.id}`;
    document.getElementById('receipt-time').textContent = new Date(tx.created_at).toLocaleString('th-TH');
    document.getElementById('receipt-cashier').textContent = tx.employee_name;
    
    const custRow = document.getElementById('receipt-customer-row');
    if (tx.customer_name) {
        custRow.style.display = 'flex';
        document.getElementById('receipt-customer').textContent = `${tx.customer_name} (${tx.customer_phone})`;
    } else {
        custRow.style.display = 'none';
    }
    
    // Parse items
    const itemsList = document.getElementById('receipt-items-list');
    itemsList.innerHTML = '';
    try {
        const items = JSON.parse(tx.items);
        items.forEach(item => {
            const itemRow = document.createElement('div');
            itemRow.className = 'receipt-item-row';
            itemRow.innerHTML = `
                <span>${item.product.name} (x${item.quantity}) ${item.serveType !== 'ทั่วไป' ? `<br><small style="color:var(--text-muted);">${item.modifierText}</small>` : ''}</span>
                <span>฿${(item.price * item.quantity).toFixed(2)}</span>
            `;
            itemsList.appendChild(itemRow);
        });
    } catch(e) {
        console.error(e);
    }
    
    document.getElementById('receipt-payment-method').textContent = tx.payment_method;
    document.getElementById('receipt-grand-total').textContent = `฿${parseFloat(tx.total).toFixed(2)}`;
    
    // Hide received / change details since it's historical view
    document.getElementById('receipt-cash-received-row').style.display = 'none';
    document.getElementById('receipt-change-row').style.display = 'none';
    
    const ptsSection = document.getElementById('receipt-points-section');
    if (tx.customer_name) {
        ptsSection.style.display = 'flex';
        document.getElementById('receipt-points-summary').textContent = `+${tx.points_earned} แต้ม / ส่วนลด: -${tx.points_redeemed} แต้ม`;
    } else {
        ptsSection.style.display = 'none';
    }
    
    document.getElementById('receipt-modal-overlay').classList.add('active');
}

// ==========================================
// 10. Settings & Database Management
// ==========================================

function toggleDatabaseMode() {
    const val = document.getElementById('database-mode-select').value;
    const configDiv = document.getElementById('supabase-config-inputs');
    
    if (val === 'supabase') {
        configDiv.classList.remove('hidden');
    } else {
        configDiv.classList.add('hidden');
    }
}

async function saveSupabaseSettings() {
    const url = document.getElementById('supabase-url-input').value.trim();
    const key = document.getElementById('supabase-key-input').value.trim();
    const mode = document.getElementById('database-mode-select').value;
    
    if (mode === 'supabase' && (!url || !key)) {
        alert('กรุณากรอก Supabase URL และ Anon Key ให้ครบถ้วน!');
        return;
    }
    
    state.databaseMode = mode;
    state.supabaseConfig.url = url;
    state.supabaseConfig.key = key;
    
    safeStorage.setItem('db_mode', mode);
    safeStorage.setItem('supabase_url', url);
    safeStorage.setItem('supabase_key', key);
    
    await dbService.init();
    alert('บันทึกการตั้งค่าฐานข้อมูลสำเร็จ!');
    
    // Reload catalog/state
    initPOSWorkspace();
}

function clearAllData() {
    if (!confirm('คุณแน่ใจว่าต้องการล้างข้อมูลทั้งหมดในระบบ รวมถึงประวัติการสั่งซื้อและสถิติ? (ข้อมูล LocalStorage จะถูกลบทั้งหมด)')) return;
    
    safeStorage.removeItem('products');
    safeStorage.removeItem('customers');
    safeStorage.removeItem('transactions');
    
    // re-init
    dbService.init();
    initPOSWorkspace();
    alert('ล้างข้อมูลระบบเรียบร้อยแล้ว!');
}

async function generateMockSalesData() {
    // Generate transactions for the last 7 days to display charts
    const transactions = [];
    const products = await dbService.getProducts();
    const employees = ['สมศรี มีดี', 'สมชาย ผู้บริหาร'];
    const customerNames = ['นภาพร ตั้งมั่น', 'กมล สมบูรณ์', 'ธีรยุทธ เรืองงาม', 'สมหมาย รื่นเริง'];
    const customerPhones = ['0821234567', '0912223344', '0887778899', '0901112233'];
    
    // Create mock customers in DB if demo mode
    const customers = JSON.parse(safeStorage.getItem('customers')) || [];
    if (customers.length < 5) {
        for (let i = 0; i < customerNames.length; i++) {
            customers.push({
                id: 'mock_c_' + i,
                name: customerNames[i],
                phone: customerPhones[i],
                points: Math.floor(Math.random() * 200),
                created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
            });
        }
        safeStorage.setItem('customers', JSON.stringify(customers));
    }
    
    // Create transaction loop for 7 days
    const dayMil = 24 * 60 * 60 * 1000;
    
    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
        const dayTime = Date.now() - dayOffset * dayMil;
        // 5 to 15 transactions per day
        const numTx = 5 + Math.floor(Math.random() * 10);
        
        for (let t = 0; t < numTx; t++) {
            // Random hour
            const txTime = new Date(dayTime);
            txTime.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
            
            // Random cart items
            const mockCart = [];
            const numItems = 1 + Math.floor(Math.random() * 3);
            let subtotal = 0;
            
            for (let i = 0; i < numItems; i++) {
                const prod = products[Math.floor(Math.random() * products.length)];
                const isCoffee = prod.category === 'coffee';
                const serveTypes = ['ร้อน', 'เย็น', 'ปั่น'];
                const serveType = isCoffee ? serveTypes[Math.floor(Math.random() * 3)] : 'ทั่วไป';
                const extra = serveType === 'เย็น' ? 5 : (serveType === 'ปั่น' ? 10 : 0);
                const sweet = isCoffee ? 'หวาน 100% (หวานปกติ)' : '';
                
                const itemPrice = parseFloat(prod.price) + extra;
                const quantity = 1 + Math.floor(Math.random() * 2);
                
                mockCart.push({
                    id: 'mock_cart_' + Math.random(),
                    product: prod,
                    serveType: serveType,
                    modifierText: isCoffee ? `${serveType} / ${sweet}` : '',
                    price: itemPrice,
                    quantity: quantity
                });
                
                subtotal += itemPrice * quantity;
            }
            
            const hasCust = Math.random() > 0.4;
            let cust = null;
            if (hasCust && customers.length > 0) {
                cust = customers[Math.floor(Math.random() * customers.length)];
            }
            
            const pointsEarned = cust ? Math.floor(subtotal / 10) : 0;
            const pointsRedeemed = (cust && cust.points > 100 && Math.random() > 0.7) ? 100 : 0;
            const discount = pointsRedeemed > 0 ? 50 : 0;
            const total = Math.max(0, subtotal - discount);
            
            const pMethods = ['เงินสด', 'QR Code', 'บัตรเครดิต'];
            
            transactions.push({
                id: 'TX-' + Math.floor(100000 + Math.random() * 900000),
                created_at: txTime.toISOString(),
                employee_name: employees[Math.floor(Math.random() * employees.length)],
                customer_name: cust ? cust.name : null,
                customer_phone: cust ? cust.phone : null,
                subtotal: subtotal,
                discount: discount,
                total: total,
                points_earned: pointsEarned,
                points_redeemed: pointsRedeemed,
                payment_method: pMethods[Math.floor(Math.random() * 3)],
                items: JSON.stringify(mockCart)
            });
            
            // Adjust customer points in local array
            if (cust) {
                cust.points = cust.points - pointsRedeemed + pointsEarned;
            }
        }
    }
    
    if (state.databaseMode === 'supabase') {
        alert('ระบบจะสร้างข้อมูลตัวอย่างใน LocalStorage เท่านั้น กรุณาใช้ Demo Mode เพื่อทดสอบ Dashboard ที่สมบูรณ์แบบ');
        return;
    }
    
    // Save to SafeStorage
    safeStorage.setItem('transactions', JSON.stringify(transactions));
    safeStorage.setItem('customers', JSON.stringify(customers));
    
    alert('สร้างข้อมูลรายงานจำลองสำเร็จ! กรุณาเปิดหน้าแดชบอร์ดเพื่อดูสรุปรายงาน');
    
    // Refresh stats if on dashboard
    if (document.getElementById('view-dashboard').classList.contains('active')) {
        renderDashboardData();
    }
}

// ==========================================
// 11. Dashboard Analytics & Reports (Chart.js)
// ==========================================

async function renderDashboardData() {
    const transactions = await dbService.getTransactions();
    const customers = await dbService.getCustomers();
    
    // 1. Calculate Today's Stats
    const today = new Date().toDateString();
    
    const todayTX = transactions.filter(t => new Date(t.created_at).toDateString() === today);
    const todaySales = todayTX.reduce((sum, t) => sum + parseFloat(t.total), 0);
    const totalPoints = customers.reduce((sum, c) => sum + (c.points || 0), 0);
    
    const salesValEl = document.getElementById('dashboard-today-sales');
    if (salesValEl) salesValEl.textContent = `฿${todaySales.toFixed(2)}`;
    
    const ordersValEl = document.getElementById('dashboard-today-orders');
    if (ordersValEl) ordersValEl.textContent = `${todayTX.length} ออเดอร์`;
    
    const pointsValEl = document.getElementById('dashboard-total-points');
    if (pointsValEl) pointsValEl.textContent = `${totalPoints} แต้ม`;
    
    const customersValEl = document.getElementById('dashboard-total-customers');
    if (customersValEl) customersValEl.textContent = `${customers.length} คน`;
    
    // 2. Prepare daily sales chart data for past 7 days
    const dailySales = {};
    const categoriesSales = { coffee: 0, bakery: 0 };
    
    // Initialize past 7 days
    const daysTh = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const dateLabels = [];
    const dayKeys = [];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dateLabels.push(daysTh[d.getDay()]);
        dayKeys.push(d.toDateString());
        dailySales[d.toDateString()] = 0;
    }
    
    transactions.forEach(t => {
        const txDate = new Date(t.created_at).toDateString();
        if (txDate in dailySales) {
            dailySales[txDate] += parseFloat(t.total);
        }
        
        try {
            const items = JSON.parse(t.items);
            items.forEach(item => {
                const category = item.product.category;
                const cost = parseFloat(item.price) * item.quantity;
                if (category in categoriesSales) {
                    categoriesSales[category] += cost;
                }
            });
        } catch(e) {
            console.error(e);
        }
    });
    
    const chartSalesData = dayKeys.map(k => dailySales[k]);
    
    // Render Line Chart
    const lineCanvas = document.getElementById('salesLineChart');
    if (lineCanvas && window.Chart) {
        const ctxLine = lineCanvas.getContext('2d');
        if (salesChartInstance) salesChartInstance.destroy();
        
        salesChartInstance = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [{
                    label: 'ยอดขายรายวัน (บาท)',
                    data: chartSalesData,
                    borderColor: '#8C6239',
                    backgroundColor: 'rgba(212, 163, 115, 0.1)',
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: '#4A3525'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#EFECE6' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
    
    // Render Pie Chart
    const pieCanvas = document.getElementById('categoryPieChart');
    if (pieCanvas && window.Chart) {
        const ctxPie = pieCanvas.getContext('2d');
        if (categoryChartInstance) categoryChartInstance.destroy();
        
        const pieDataValues = [categoriesSales.coffee, categoriesSales.bakery];
        const totalCatSales = pieDataValues[0] + pieDataValues[1];
        
        categoryChartInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: ['กาแฟ (Coffee)', 'เบเกอรี่ (Bakery)'],
                datasets: [{
                    data: totalCatSales === 0 ? [1, 1] : pieDataValues,
                    backgroundColor: ['#6F4E37', '#D4A373'],
                    borderWidth: 2,
                    borderColor: '#FFF'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 15 }
                    }
                },
                cutout: '60%'
            }
        });
    }
}

// ==========================================
// 12. App Initialization & Explicit Global Assignments
// ==========================================

window.addEventListener('DOMContentLoaded', async () => {
    try {
        await dbService.init();
    } catch (e) {
        console.error('Initialization failed:', e);
    }
});

// Explicitly assign all template click handlers to window object 
// to ensure they are available regardless of module scopes or browser strict security rules.
window.pressPin = pressPin;
window.clearPin = clearPin;
window.deletePin = deletePin;
window.switchView = switchView;
window.logout = logout;
window.filterCategory = filterCategory;
window.clearCart = clearCart;
window.searchLoyaltyCustomer = searchLoyaltyCustomer;
window.removeLoyaltyCustomer = removeLoyaltyCustomer;
window.togglePointsRedemption = togglePointsRedemption;
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.selectPaymentMethod = selectPaymentMethod;
window.quickCash = quickCash;
window.calculateChange = calculateChange;
window.processCheckout = processCheckout;
window.closeReceiptAndReset = closeReceiptAndReset;
window.searchMembers = searchMembers;
window.handleCustomerSubmit = handleCustomerSubmit;
window.resetCustomerForm = resetCustomerForm;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.viewReceiptDetail = viewReceiptDetail;
window.toggleDatabaseMode = toggleDatabaseMode;
window.saveSupabaseSettings = saveSupabaseSettings;
window.generateMockSalesData = generateMockSalesData;
window.selectTypeOption = selectTypeOption;
window.selectSweetOption = selectSweetOption;
window.confirmProductModifiers = confirmProductModifiers;
window.closeModifierModal = closeModifierModal;
window.updateCartQuantity = updateCartQuantity;
window.removeFromCart = removeFromCart;
window.clearAllData = clearAllData;
