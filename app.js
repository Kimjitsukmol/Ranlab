(function(){
  // ---- Short helpers ----
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const money = (n) => "฿" + (Number(n) || 0).toFixed(2);

  // ---- Storage keys ----
  const MENU_STORAGE = "isan_menu_v1";
  const CART_KEY = "isan_pos_v1";
  const RECEIPTS_KEY = "isan_receipts_v1";
  const SALES_DAILY_KEY = "isan_sales_daily_v1";
  const SALES_MONTH_KEY = "isan_sales_month_v1";
  const PREP_KEY = "isan_prep_list_v1";

  // ---- Defensive default variables (avoid double declarations) ----
  if (typeof paymentModalEl === 'undefined') var paymentModalEl = null;
  if (typeof receiptsModal === 'undefined') var receiptsModal = null;
  if (typeof prepModal === 'undefined') var prepModal = null;

  // ---- IndexedDB for images ----
  function openDb() {
    return new Promise((resolve,reject) => {
      const req = indexedDB.open("pos-db",1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }
  async function saveImageBlob(id, blob) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction("images","readwrite");
      tx.objectStore("images").put({ id, blob });
      tx.oncomplete = () => res();
      tx.onerror = (e) => rej(e.target.error);
    });
  }
  async function getImageURL(id) {
    const db = await openDb();
    return new Promise((resolve,reject) => {
      const tx = db.transaction("images","readonly");
      const req = tx.objectStore("images").get(id);
      req.onsuccess = (e) => {
        const rec = e.target.result;
        if (!rec) return resolve(null);
        const url = URL.createObjectURL(rec.blob);
        resolve(url);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }
  async function deleteImage(id) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction("images","readwrite");
      tx.objectStore("images").delete(id);
      tx.oncomplete = () => res();
      tx.onerror = (e) => rej(e.target.error);
    });
  }

  // ---- localStorage helpers ----
  const loadJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fallback; } catch(e) { return fallback; } };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---- Menu helpers ----
  const loadMenu = () => loadJSON(MENU_STORAGE, []);
  const saveMenuList = (list) => saveJSON(MENU_STORAGE, list || []);
  const saveMenuItem = (item) => { const list = loadMenu(); list.unshift(item); saveMenuList(list); };
  const updateMenuItem = (id, patch) => {
    const list = loadMenu(); const ix = list.findIndex(i => i.id === id);
    if (ix === -1) return false;
    list[ix] = Object.assign({}, list[ix], patch);
    saveMenuList(list); return true;
  };
  async function removeMenuItem(id) {
    try {
      const list = loadMenu();
      const item = list.find(i => i.id === id);
      if (item && item.img && typeof item.img === 'object' && item.img.storage === 'images' && item.img.id) {
        await deleteImage(item.img.id).catch(()=>{});
      }
      const newList = list.filter(i => i.id !== id);
      saveMenuList(newList);
      return true;
    } catch(e){ console.error(e); return false; }
  }

  // ---- Receipts & Sales storage ----
  function loadReceipts(){ return loadJSON(RECEIPTS_KEY, []); }
  function saveReceipts(arr){ saveJSON(RECEIPTS_KEY, arr || []); }
  function pushReceipt(r){ const arr = loadReceipts(); arr.unshift(r); while(arr.length>200) arr.pop(); saveReceipts(arr); }

  function loadSalesDaily(){ return loadJSON(SALES_DAILY_KEY, {}); }
  function saveSalesDaily(obj){ saveJSON(SALES_DAILY_KEY, obj || {}); }
  function loadSalesMonth(){ return loadJSON(SALES_MONTH_KEY, {}); }
  function saveSalesMonth(obj){ saveJSON(SALES_MONTH_KEY, obj || {}); }

  // ---- Prep queue helpers ----
  function loadPrepList(){ return loadJSON(PREP_KEY, []); }
  function savePrepList(list){ saveJSON(PREP_KEY, list || []); }

  // ---- DOM references (must exist in index.html) ----
  const menuGrid = $("#menuGrid");
  const emptyHint = $("#emptyHint");
  const searchInput = $("#searchInput");
  const tabs = $$(".tab");

  const cartList = $("#cartList");
  const subTotal = $("#subTotal");
  const changeAmount = $("#changeAmount");
  const cashInput = $("#cashInput");

  const tableInput = $("#tableInput");
  const orderTypeEl = $("#orderType");

  const holdBtn = $("#holdBtn");
  const retrieveBtn = $("#retrieveBtn");
  const clearBtn = $("#clearBtn");
  const payBtn = $("#payBtn");

  const addItemBtn = $("#addItemBtn");
  const addModal = $("#addModal");
  const addForm = $("#addForm");
  const addName = $("#addName");
  const addPrice = $("#addPrice");
  const addCat = $("#addCat");
  const addImg = $("#addImg");
  const addImgUrl = $("#addImgUrl");
  const imgPreview = $("#imgPreview");

  const printFrame = $("#printFrame");

  // ---- Configs ----
  const SPICY_OPTIONS = [
    {value:"ไม่เผ็ด", label:"ไม่เผ็ด"},
    {value:"อ่อน", label:"อ่อน"},
    {value:"กลาง", label:"กลาง"},
    {value:"มาก", label:"มาก"},
    {value:"เผ็ดมาก", label:"เผ็ดมาก"}
  ];
  const NO_SPICY_CATS = ["grill","drink","other"];
  const CATEGORY_ORDER = ["somtam","larb","grill","soup","other","drink"]; // drink last

  // ---- State ----
  let MENU = loadMenu();
  let state = loadJSON(CART_KEY, { cart: [], heldBills: [], table: "", orderType: "dine-in" });

  // ---- Utility functions ----
  function saveState(){ try { localStorage.setItem(CART_KEY, JSON.stringify(state)); } catch(e){ console.error('saveState', e); } }
  function loadState(){ try { const s = JSON.parse(localStorage.getItem(CART_KEY) || "{}"); if (s && typeof s === 'object') state = Object.assign(state, s); } catch(e){ console.warn(e); } }

  function calc(){
    const sub = state.cart.reduce((a,i)=> a + (Number(i.price)||0) * (Number(i.qty)||0), 0);
    return { sub };
  }

  // ---- Render menu ----
  function renderMenu(filterCat="all", q=""){
    MENU = loadMenu();
    const list = MENU
      .filter(m => (filterCat === "all" || m.cat === filterCat) &&
        (q === "" || (m.name||"").toLowerCase().includes(q.toLowerCase()) || (m.id||"").toLowerCase().includes(q.toLowerCase())))
      .sort((a,b) => {
        const ai = CATEGORY_ORDER.indexOf(a.cat), bi = CATEGORY_ORDER.indexOf(b.cat);
        const ia = ai === -1 ? CATEGORY_ORDER.length : ai;
        const ib = bi === -1 ? CATEGORY_ORDER.length : bi;
        if (ia !== ib) return ia - ib;
        const na = (a.name||"").localeCompare(b.name||"");
        if (na !== 0) return na;
        return (b.id||"").localeCompare(a.id||"");
      });

    emptyHint && (emptyHint.hidden = list.length > 0);
    if (!menuGrid) return;
    menuGrid.innerHTML = "";

    list.forEach(m => {
      const article = document.createElement('article');
      article.className = 'card';
      article.dataset.id = m.id;
      article.style.position = 'relative';

      // edit button top-right
      const topCtrl = document.createElement('div');
      topCtrl.style.cssText = 'position:absolute;right:8px;top:8px;display:flex;gap:6px;z-index:3';
      const btnEditTop = document.createElement('button');
      btnEditTop.className = 'btn btn--ghost';
      btnEditTop.type = 'button';
      btnEditTop.textContent = 'แก้ไข';
      btnEditTop.addEventListener('click', (ev) => { ev.stopPropagation(); openEditModal(m.id); });
      topCtrl.appendChild(btnEditTop);
      article.appendChild(topCtrl);

      // badge
      const badge = document.createElement('div'); badge.className = 'add-badge'; badge.textContent = 'กดเพื่อเลือก'; article.appendChild(badge);

      // thumb
      const thumb = document.createElement('div'); thumb.className = 'card__thumb';
      if (m.img) {
        const imgEl = document.createElement('img'); imgEl.className = 'card__img'; imgEl.alt = m.name || 'เมนู';
        if (typeof m.img === 'string') {
          imgEl.src = m.img;
          imgEl.onerror = () => { thumb.textContent = '🍽️'; };
          thumb.appendChild(imgEl);
        } else if (typeof m.img === 'object' && m.img.storage === 'images' && m.img.id) {
          thumb.textContent = '⏳';
          getImageURL(m.img.id).then(url => {
            if (!url) { thumb.textContent = '🍽️'; return; }
            thumb.textContent = '';
            const i2 = document.createElement('img'); i2.className = 'card__img'; i2.alt = m.name || 'เมนู'; i2.src = url;
            i2.onerror = () => { thumb.textContent = '🍽️'; };
            thumb.appendChild(i2);
          }).catch(()=>{ thumb.textContent = '🍽️'; });
        } else thumb.textContent = '🍽️';
      } else thumb.textContent = '🍽️';
      article.appendChild(thumb);

      const h3 = document.createElement('h3'); h3.className = 'card__title'; h3.textContent = m.name || 'ไม่มีชื่อเมนู'; article.appendChild(h3);

      const meta = document.createElement('div'); meta.className = 'card__meta';
      const pPrice = document.createElement('p'); pPrice.className = 'price'; pPrice.textContent = money(m.price); meta.appendChild(pPrice);
      const span = document.createElement('span'); span.className = 'badge'; span.textContent = (function(c){ return ({ somtam:"ส้มตำ", larb:"ลาบ/ก้อย", grill:"ย่าง/ทอด", soup:"ต้ม/แกง", drink:"เครื่องดื่ม", other:"อื่นๆ" })[c]||c; })(m.cat); meta.appendChild(span);
      article.appendChild(meta);

      if (!NO_SPICY_CATS.includes(m.cat)) {
        const small = document.createElement('p');
        small.style.margin = '6px 0 0';
        small.style.color = 'var(--muted)';
        small.style.fontSize = '12px';
        small.textContent = 'ความเผ็ดเริ่มต้น: ' + (m.defaultSpicy || 'กลาง');
        article.appendChild(small);
      }

      article.addEventListener('click', () => {
        if (NO_SPICY_CATS.includes(m.cat)) addToCart(m, { qty:1 });
        else openOrderModalForItem(m);
      });

      menuGrid.appendChild(article);
    });
  }

  // ---- Order modal (choose qty + spicy) ----
  let orderModalEl = null;
  function createOrderModal(){
    if (orderModalEl) return orderModalEl;
    const wrap = document.createElement('div');
    wrap.id = 'orderOptionModal';
    wrap.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:1100';
    wrap.innerHTML = `
      <div style="background:rgba(0,0,0,.55);position:absolute;inset:0"></div>
      <div style="position:relative;z-index:2;width:min(460px,92vw);background:#0f1720;border-radius:12px;padding:16px;border:1px solid rgba(255,255,255,.06);box-shadow:0 10px 30px rgba(0,0,0,.6);color:var(--text);">
        <h3 id="ordTitle" style="margin:0 0 8px">ระดับความเผ็ด</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="field"><label>ชื่อ</label><div id="ordName" style="font-weight:700"></div></div>
          <div class="field"><label>ราคา</label><div id="ordPrice"></div></div>
          <div class="field"><label for="ordQty">จำนวน</label><input id="ordQty" type="number" min="1" value="1" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:#0b1116;color:var(--text)" /></div>
          <div class="field" id="ordSpicyField"><label for="ordSpicy">ความเผ็ด</label><select id="ordSpicy" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:#0b1116;color:var(--text)"></select></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button id="ordCancel" class="btn btn--ghost" type="button">ยกเลิก</button>
            <button id="ordAdd" class="btn btn--primary" type="button">เพิ่มลงตะกร้า</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    orderModalEl = wrap;
    const ordSpicy = wrap.querySelector('#ordSpicy');
    SPICY_OPTIONS.forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; ordSpicy.appendChild(opt); });

    wrap.querySelector('#ordCancel').addEventListener('click', () => { wrap.style.display = 'none'; });
    wrap.querySelector('#ordAdd').addEventListener('click', () => {
      const qty = Math.max(1, Number(wrap.querySelector('#ordQty').value || 1));
      const spicy = wrap.querySelector('#ordSpicy') ? wrap.querySelector('#ordSpicy').value : null;
      const id = wrap.dataset.menuId;
      const item = loadMenu().find(x => x.id === id);
      if (!item) { alert('ไม่พบเมนู'); wrap.style.display = 'none'; return; }
      addToCart(item, { qty, spicy });
      wrap.style.display = 'none';
    });

    return wrap;
  }
  function openOrderModalForItem(item){
    const modal = createOrderModal();
    const spicyField = modal.querySelector('#ordSpicyField');
    if (NO_SPICY_CATS.includes(item.cat)) spicyField.style.display = 'none'; else spicyField.style.display = '';
    modal.style.display = 'flex';
    modal.dataset.menuId = item.id;
    modal.querySelector('#ordName').textContent = item.name || '';
    modal.querySelector('#ordPrice').textContent = money(item.price);
    modal.querySelector('#ordQty').value = 1;
    if (modal.querySelector('#ordSpicy')) modal.querySelector('#ordSpicy').value = item.defaultSpicy || 'กลาง';
  }

  // ---- Add/Edit modal ----
  let previewDataUrl = "";
  function ensureSpicySelectInAddForm() {
    if (!addForm) return null;
    if (document.getElementById('addSpicy')) return document.getElementById('addSpicy');
    const field = document.createElement('div'); field.className = 'field';
    const label = document.createElement('label'); label.textContent = 'ความเผ็ด (ค่าเริ่มต้น)';
    const select = document.createElement('select'); select.id = 'addSpicy';
    SPICY_OPTIONS.forEach(opt => { const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label; select.appendChild(o); });
    field.appendChild(label); field.appendChild(select);
    const grid = addForm.querySelector('.grid2');
    if (grid) grid.appendChild(field); else addForm.appendChild(field);
    return select;
  }

  if (addImg) {
    addImg.addEventListener('change', () => {
      const f = addImg.files?.[0];
      if (!f) { if (imgPreview) imgPreview.src = ""; previewDataUrl = ""; return; }
      const rd = new FileReader();
      rd.onload = () => {
        const tmp = new Image(); tmp.onload = () => {
          const maxW = 800;
          const w = tmp.naturalWidth, h = tmp.naturalHeight;
          const scale = w > maxW ? (maxW / w) : 1;
          const c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          const ctx = c.getContext('2d'); ctx.drawImage(tmp,0,0,c.width,c.height);
          previewDataUrl = c.toDataURL('image/jpeg', 0.75);
          if (imgPreview) imgPreview.src = previewDataUrl;
        };
        tmp.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
  }

  let isEditing = false, editingId = null;
  function openAddModal(){
    if (!addForm || !addModal) return;
    isEditing = false; editingId = null; addForm.reset(); if (imgPreview) imgPreview.src=""; previewDataUrl="";
    const sel = ensureSpicySelectInAddForm(); if (sel) sel.value = 'กลาง';
    addModal.classList.add("is-open"); addModal.setAttribute("aria-hidden","false");
  }
  async function openEditModal(id){
    if (!addForm || !addModal) return;
    const item = loadMenu().find(x => x.id === id);
    if (!item) return alert('ไม่พบเมนูที่จะแก้ไข');
    isEditing = true; editingId = id;
    addName.value = item.name || ''; addPrice.value = item.price || 0; addCat.value = item.cat || 'other'; previewDataUrl = '';
    if (item.img) {
      if (typeof item.img === 'string') imgPreview.src = item.img;
      else if (typeof item.img === 'object' && item.img.storage === 'images' && item.img.id) {
        getImageURL(item.img.id).then(url => { if (url) imgPreview.src = url; }).catch(()=>{});
      } else imgPreview.src = '';
    } else imgPreview.src = '';
    const sel = ensureSpicySelectInAddForm(); if (sel) sel.value = item.defaultSpicy || 'กลาง';

    // add delete button in modal footer if not exists
    const footer = addModal.querySelector('.modal__footer') || addModal;
    let delBtn = footer.querySelector('#deleteInModal');
    if (!delBtn) {
      delBtn = document.createElement('button'); delBtn.id = 'deleteInModal'; delBtn.type='button'; delBtn.className='btn btn--ghost';
      delBtn.style.borderColor='rgba(255,87,87,.25)'; delBtn.style.color='#ff8b8b'; delBtn.textContent='ลบเมนู';
      footer.insertBefore(delBtn, footer.firstChild);
      delBtn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (!confirm(`ต้องการลบเมนู "${item.name}" ใช่หรือไม่?`)) return;
        const ok = await removeMenuItem(id);
        if (!ok) { alert('ลบไม่สำเร็จ'); return; }
        MENU = loadMenu(); renderMenu(document.querySelector('.tab.is-active')?.dataset.cat || 'all', searchInput?.value?.trim() || "");
        addModal.classList.remove("is-open"); addModal.setAttribute("aria-hidden","true");
        addForm.reset(); imgPreview.src=""; previewDataUrl=""; isEditing=false; editingId=null;
        if (footer.querySelector('#deleteInModal')) footer.querySelector('#deleteInModal').remove();
        alert('ลบเมนูเรียบร้อย');
      });
    }

    addModal.classList.add("is-open"); addModal.setAttribute("aria-hidden","false");
  }

  if (addForm) {
    addForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = addName.value.trim();
      const price = Math.max(0, Number(addPrice.value) || 0);
      const cat = addCat.value;
      const url = addImgUrl.value.trim();
      const sel = document.getElementById('addSpicy');
      const defaultSpicy = sel ? sel.value : 'กลาง';
      if (!name || !price) return alert('กรอกชื่อและราคาให้ครบ');

      const old = isEditing && editingId ? loadMenu().find(x=>x.id===editingId) : null;
      let imgMeta = null;
      try {
        if (previewDataUrl) {
          const imgId = "IMG" + Date.now() + Math.floor(Math.random()*9999);
          const resp = await fetch(previewDataUrl);
          const blob = await resp.blob();
          await saveImageBlob(imgId, blob);
          imgMeta = { storage:'images', id: imgId };
        } else if (url) {
          imgMeta = url;
        } else {
          imgMeta = (isEditing && old && old.img) ? old.img : null;
        }
      } catch(err) {
        console.warn('save image error', err);
        imgMeta = previewDataUrl || url || (isEditing && old ? old.img : null) || null;
      }

      if (isEditing && editingId) {
        const oldItem = loadMenu().find(x=>x.id===editingId);
        if (oldItem && oldItem.img && typeof oldItem.img === 'object' && oldItem.img.storage === 'images' &&
            imgMeta && typeof imgMeta === 'object' && imgMeta.storage === 'images' && imgMeta.id !== oldItem.img.id) {
          deleteImage(oldItem.img.id).catch(()=>{});
        }
        const ok = updateMenuItem(editingId, { name, price, cat, img: imgMeta, defaultSpicy });
        if (!ok) return alert('แก้ไขไม่สำเร็จ (ไม่พบเมนู)');
        MENU = loadMenu(); renderMenu(document.querySelector('.tab.is-active')?.dataset.cat || 'all', searchInput?.value?.trim() || "");
        addModal.classList.remove("is-open"); addModal.setAttribute("aria-hidden","true");
        addForm.reset(); imgPreview.src=""; previewDataUrl=""; isEditing=false; editingId=null;
        const footer = addModal.querySelector('.modal__footer'); const existingDel = footer && footer.querySelector('#deleteInModal'); if (existingDel) existingDel.remove();
        alert('บันทึกการแก้ไขเรียบร้อย');
      } else {
        const localId = "L" + Date.now() + Math.floor(Math.random()*1000);
        const localItem = { id: localId, name, price, cat, img: imgMeta, defaultSpicy, mods: [] };
        saveMenuItem(localItem); MENU = loadMenu(); renderMenu(document.querySelector('.tab.is-active')?.dataset.cat || 'all', searchInput?.value?.trim() || "");
        addModal.classList.remove("is-open"); addModal.setAttribute("aria-hidden","true"); addForm.reset(); imgPreview.src=""; previewDataUrl="";
        alert('บันทึกเมนูลงเครื่องเรียบร้อย');
      }
    });
  }

  // ---- Cart actions ----
  function animateCart(){
  try {
    const el = document.querySelector('.cart'); // ปรับ selector ถ้าจำเป็น
    if (!el) return;
    // add active class to change background
    el.classList.add('cart--active');

    // small pop animation
    if (el.animate) {
      el.animate(
        [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-4px) scale(1.01)' }, { transform: 'translateY(0) scale(1)'}],
        { duration: 220, easing: 'ease-out' }
      );
    }

    // remove class after short delay so background returns to normal
    clearTimeout(el._cartActiveTimer);
    el._cartActiveTimer = setTimeout(() => {
      el.classList.remove('cart--active');
    }, 900); // 900ms = ระยะเวลาที่พื้นหลังเป็นสีเขียว (ปรับได้)
  } catch(e){
    console.warn('animateCart error', e);
  }
}


  function addToCart(item, { qty=1, spicy=null, mods=[], note="" } = {}) {
  const useSpicy = spicy || item.defaultSpicy || "กลาง";
  const key = `${item.id}|${useSpicy}|${(mods||[]).slice().sort().join(",")}|${note}`;
  const found = state.cart.find(i => i.key === key);
  if (found) found.qty = Number(found.qty || 0) + Number(qty || 0);
  else state.cart.unshift({ key, id: item.id, name: item.name, price: Number(item.price)||0, qty: Number(qty)||1, spicy: useSpicy, mods: mods||[], note: note||"" });
  // DO NOT reset state.table here (preserve table)
  animateCart();
  renderCart();
  saveState();

  // highlight the added item in the cart (use the key to find it)
  try { highlightCartItem(key); } catch(e){ console.warn('highlightCartItem failed', e); }
}


  function updateQty(idx, delta){
    const it = state.cart[idx]; if (!it) return;
    it.qty += delta; if (it.qty <= 0) state.cart.splice(idx,1);
    renderCart(); saveState();
  }
  function clearCart(){ state.cart = []; renderCart(); saveState(); }

  function renderCart(){
  if (!cartList) return;
  // create list items and include data-key so we can target them
  cartList.innerHTML = state.cart.map((i, idx) => `
    <li class="cart-item" data-idx="${idx}" data-id="${i.id}" data-key="${i.key}">
      <div>
        <p class="cart-item__title">${i.name} × ${i.qty} — ${money(i.price * i.qty)}</p>
        <p class="cart-item__sub">เผ็ด: ${i.spicy || '-'}${i.mods?.length ? " · " + i.mods.join(", ") : ""}${i.note ? " · หมายเหตุ: " + i.note : ""}</p>
      </div>
      <div class="cart-item__qty">
        <button class="qty-btn" data-act="dec" data-idx="${idx}">−</button>
        <button class="qty-btn" data-act="inc" data-idx="${idx}">+</button>
      </div>
    </li>`).join("");

  const { sub } = calc();
  subTotal && (subTotal.textContent = money(sub));
  const cash = Number(cashInput?.value || 0);
  const change = cash - sub;
  changeAmount && (changeAmount.textContent = change >= 0 ? money(change) : "฿0.00");
  if (tableInput) tableInput.value = state.table || "";
  if (orderTypeEl) orderTypeEl.value = state.orderType || "dine-in";
}


  // ---- Hold (พักบิล) and retrieve ----
  function holdBill(){
    if (!state.cart || !state.cart.length) return alert("ยังไม่มีรายการในตะกร้า");
    state.heldBills = state.heldBills || [];
    state.heldBills.unshift({
      id: "H" + Date.now(),
      time: new Date().toISOString(),
      table: state.table || "",
      orderType: state.orderType || "dine-in",
      cart: JSON.parse(JSON.stringify(state.cart || []))
    });
    // clear cart but keep table and orderType (so table doesn't vanish)
    state.cart = [];
    saveState();
    renderCart();
    alert('พักบิลเรียบร้อย');
  }
  function retrieveBill(){
    state.heldBills = state.heldBills || [];
    if (!state.heldBills.length) return alert('ยังไม่มีบิลที่พักไว้');
    const bill = state.heldBills.shift();
    state.cart = bill.cart || [];
    state.table = bill.table || '';
    state.orderType = bill.orderType || 'dine-in';
    saveState();
    renderCart();
  }

  // ---- Payment modal (improved UI) ----
  // add at top of file (near other consts)
const PAYMENT_QR_KEY = 'isan_payment_qr_id_v1';

// ---- Payment modal (improved UI) with QR attach ----
const DENOMS = [1000,500,100,50,20,10];
function createPaymentModal(){
  
  if (paymentModalEl) return paymentModalEl;
  const wrap = document.createElement('div');
  wrap.id = 'paymentModal';
  wrap.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:2000';
  wrap.innerHTML = `
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
    <div style="position:relative;z-index:2;width:min(900px,96vw);max-height:88vh;overflow:auto;border-radius:12px;padding:14px;background:var(--panel,#0f1720);border:1px solid rgba(255,255,255,.06);box-shadow:0 18px 50px rgba(0,0,0,.6);color:var(--text);">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0;font-size:20px">ชำระเงิน</h2>
        <button id="paymentClose" class="btn btn--ghost">✕</button>
      </header>
      <div style="display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:end">
            <div style="font-size:13px;color:var(--muted)">รายการสินค้า</div>
            <div style="font-size:13px;color:var(--muted)">ยอดรวม</div>
          </div>
          <div id="payItemsContainer" style="margin-top:8px;border-radius:8px;padding:8px;background:rgba(255,255,255,0.02);max-height:200px;overflow:auto"></div>

          <!-- QR attach area -->
          <div style="margin-top:12px;border-radius:8px;padding:10px;background:rgba(255,255,255,0.01);border:1px dashed rgba(255,255,255,0.03)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:800">สแกนชำระ</div>
              <div style="font-size:13px;color:var(--muted)">ลูกค้าสแกนจ่าย</div>
            </div>

            <div style="display:flex;gap:12px;align-items:center">
              <div style="width:180px;height:120px;border-radius:8px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center;overflow:hidden" id="payQrPreviewWrap">
                <img id="payQrPreview" alt="QR preview" style="max-width:100%;max-height:100%;display:none"/>
                <div id="payQrPlaceholder" style="color:var(--muted);font-size:13px">ยังไม่ได้แนบ</div>
              </div>

              <div style="flex:1;display:flex;flex-direction:column;gap:8px">
                <input id="payQrInput" type="file" accept="image/*" style="display:block" />
                <div style="display:flex;gap:8px">
                  <button id="payQrSaveBtn" class="btn btn--primary" type="button">บันทึก QR</button>
                  <button id="payQrRemoveBtn" class="btn btn--ghost" type="button">ลบ QR</button>
                </div>
                <div style="font-size:12px;color:var(--muted)"></div>
              </div>
            </div>
          </div>

          <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1">
              <div style="font-size:13px;color:var(--muted)"></div>
              <input id="payManual" type="number" inputmode="numeric" placeholder="รับเงิน" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);background:#0b1116;color:var(--text);font-size:18px;margin-top:8px" />
            </div>
            <div style="min-width:160px;text-align:right">
              <div style="font-size:13px;color:var(--muted)">เงินทอน</div>
              <div id="payChangeSmall" style="font-size:24px;font-weight:900;color:#ff6b6b;margin-top:6px">฿0.00</div>
            </div>
          </div>

          <div id="denomBtns" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px"></div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button id="payExactBtn" class="btn btn--ghost">รับพอดี</button>
            <button id="payUndoBtn" class="btn btn--ghost">ยกเลิกล่าสุด</button>
            <button id="payClearBtn" class="btn btn--ghost">รีเซ็ต</button>
          </div>
        </div>

        <aside style="min-width:280px">
          <div style="padding:14px;border-radius:10px;background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.02));">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:13px;color:var(--muted)">ยอดที่ต้องชำระ</div>
              <div id="paySubtotal" style="font-size:16px;font-weight:700;color:var(--muted)">${money(0)}</div>
            </div>
            <div style="margin-top:10px">
              <div style="font-size:12px;color:var(--muted)">ยอดรวม</div>
              <div id="payTotal" style="font-size:44px;font-weight:900;color:#ffffff;margin-top:6px">฿0.00</div>
            </div>
            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:13px;color:var(--muted)">รับเงินรวม</div>
              <div id="payReceived" style="font-size:22px;font-weight:900;color:#6be86b">฿0.00</div>
            </div>
            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:13px;color:var(--muted)"><strong>เงินทอน</strong></div>
              <div id="payChange" style="font-size:28px;font-weight:900;color:#ff6b6b">฿0.00</div>
            </div>
            <div style="margin-top:14px;display:flex;gap:8px;flex-direction:column">
              <button id="payConfirm" class="btn btn--primary btn--full">เสร็จสิ้น</button>
              <button id="payCancel" class="btn btn--ghost btn--full">ยกเลิก</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  paymentModalEl = wrap;

  // denom buttons
  const denomContainer = wrap.querySelector('#denomBtns');
  DENOMS.forEach(d => {
    const b = document.createElement('button');
    b.className = 'btn-denom--blue';
    b.type = 'button';
    b.dataset.value = d;
    b.textContent = '฿' + d;
    b.addEventListener('click', () => { addDenom(Number(b.dataset.value)); });
    denomContainer.appendChild(b);
  });

  // elements
  const closeBtn = wrap.querySelector('#paymentClose');
  const cancelBtn = wrap.querySelector('#payCancel');
  const confirmBtn = wrap.querySelector('#payConfirm');
  const exactBtn = wrap.querySelector('#payExactBtn');
  const undoBtn = wrap.querySelector('#payUndoBtn');
  const clearBtn = wrap.querySelector('#payClearBtn');
  const manual = wrap.querySelector('#payManual');

  closeBtn && closeBtn.addEventListener('click', ()=> wrap.style.display='none');
  cancelBtn && cancelBtn.addEventListener('click', ()=> wrap.style.display='none');

  wrap._paymentState = { stack: [], counts: {}, received: 0, subtotal: 0 };

  exactBtn && exactBtn.addEventListener('click', () => {
    const subtotal = wrap._paymentState.subtotal || 0;
    wrap._paymentState.stack = ['exact'];
    wrap._paymentState.counts = {};
    wrap._paymentState.received = subtotal;
    manual.value = subtotal;
    renderPaymentUI();
  });

  undoBtn && undoBtn.addEventListener('click', () => {
    const st = wrap._paymentState.stack;
    if (!st.length) return;
    const last = st.pop();
    if (last === 'exact') {
      wrap._paymentState.counts = {};
      wrap._paymentState.received = st.reduce((a,c)=> a + Number(c||0), 0);
    } else {
      const v = Number(last);
      wrap._paymentState.counts[v] = Math.max(0, (wrap._paymentState.counts[v]||0)-1);
      wrap._paymentState.received = wrap._paymentState.received - v;
    }
    manual.value = wrap._paymentState.received;
    renderPaymentUI();
  });

  clearBtn && clearBtn.addEventListener('click', () => {
    wrap._paymentState.stack = [];
    wrap._paymentState.counts = {};
    wrap._paymentState.received = 0;
    manual.value = '';
    renderPaymentUI();
  });

  manual && manual.addEventListener('input', () => {
    const val = Number(manual.value || 0);
    wrap._paymentState.received = val;
    wrap._paymentState.stack = [];
    wrap._paymentState.counts = {};
    renderPaymentUI();
  });

  confirmBtn && confirmBtn.addEventListener('click', () => {
    try {
      const received = Number(manual.value || wrap._paymentState.received || 0);
      if (typeof cashInput !== 'undefined' && cashInput) cashInput.value = Number(received || 0);
      wrap.style.display = 'none';
      if (typeof onPaymentConfirmed === 'function') onPaymentConfirmed(received);
      else finalizePayment(received);
    } catch (err) { console.error('payment confirm error', err); wrap.style.display='none'; }
  });


const PAYMENT_QR_KEY = 'isan_payment_qr_id_v1'; 

// ชี่อ-select elements
const payQrInput = wrap.querySelector('#payQrInput');
const payQrPreview = wrap.querySelector('#payQrPreview');
const payQrPlaceholder = wrap.querySelector('#payQrPlaceholder');
const payQrSaveBtn = wrap.querySelector('#payQrSaveBtn');
const payQrRemoveBtn = wrap.querySelector('#payQrRemoveBtn');

// internal state for this modal instance
wrap._qr = { blob: null, dataUrl: null, id: null };

// helper: show preview (dataUrl string)
function _showQrPreview(dataUrl) {
  if (!payQrPreview || !payQrPlaceholder) return;
  if (dataUrl) {
    payQrPreview.src = dataUrl;
    payQrPreview.style.display = 'block';
    payQrPlaceholder.style.display = 'none';
  } else {
    payQrPreview.src = '';
    payQrPreview.style.display = 'none';
    payQrPlaceholder.style.display = 'block';
  }
}

// load saved QR (if any) when modal opens
(async function loadSavedQr(){
  try {
    const existingId = localStorage.getItem(PAYMENT_QR_KEY);
    if (!existingId) { _showQrPreview(null); wrap._qr.id = null; return; }
    const url = await getImageURL(existingId);
    if (url) {
      wrap._qr.id = existingId;
      wrap._qr.dataUrl = null; // not storing dataURL now
      _showQrPreview(url);
    } else {
      localStorage.removeItem(PAYMENT_QR_KEY);
      _showQrPreview(null);
    }
  } catch(err) {
    console.warn('loadSavedQr error', err);
    _showQrPreview(null);
  }
})();

// when user selects a file -> preview it and keep Blob in memory
if (payQrInput) {
  payQrInput.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) {
      wrap._qr.blob = null;
      wrap._qr.dataUrl = null;
      _showQrPreview(null);
      return;
    }
    // accept only images defensively
    if (!f.type.startsWith('image/')) {
      alert('โปรดเลือกไฟล์ภาพ (PNG, JPG, ฯลฯ)');
      payQrInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      wrap._qr.blob = f;
      wrap._qr.dataUrl = dataUrl;
      wrap._qr.id = null; // ยังไม่ได้บันทึกเป็น id ใหม่
      _showQrPreview(dataUrl);
    };
    reader.onerror = (e) => {
      console.error('FileReader error', e);
      alert('เปิดไฟล์ไม่สำเร็จ');
    };
    reader.readAsDataURL(f);
  });
}

// save to IndexedDB when "บันทึก QR" คลิก
if (payQrSaveBtn) {
  payQrSaveBtn.addEventListener('click', async () => {
    try {
      // ถ้าผู้ใช้เลือกไฟล์ (ในหน่วยความจำ)
      if (wrap._qr && wrap._qr.blob) {
        const id = 'QR' + Date.now();
        await saveImageBlob(id, wrap._qr.blob);
        localStorage.setItem(PAYMENT_QR_KEY, id);
        wrap._qr.id = id;
        // show saved (createObjectURL via getImageURL)
        const url = await getImageURL(id);
        _showQrPreview(url);
        alert('บันทึก QR เรียบร้อย');
        payQrInput.value = '';
        wrap._qr.blob = null;
        wrap._qr.dataUrl = null;
        return;
      }

      // ถ้าไม่มีไฟล์ใหม่ แต่มี previewDataUrl เป็น string (fallback) หรือมี id อยู่แล้ว
      if (wrap._qr && wrap._qr.dataUrl) {
        // convert dataUrl -> blob แล้วเซฟ
        const res = await fetch(wrap._qr.dataUrl);
        const blob = await res.blob();
        const id = 'QR' + Date.now();
        await saveImageBlob(id, blob);
        localStorage.setItem(PAYMENT_QR_KEY, id);
        wrap._qr.id = id;
        const url = await getImageURL(id);
        _showQrPreview(url);
        alert('บันทึก QR เรียบร้อย');
        payQrInput.value = '';
        wrap._qr.blob = null;
        wrap._qr.dataUrl = null;
        return;
      }

      alert('ยังไม่ได้เลือกไฟล์ที่จะบันทึก');
    } catch (err) {
      console.error('save QR error', err);
      alert('ไม่สามารถบันทึก QR ได้');
    }
  });
}

// remove QR (delete from DB + clear key)
if (payQrRemoveBtn) {
  payQrRemoveBtn.addEventListener('click', async () => {
    try {
      const existingId = localStorage.getItem(PAYMENT_QR_KEY) || wrap._qr.id;
      if (!existingId) {
        // ถ้าไม่มี id แสดงว่ายังไม่ได้บันทึก
        wrap._qr.blob = null;
        wrap._qr.dataUrl = null;
        payQrInput.value = '';
        _showQrPreview(null);
        return alert('ไม่มี QR ที่บันทึกไว้');
      }
      if (!confirm('ต้องการลบ QR ที่บันทึกใช่หรือไม่?')) return;
      await deleteImage(existingId).catch(()=>{});
      localStorage.removeItem(PAYMENT_QR_KEY);
      wrap._qr.id = null;
      wrap._qr.blob = null;
      wrap._qr.dataUrl = null;
      payQrInput.value = '';
      _showQrPreview(null);
      alert('ลบ QR เรียบร้อย');
    } catch(err) {
      console.error('removeQr error', err);
      alert('เกิดข้อผิดพลาด ขณะลบ QR');
    }
  });
}
return wrap;

}


  function renderPaymentUI(){
    if (!paymentModalEl) return;
    const wrap = paymentModalEl;
    const st = wrap._paymentState || { stack: [], counts: {}, received: 0, subtotal: 0 };
    const subtotal = st.subtotal || 0;
    const received = Number(st.received || 0);
    const change = Math.max(0, received - subtotal);

    try { wrap.querySelector('#payTotal').textContent = money(subtotal); } catch(e){}
    try { wrap.querySelector('#paySubtotal').textContent = money(subtotal); } catch(e){}
    try { wrap.querySelector('#payReceived').textContent = money(received); } catch(e){}
    try { wrap.querySelector('#payChange').textContent = money(change); } catch(e){}
    try { wrap.querySelector('#payChangeSmall').textContent = money(change); } catch(e){}

    const tbody = wrap.querySelector('#payTableBody');
    if (tbody) {
      const counts = st.counts || {};
      const keys = Object.keys(counts).map(k=>Number(k)).filter(k => counts[k] > 0).sort((a,b)=>b-a);
      if (!keys.length) tbody.innerHTML = '<tr><td colspan="3" class="hint">ยังไม่มีการรับเงิน</td></tr>';
      else tbody.innerHTML = keys.map(k => `<tr><td style="padding:6px">${'฿'+k}</td><td style="text-align:center">${counts[k]}</td><td style="text-align:right">${money(k*counts[k])}</td></tr>`).join('');
    }

    // items
    const itemsContainer = wrap.querySelector('#payItemsContainer');
    if (itemsContainer) {
      if (!state.cart || !state.cart.length) {
        itemsContainer.innerHTML = '<div class="hint">ยังไม่มีรายการในตะกร้า</div>';
      } else {
        const rows = state.cart.map(i => `<tr>
          <td style="padding:8px 6px">${i.name}${i.spicy? ' <small>('+i.spicy+')</small>':''}</td>
          <td style="text-align:center;padding:8px 6px;width:64px">${i.qty}</td>
          <td style="text-align:right;padding:8px 6px;width:110px">${money(i.price)}</td>
          <td style="text-align:right;padding:8px 6px;width:120px">${money(i.price * i.qty)}</td>
        </tr>`).join('');
        itemsContainer.innerHTML = `
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead><tr style="border-bottom:2px solid rgba(255,255,255,0.04)"><th style="text-align:left;padding:6px">รายการ</th><th style="text-align:center;padding:6px;width:64px">จำนวน</th><th style="text-align:right;padding:6px;width:110px">ราคา/หน่วย</th><th style="text-align:right;padding:6px;width:120px">รวม</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td colspan="3" style="text-align:right;padding-top:8px">ยอดรวม</td><td style="text-align:right;padding-top:8px"><strong>${money(subtotal)}</strong></td></tr></tfoot>
          </table>
        `;
      }
    }
  }

  function openPaymentModal(){
    if (!paymentModalEl) createPaymentModal();
    const modal = paymentModalEl;
    const { sub } = calc();
    modal._paymentState = { stack: [], counts: {}, received: 0, subtotal: sub };
    modal.querySelector('#payTotal').textContent = money(sub);
    modal.querySelector('#paySubtotal').textContent = money(sub);
    modal.querySelector('#payReceived').textContent = money(0);
    modal.querySelector('#payChange').textContent = money(0);
    modal.querySelector('#payTableBody') && (modal.querySelector('#payTableBody').innerHTML = '<tr><td colspan="3" class="hint">ยังไม่มีการรับเงิน</td></tr>');
    modal.querySelector('#payManual') && (modal.querySelector('#payManual').value = '');
    renderPaymentUI();
    modal.style.display = 'flex';
  }

  function addDenom(v){
    if (!paymentModalEl) createPaymentModal();
    const wrap = paymentModalEl;
    if (wrap._paymentState.stack.length === 1 && wrap._paymentState.stack[0] === 'exact') {
      wrap._paymentState.stack = [];
      wrap._paymentState.counts = {};
      wrap._paymentState.received = 0;
    }
    wrap._paymentState.stack.push(String(v));
    wrap._paymentState.counts[v] = (wrap._paymentState.counts[v] || 0) + 1;
    wrap._paymentState.received = (wrap._paymentState.received || 0) + v;
    const manual = wrap.querySelector('#payManual'); if (manual) manual.value = wrap._paymentState.received;
    renderPaymentUI();
  }

  // ---- finalize payment (save receipt, update sales, show popup 3s, speak, clear cashInput) ----
  function finalizePayment(receivedAmount) {
    try {
      const subtotal = calc().sub;
      const receipt = {
        id: "R" + Date.now(),
        time: new Date().toISOString(),
        table: state.table || "",
        orderType: state.orderType || "",
        items: JSON.parse(JSON.stringify(state.cart || [])),
        subtotal: subtotal,
        cash: Number(receivedAmount || 0),
        change: Math.max(0, Number(receivedAmount || 0) - subtotal)
      };
      // save receipt
      const arr = loadReceipts();
      arr.unshift(receipt);
      while(arr.length > 200) arr.pop();
      saveReceipts(arr);
      // update sales daily/month
      const d = new Date().toISOString().slice(0,10);
      const m = new Date().toISOString().slice(0,7);
      const daily = loadSalesDaily(); const monthly = loadSalesMonth();
      daily[d] = daily[d] || { total:0, count:0 }; monthly[m] = monthly[m] || { total:0, count:0 };
      daily[d].total = Number(daily[d].total || 0) + Number(subtotal || 0);
      daily[d].count = Number(daily[d].count || 0) + 1;
      monthly[m].total = Number(monthly[m].total || 0) + Number(subtotal || 0);
      monthly[m].count = Number(monthly[m].count || 0) + 1;
      saveSalesDaily(daily); saveSalesMonth(monthly);
      // clear cart and cash input
      state.cart = [];
       state.table = "";
      if (cashInput) cashInput.value = '';
      saveState();
      renderCart();
      // show receipt popup 3s and speak
      showTempReceiptPopup(receipt);
    } catch(e){ console.error('finalizePayment error', e); }
  }

  function showTempReceiptPopup(receipt) {
    const old = document.getElementById('tempReceiptPopup'); if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'tempReceiptPopup';
    wrap.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2000;min-width:320px;max-width:720px;padding:12px;border-radius:10px;background:#0f1720;border:1px solid rgba(255,255,255,.06);box-shadow:0 12px 40px rgba(0,0,0,.6);color:var(--text);';
    const timeStr = new Date(receipt.time).toLocaleString('th-TH');
    const itemsHtml = (receipt.items || []).map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.03)"><div style="flex:1">${it.name}${it.spicy? ' ('+it.spicy+')':''}</div><div style="width:64px;text-align:center">${it.qty}</div><div style="width:110px;text-align:right">${money(it.price*it.qty)}</div></div>`).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:800;font-size:16px">ใบเสร็จ: ${receipt.id}</div>
          <div style="font-size:12px;color:var(--muted)">${timeStr} · โต๊ะ ${receipt.table || '-'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;color:var(--muted)">ยอดรวม</div>
          <div style="font-size:20px;font-weight:800;color:#ffd166">${money(receipt.subtotal)}</div>
        </div>
      </div>
      <div style="margin-top:8px;max-height:220px;overflow:auto;border-radius:6px;padding-top:6px">${itemsHtml || '<div class="hint">ไม่มีรายการ</div>'}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:13px;color:var(--muted)"><div>รับ: ${money(receipt.cash)} · ทอน: ${money(receipt.change)}</div></div>
    `;
    document.body.appendChild(wrap);
    try {
      const utter = new SpeechSynthesisUtterance('ขอบคุณค่ะ');
      utter.lang = 'th-TH'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(utter);
    } catch(e){ console.warn('speech failed', e); }
    setTimeout(()=> wrap.remove(), 3000);
  }

  // ---- Receipts modal ----
 // ======= Replace createReceiptsModal() and openReceiptsModal() with this =======
function createReceiptsModal(){
  if (receiptsModal) return receiptsModal;
  const wrap = document.createElement('div');
  wrap.id = 'receiptsModal';
  wrap.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:1200';
  wrap.innerHTML = `
    <div style="background:rgba(0,0,0,.55);position:absolute;inset:0"></div>
    <div style="position:relative;z-index:2;width:min(920px,96vw);height:min(80vh,860px);background:#0f1720;border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.06);box-shadow:0 12px 40px rgba(0,0,0,.6);color:var(--text);display:flex;flex-direction:column;">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">รายการใบเสร็จย้อนหลัง (ใหม่สุดบน)</h3>
        <div><button id="receiptsClose" class="btn btn--ghost">ปิด</button></div>
      </header>
      <div style="display:flex;gap:12px;flex:1;overflow:hidden">
        <div id="receiptsList" style="width:360px;border-right:1px solid rgba(255,255,255,0.04);padding-right:8px;overflow:auto;display:flex;flex-direction:column;gap:8px"></div>
        <div id="receiptDetail" style="flex:1;overflow:auto;padding-left:8px"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  receiptsModal = wrap;

  // close button
  const closeBtn = wrap.querySelector('#receiptsClose');
  if (closeBtn) closeBtn.addEventListener('click', () => { wrap.style.display = 'none'; });

  return wrap;
}

function openReceiptsModal(){
  const modal = createReceiptsModal();
  modal.style.display = 'flex';

  const listEl = modal.querySelector('#receiptsList');
  const detailEl = modal.querySelector('#receiptDetail');
  listEl.innerHTML = '';
  detailEl.innerHTML = '<p class="hint">คลิกใบเสร็จด้านซ้ายเพื่อดูรายละเอียด</p>';

  const receipts = loadReceipts() || []; // latest first
  if (!receipts.length) {
    listEl.innerHTML = '<p class="hint">ยังไม่มีใบเสร็จ</p>';
    return;
  }

  // Build list items and attach click listeners explicitly
  receipts.slice(0,200).forEach((r, idx) => {
    // create a button for accessibility and easy click area
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost receipt-item';
    btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;text-align:left';
    btn.dataset.receiptIndex = idx; // index in receipts array (latest-first)
    // left: id + time, right: sum
    const left = document.createElement('div');
    left.innerHTML = `<div style="font-weight:700">${r.id}</div><div style="font-size:12px;color:var(--muted)">${new Date(r.time).toLocaleString('th-TH')}</div>`;
    const right = document.createElement('div');
    right.innerHTML = `<div style="font-weight:800">${money(r.subtotal)}</div><div style="font-size:12px;color:var(--muted)">${(r.items||[]).length} รายการ</div>`;

    btn.appendChild(left);
    btn.appendChild(right);

    // attach click listener (use closure to capture r)
    btn.addEventListener('click', () => {
      // highlight selected
      modal.querySelectorAll('.receipt-item').forEach(x => x.classList.remove('is-selected'));
      btn.classList.add('is-selected');

      // render details
      const itemsHtml = (r.items||[]).map(it => `
        <tr>
          <td style="padding:6px 8px">${it.name}${it.spicy? ' ('+it.spicy+')':''}</td>
          <td style="text-align:center;padding:6px;width:64px">${it.qty}</td>
          <td style="text-align:right;padding:6px;width:110px">${money(it.price)}</td>
          <td style="text-align:right;padding:6px;width:120px">${money(it.price * it.qty)}</td>
        </tr>`).join('');

      detailEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:800">${r.id}</div>
            <div style="font-size:13px;color:var(--muted)">${new Date(r.time).toLocaleString('th-TH')}</div>
            <div style="font-size:13px;color:var(--muted)">โต๊ะ: ${r.table || '-' } · ประเภท: ${r.orderType || '-'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;color:var(--muted)">ยอดรวม</div>
            <div style="font-size:20px;font-weight:900;color:#ffd166">${money(r.subtotal)}</div>
          </div>
        </div>
        <div style="margin-top:8px;overflow:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr><th style="text-align:left">รายการ</th><th style="text-align:center">จำนวน</th><th style="text-align:right">ราคา/หน่วย</th><th style="text-align:right">รวม</th></tr></thead>
            <tbody>${itemsHtml || '<tr><td colspan="4" class="hint">ไม่มีรายการ</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="3" style="text-align:right;padding-top:8px">รับเงิน</td><td style="text-align:right;padding-top:8px">${money(r.cash)}</td></tr>
              <tr><td colspan="3" style="text-align:right">เงินทอน</td><td style="text-align:right">${money(r.change)}</td></tr>
            </tfoot>
          </table>
        </div>
      `;
    });

    listEl.appendChild(btn);
  });

  // auto-select first item for convenience (latest)
  const firstBtn = listEl.querySelector('.receipt-item');
  if (firstBtn) firstBtn.click();
}


  // ---- Prep modal (kitchen) ----
  function createPrepModal(){
    if (prepModal) return prepModal;
    const wrap = document.createElement('div');
    wrap.id = 'prepModal';
    wrap.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:1400';
    wrap.innerHTML = `
      <div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>
      <div style="position:relative;z-index:2;width:min(880px,96vw);max-height:90vh;overflow:auto;background:#0f1720;border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.06)">
        <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">รายการเตรียมสินค้า (เก่า→ใหม่)</h3>
          <div><button id="prepClose" class="btn btn--ghost">ปิด</button></div>
        </header>
        <div id="prepListContainer" style="display:flex;flex-direction:column;gap:10px"></div>
      </div>
    `;
    document.body.appendChild(wrap);
    prepModal = wrap;
    wrap.querySelector('#prepClose').addEventListener('click', ()=> wrap.style.display='none');
    return wrap;
  }

  function renderPrepModal(){
  try {
    const modal = createPrepModal();
    const container = modal.querySelector('#prepListContainer');
    const list = loadPrepList() || [];
    container.innerHTML = '';
    if (!list.length){
      container.innerHTML = '<p class="hint">ยังไม่มีรายการเตรียมสินค้า</p>';
      modal.style.display='flex';
      return;
    }

    // show FIFO: oldest first
    for (let i=0;i<list.length;i++){
      const o = list[i] || {};
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(255,255,255,0.02);padding:10px;border-radius:10px;display:flex;flex-direction:column;gap:8px;border:1px solid rgba(255,255,255,.03);position:relative';
      if (o.status === 'served') card.classList.add('prep-served');

      // safe items array
      const itemsArr = Array.isArray(o.items) ? o.items
                      : Array.isArray(o.menu) ? o.menu
                      : Array.isArray(o.lines) ? o.lines
                      : [];

      const subtotal = Number(o.subtotal) || itemsArr.reduce((a, it) => {
        const qty = Number(it.qty ?? it.quantity ?? 1) || 0;
        const price = Number(it.price ?? it.unitPrice ?? it.p) || 0;
        return a + qty * price;
      }, 0);

      // ---- header (โต๊ะ, id/time, type, total) ----
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap';

      const tableHtml = `
        <div style="display:flex;align-items:center;gap:12px">
          <div style="background:rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;min-width:92px;text-align:center;box-shadow:inset 0 -4px 0 rgba(0,0,0,0.12)">
            <div style="font-size:26px;font-weight:900;line-height:1">${o.table || '-'}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">โต๊ะ</div>
          </div>

          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="font-size:16px;font-weight:800">${o.id || '-'}</div>
            <div style="font-size:13px;color:var(--muted)">${o.time ? new Date(o.time).toLocaleTimeString('th-TH') : ''}</div>
          </div>
        </div>
      `;

      const orderTypeLabel = (typeof o.orderType === 'string' && o.orderType.toLowerCase().includes('dine')) ? 'กินที่ร้าน'
                          : (typeof o.orderType === 'string' && o.orderType.toLowerCase().includes('take')) ? 'กลับบ้าน'
                          : (o.orderType || '-');

      const rightHtml = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:160px">
          <div style="font-weight:800;font-size:15px;padding:6px 10px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.03)">
            ${orderTypeDisplay(o.orderType)}

          </div>
          <div style="font-size:20px;font-weight:900;">รวม ${(typeof money === 'function') ? money(subtotal) : subtotal.toFixed(2)} ฿</div>
        </div>
      `;

      head.innerHTML = tableHtml + rightHtml;
      card.appendChild(head);

      // ---- show note (if any) ----
      // ---- show note (if any) ----
      if (o.note && String(o.note).trim()) {
        const noteEl = document.createElement('div');
        noteEl.style.cssText = `
            background:rgba(255,0,0,0.1);
            padding:10px 12px;
            border-radius:8px;
            font-size:16px;
            color:#ff4d4d;
            font-weight:900;
            border-left:4px solid #ff4d4d;
        `;
        noteEl.innerHTML = `หมายเหตุ: ${String(o.note).replace(/\n/g,'<br>')}`;
        card.appendChild(noteEl);
      }


      // ---- รายการเมนู (table) ----
      const tableWrap = document.createElement('div');
      tableWrap.style.cssText = 'overflow:auto';

      const tableEl = document.createElement('table');
      tableEl.style.cssText = 'width:100%;border-collapse:collapse;font-size:14px';
      tableEl.innerHTML = `
        <thead>
          <tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.04)">
            <th style="padding:6px 8px;min-width:40px">#</th>
            <th style="padding:6px 8px">รายการ</th>
            <th style="padding:6px 8px;width:70px;text-align:right">จำนวน</th>
            <th style="padding:6px 8px;width:90px;text-align:right">หน่วยละ</th>
            <th style="padding:6px 8px;width:110px;text-align:right">รวม</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = tableEl.querySelector('tbody');

      if (!itemsArr.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="padding:10px;text-align:center;color:var(--muted)">ไม่มีรายการ</td>`;
        tbody.appendChild(tr);
      } else {
        itemsArr.forEach((it, idx) => {
          const qty = Number(it.qty ?? it.quantity ?? 1) || 0;
          const price = Number(it.price ?? it.unitPrice ?? it.p) || 0;
          const sum = qty * price;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="padding:6px 8px;vertical-align:middle">${idx+1}</td>
            <td style="padding:6px 8px;vertical-align:middle">${it.name || it.title || it.product || '-'}</td>
            <td style="padding:6px 8px;text-align:right;vertical-align:middle">${qty}</td>
            <td style="padding:6px 8px;text-align:right;vertical-align:middle">${(typeof money === 'function') ? money(price) : price.toFixed(2)}</td>
            <td style="padding:6px 8px;text-align:right;vertical-align:middle">${(typeof money === 'function') ? money(sum) : sum.toFixed(2)}</td>
          `;
          tbody.appendChild(tr);
        });
      }

      tableWrap.appendChild(tableEl);
      card.appendChild(tableWrap);

      // แสดงหมายเหตุ (ถ้ามี) — สีแดง ตัวใหญ่
      if (o.note) {
        const noteEl = document.createElement('div');
        noteEl.style.cssText = 'color:#ff3b30;font-weight:800;font-size:16px;margin-top:8px;white-space:pre-wrap;';
        noteEl.textContent = 'หมายเหตุ: ' + o.note;
        card.appendChild(noteEl);
      }




      // ---- footer buttons (use existing handlers) ----
      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:8px';

      const btnLoad = document.createElement('button'); btnLoad.className='btn btn--ghost'; btnLoad.textContent='โหลดมาชำระ';
      const btnDone = document.createElement('button'); btnDone.className='btn btn--ghost'; btnDone.textContent = o.status === 'served' ? 'เสิร์ฟแล้ว' : 'เสร็จ';
      const btnDelete = document.createElement('button'); btnDelete.className='btn btn--ghost'; btnDelete.textContent='ลบ';

      btnLoad.addEventListener('click', () => {
        const all = loadPrepList();
        const pos = all.findIndex(x => x.id === o.id);
        if (pos === -1) { alert('ไม่พบรายการในคิว (อาจถูกลบไปแล้ว)'); return; }
        const picked = all.splice(pos,1)[0];
        savePrepList(all);
        state.cart = JSON.parse(JSON.stringify(picked.items || []));
        state.table = picked.table || '';
        state.orderType = picked.orderType || '';
        saveState();
        renderCart();
        modal.style.display = 'none';
      });

      btnDone.addEventListener('click', () => {
        const all = loadPrepList();
        const pos = all.findIndex(x => x.id === o.id);
        if (pos === -1) { alert('ไม่พบรายการ'); return; }
        all[pos].status = 'served';
        savePrepList(all);
        renderPrepModal();
      });

      btnDelete.addEventListener('click', () => {
        if (!confirm('ต้องการลบรายการเตรียมสินค้านี้จริงหรือไม่?')) return;
        const all = loadPrepList();
        const pos = all.findIndex(x => x.id === o.id);
        if (pos !== -1) { all.splice(pos,1); savePrepList(all); }
        renderPrepModal();
      });

      footer.appendChild(btnLoad); footer.appendChild(btnDone); footer.appendChild(btnDelete);
      card.appendChild(footer);

      if (o.status === 'served') {
        const badge = document.createElement('div'); badge.className = 'prep-status-badge prep-status-served'; badge.textContent = 'เสิร์ฟแล้ว';
        card.appendChild(badge);
      }

      container.appendChild(card);
    }

    modal.style.display = 'flex';
  } catch (err) {
    console.error('renderPrepModal error:', err);
    const modal = createPrepModal();
    modal.querySelector('#prepListContainer').innerHTML = '<p class="hint">เกิดข้อผิดพลาดในการโหลดรายการเตรียมสินค้า</p>';
    modal.style.display = 'flex';
  }
}



  // ---- Order confirm popup (create prep order) ----
  function createOrderConfirmPopup(){
    let ex = $('#orderConfirmPopup');
    if (ex) return ex;
    const popup = document.createElement('div');
    popup.id = 'orderConfirmPopup';
    popup.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:1500';
    popup.innerHTML = `
      <div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>
      <div style="position:relative;z-index:2;width:min(720px,96vw);background:#0f1720;border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.06)">
        <h3 style="margin:0 0 8px">ยืนยันสั่งอาหาร</h3>
        <div id="orderConfirmBody" style="max-height:320px;overflow:auto"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
          <button id="orderCancel" class="btn btn--ghost">ยกเลิก</button>
          <button id="orderConfirmConfirm" class="btn btn--primary">ยืนยันสั่งอาหาร</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector('#orderCancel').addEventListener('click', ()=> popup.style.display='none');
    return popup;
  }

// --- เพิ่ม helper แปลงค่า orderType ให้เป็นฉลากภาษาไทย ---
function orderTypeLabel(v) {
  if (v === null || typeof v === 'undefined' || v === '') return '-';
  const s = String(v).toLowerCase().trim();

  // คำสำคัญที่บอกว่าเป็น "ทานที่ร้าน"
  const dineKeys = ['dine', 'dine-in', 'eat', 'eat-in', 'in-store', 'in', 'ร้าน', 'ทาน', 'นั่ง', 'here'];
  // คำสำคัญที่บอกว่าเป็น "กลับบ้าน"
  const takeKeys = ['take', 'takeaway', 'take-away', 'to-go', 'carry', 'กลับ', 'กลับบ้าน', 'home', 'pack'];

  // ให้ตรวจหา keyword แบบแม่นยำ: ถ้ามีคำใดจาก dineKeys ให้เลือกทานที่ร้าน
  for (let k of dineKeys) {
    if (s.includes(k)) return 'ทานที่ร้าน';
  }
  // ถ้ายังไม่ match ค่อยตรวจ takeKeys
  for (let k of takeKeys) {
    if (s.includes(k)) return 'กลับบ้าน';
  }

  // กรณีที่เป็นคำสั้น ๆ เช่น 'in' อาจโดนจับผิด — เรามีตรวจขยายด้านบนแล้ว
  // ถ้าไม่ match อะไรเลย คืนค่าของต้นฉบับ (เพื่อ debug จะเห็นค่า)
  return String(v);
}



const orderTypeDisplay = (type) => {
  const label = orderTypeLabel(type);

  // สไตล์สำหรับ "ทานที่ร้าน" (สีเขียว)
  if (label === 'ทานที่ร้าน') {
    return `
      <div style="
        background:rgba(0,180,0,0.15);
        color:#00c853;
        font-weight:900;
        font-size:20px;
        padding:8px 14px;
        border-radius:10px;
        border-left:4px solid #00c853;
        text-align:center;
      ">
        ${label}
      </div>
    `;
  }

  // สไตล์สำหรับ "กลับบ้าน" (สีน้ำเงิน)
  return `
    <div style="
      background:rgba(0,102,255,0.15);
      color:#1e90ff;
      font-weight:900;
      font-size:20px;
      padding:8px 14px;
      border-radius:10px;
      border-left:4px solid #1e90ff;
      text-align:center;
    ">
      ${label}
    </div>
  `;
};








  function openOrderConfirmPopup(){
  try {
    if (!state.cart || !state.cart.length) return alert('ยังไม่มีรายการในตะกร้า');

    const modal = createOrderConfirmPopup();
    const body = modal.querySelector('#orderConfirmBody');
    body.innerHTML = ''; // clear

    // recalc subtotal defensively
    const subtotal = (typeof calc === 'function') ? calc().sub : (Array.isArray(state.cart) ? state.cart.reduce((a,i) => a + (Number(i.price)||0)*(Number(i.qty)||0), 0) : 0);

    // header (table big, label, total)
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:12px';
    left.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);padding:12px 16px;border-radius:10px;text-align:center;min-width:92px">
        <div style="font-size:32px;font-weight:900;line-height:1">${state.table || '-'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">โต๊ะ</div>
      </div>
      <div style="display:flex;flex-direction:column">
        <div style="font-size:16px;font-weight:800">ยืนยันคำสั่งซื้อ</div>
        <div style="font-size:13px;color:var(--muted)">${new Date().toLocaleString('th-TH')}</div>
      </div>
    `;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:170px';
    // IMPORTANT: use ${orderTypeDisplay(...)} without an extra '<'
    right.innerHTML = `
      <div style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.04);font-weight:800">
        ${orderTypeDisplay(state.orderType)}
      </div>
      <div style="font-size:24px;font-weight:900;margin-top:8px">รวม ${(typeof money === 'function') ? money(subtotal) : Number(subtotal||0).toFixed(2)} ฿</div>
    `;

    header.appendChild(left);
    header.appendChild(right);
    body.appendChild(header);

    // items table
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'max-height:320px;overflow:auto;border-top:1px solid rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.02);padding-top:8px;padding-bottom:8px';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:14px';
    table.innerHTML = `
      <thead>
        <tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.04)">
          <th style="padding:6px 8px;min-width:40px">#</th>
          <th style="padding:6px 8px">รายการ</th>
          <th style="padding:6px 8px;width:70px;text-align:right">จำนวน</th>
          <th style="padding:6px 8px;width:90px;text-align:right">หน่วยละ</th>
          <th style="padding:6px 8px;width:110px;text-align:right">รวม</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    (Array.isArray(state.cart) ? state.cart : []).forEach((it, idx) => {
      const qty = Number(it.qty ?? it.quantity ?? 1) || 0;
      const price = Number(it.price ?? it.unitPrice ?? 0) || 0;
      const sum = qty * price;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px 6px;vertical-align:middle">${idx+1}</td>
        <td style="padding:8px 6px;vertical-align:middle">
          <div style="font-weight:700">${it.name || '-'}</div>
          ${it.spicy ? `<div style="font-size:12px;color:var(--muted)">เผ็ด: ${it.spicy}</div>` : ''}
          ${it.note ? `<div style="font-size:12px;color:var(--muted)">หมายเหตุ: ${it.note}</div>` : ''}
        </td>
        <td style="padding:8px 6px;text-align:right;vertical-align:middle">${qty}</td>
        <td style="padding:8px 6px;text-align:right;vertical-align:middle">${(typeof money === 'function') ? money(price) : Number(price).toFixed(2)}</td>
        <td style="padding:8px 6px;text-align:right;vertical-align:middle">${(typeof money === 'function') ? money(sum) : Number(sum).toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    // footer: note input + buttons
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap';

    const noteWrap = document.createElement('div');
    noteWrap.style.cssText = 'flex:1;min-width:180px';
    noteWrap.innerHTML = `<input id="orderConfirmNote" placeholder="หมายเหตุ (เช่น ไม่ใส่ผงชูรส)" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:transparent;color:inherit">`;

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;align-items:center';

    const btnCancel = modal.querySelector('#orderCancel');
    const btnConfirm = modal.querySelector('#orderConfirmConfirm');

    // <<< เพิ่มบรรทัดนี้เพื่อ reset ปุ่มทุกครั้งที่เปิด modal >>>
    if (btnConfirm) btnConfirm.disabled = false;

    btnCancel.onclick = () => { 
      // ensure confirm is enabled for next open
      try { if (btnConfirm) btnConfirm.disabled = false; } catch(e) {}
      modal.style.display = 'none'; 
    };

    btnConfirm.onclick = () => {
      // immediately disable to prevent double-clicks
      btnConfirm.disabled = true;
      try {
        const note = (document.getElementById('orderConfirmNote')?.value || '').trim();

        // recompute subtotal here (defensive)
        const subtotalNow = (typeof calc === 'function') ? calc().sub : subtotal;

        // ensure orderType is whatever current state says (do NOT force-reset prematurely)
        // ก่อนสร้าง object order ให้ใช้วิธีนี้เพื่อรับค่า orderType
        const orderTypeVal =
          (document.querySelector('#orderType') && document.querySelector('#orderType').value)
          || (typeof state !== 'undefined' && state.orderType) 
          || 'dine-in';

        // สร้าง order ด้วย orderTypeVal
        const order = {
          id: "P" + Date.now().toString(36).toUpperCase(),
          time: new Date().toISOString(),
          table: state.table || '',
          orderType: orderTypeVal,
          orderTypeLabel: orderTypeLabel(orderTypeVal),
          note: note || '',
          items: JSON.parse(JSON.stringify(state.cart || [])),
          subtotal: subtotalNow,
          status: 'pending'
        };

        const list = loadPrepList() || [];
        list.push(order);
        savePrepList(list);

        // clear cart and table if desired; keep orderType or reset depending on behavior
        state.cart = [];
        state.table = "";
        // do NOT forcibly overwrite orderType here (keeps user's selection for next bill)
        // state.orderType = "dine-in";
        saveState();
        renderCart();

        modal.style.display = 'none';
        // ensure button is enabled for next time (defensive)
        try { if (btnConfirm) btnConfirm.disabled = false; } catch(e) {}
        try { if (typeof showToast === 'function') showToast('สั่งอาหารเรียบร้อย'); } catch(e) {}
      } catch (err) {
        console.error('confirm order error', err);
        alert('เกิดข้อผิดพลาด ขณะยืนยันคำสั่ง โปรดลองอีกครั้ง');
        // re-enable to allow retry
        try { if (btnConfirm) btnConfirm.disabled = false; } catch(e) {}
      }
    };

    // append footer parts
    footer.appendChild(noteWrap);
    // if you want the buttons container visible inside footer, append it:
    footer.appendChild(btns);
    body.appendChild(footer);

    // show and focus input
    modal.style.display = 'flex';
    setTimeout(() => { const ni = document.getElementById('orderConfirmNote'); if (ni) ni.focus(); }, 50);

  } catch (err) {
    console.error('openOrderConfirmPopup error', err);
    alert('เกิดข้อผิดพลาด ขณะเตรียมหน้ายืนยันคำสั่ง');
  }
}




  // ---- Ensure control buttons: receipts, sales, prep, orderNow ----
  function ensureControlButtons(){
    const cartHeaderActions = document.querySelector('.cart__actions') || document.querySelector('.cart__header') || document.querySelector('.cart__top');
    if (!cartHeaderActions) return;
    if (!document.getElementById('btnReceipts')) {
      const btnR = document.createElement('button'); btnR.id='btnReceipts'; btnR.className='btn btn--ghost'; btnR.textContent='ใบเสร็จ'; btnR.addEventListener('click', ()=> openReceiptsModal());
      cartHeaderActions.appendChild(btnR);
    }
    if (!document.getElementById('btnSales')) {
      const btnS = document.createElement('button'); btnS.id='btnSales'; btnS.className='btn btn--ghost'; btnS.textContent='ดูยอดวันนี้'; btnS.addEventListener('click', ()=> showSalesToday());
      cartHeaderActions.appendChild(btnS);
    }
    // orderNow + prep button near cart footer
    const cartFooter = document.querySelector('.cart__footer') || document.querySelector('.cart__actions') || document.querySelector('.cart__bottom');
    if (!cartFooter) return;
    if (!document.getElementById('orderNowBtn')) {
      const btn = document.createElement('button'); btn.id='orderNowBtn'; btn.className='btn btn--primary'; btn.textContent='สั่งอาหาร'; btn.style.marginRight='8px';
      btn.addEventListener('click', ()=> openOrderConfirmPopup());
      cartFooter.insertBefore(btn, cartFooter.firstChild);
    }
    if (!document.getElementById('prepNextBtn')) {
      const prepBtn = document.createElement('button'); prepBtn.id='prepNextBtn'; prepBtn.className='btn btn--ghost'; prepBtn.textContent='รายการเตรียม'; prepBtn.style.marginLeft='6px';
      prepBtn.addEventListener('click', ()=> renderPrepModal());
      const orderBtn = document.getElementById('orderNowBtn');
      if (orderBtn && orderBtn.parentNode) orderBtn.parentNode.insertBefore(prepBtn, orderBtn.nextSibling);
      else cartFooter.appendChild(prepBtn);
    }
  }

  // ---- Sales popup ----
  let salesPopup = null, salesPopupTimeout = null;
  function createSalesPopup() {
    if (salesPopup) return salesPopup;
    const el = document.createElement('div'); el.id='salesPopup'; el.style.cssText='position:fixed;right:18px;top:18px;z-index:1300;display:none;min-width:260px;max-width:360px';
    el.innerHTML = `<div style="background:#0f1720;border:1px solid rgba(255,255,255,.06);padding:12px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);color:var(--text)"><div style="display:flex;justify-content:space-between;align-items:center"><strong id="salesTitle">ยอดขายวันนี้</strong><button id="salesClose" class="btn btn--ghost">ปิด</button></div><div id="salesBody" style="margin-top:8px;font-size:18px"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button id="salesYesterday" class="btn btn--ghost">ยอดเมื่อวาน</button><button id="salesMonth" class="btn btn--ghost">ยอดเดือนนี้</button></div></div>`;
    document.body.appendChild(el);
    salesPopup = el;
    el.querySelector('#salesClose').addEventListener('click', ()=> hideSalesPopup());
    el.querySelector('#salesYesterday').addEventListener('click', ()=> showSalesRelative(-1));
    el.querySelector('#salesMonth').addEventListener('click', ()=> showSalesMonth());
    return el;
  }
  function showSalesPopupForDate(dateStr) {
    const el = createSalesPopup();
    const daily = loadSalesDaily();
    const val = daily[dateStr];
    const body = el.querySelector('#salesBody');
    body.innerHTML = val ? `${money(val.total)} <div style="font-size:12px;color:var(--muted)">จำนวนบิล ${val.count}</div>` : `${money(0)} <div style="font-size:12px;color:var(--muted)">ไม่มีบิล</div>`;
    el.querySelector('#salesTitle').textContent = `ยอดขาย ${new Date(dateStr).toLocaleDateString('th-TH')}`;
    el.style.display = 'block';
    if (salesPopupTimeout) clearTimeout(salesPopupTimeout);
    salesPopupTimeout = setTimeout(()=> hideSalesPopup(), 10000);
  }
  function showSalesToday(){ const d = new Date().toISOString().slice(0,10); showSalesPopupForDate(d); }
  function showSalesRelative(offset){ const d = new Date(); d.setDate(d.getDate()+offset); showSalesPopupForDate(d.toISOString().slice(0,10)); }
  function showSalesMonth(){ const m = new Date().toISOString().slice(0,7); const monthly = loadSalesMonth(); const val = monthly[m]; const el = createSalesPopup(); const body = el.querySelector('#salesBody'); body.innerHTML = val ? `${money(val.total)} <div style="font-size:12px;color:var(--muted)">จำนวนบิล ${val.count}</div>` : `${money(0)} <div style="font-size:12px;color:var(--muted)">ไม่มีข้อมูล</div>`; el.querySelector('#salesTitle').textContent = `ยอดเดือน ${m}`; if (salesPopupTimeout) clearTimeout(salesPopupTimeout); salesPopupTimeout = setTimeout(()=>hideSalesPopup(),10000); el.style.display='block'; }
  function hideSalesPopup(){ if (salesPopup) salesPopup.style.display='none'; if (salesPopupTimeout) { clearTimeout(salesPopupTimeout); salesPopupTimeout=null; } }

  // ---- binding ----
  function bind(){
    // cart qty click
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.matches('.qty-btn')) {
        const act = t.dataset.act; const idx = Number(t.dataset.idx);
        if (act === 'inc') updateQty(idx,1);
        if (act === 'dec') updateQty(idx,-1);
      }
    });

    // search
    if (searchInput) searchInput.addEventListener('input', (e) => renderMenu(document.querySelector('.tab.is-active')?.dataset.cat || 'all', e.target.value.trim()));

    // tabs
    tabs.forEach(tb => tb.addEventListener('click', (ev) => {
      tabs.forEach(x => x.classList.remove('is-active'));
      ev.target.classList.add('is-active');
      renderMenu(ev.target.dataset.cat || 'all', searchInput?.value?.trim() || "");
    }));

    // clear cart
    if (clearBtn) clearBtn.addEventListener('click', ()=> { if (confirm('ล้างตะกร้าจริงหรือไม่?')) clearCart(); });

    // hold / retrieve
    if (holdBtn) holdBtn.addEventListener('click', ()=> holdBill());
    if (retrieveBtn) retrieveBtn.addEventListener('click', ()=> retrieveBill());

    // pay button open payment modal
    if (payBtn) payBtn.addEventListener('click', (e) => { e.preventDefault(); if (!state.cart || !state.cart.length) return alert('ยังไม่มีรายการ'); openPaymentModal(); });

    // ensure other controls
    ensureControlButtons();

    // add item button
    if (addItemBtn) addItemBtn.addEventListener('click', ()=> openAddModal());

    // bind tableInput and orderType to state (prevent table disappearing)
    if (tableInput) {
      tableInput.value = state.table || '';
      tableInput.addEventListener('input', (e) => { state.table = e.target.value; saveState(); });
      tableInput.addEventListener('blur', (e) => { state.table = (e.target.value||'').trim(); tableInput.value = state.table; saveState(); });
    }
    if (orderTypeEl) {
      orderTypeEl.value = state.orderType || 'dine-in';
      orderTypeEl.addEventListener('change', (e) => { state.orderType = e.target.value; saveState(); });
    }
  }


// --- Ensure addModal specific close controls are wired (id selectors from index.html) ---
document.addEventListener('DOMContentLoaded', function(){
  try {
    const addModalEl = document.getElementById('addModal');
    if (!addModalEl) return;
    const btnClose = document.getElementById('addClose');
    const btnCancel = document.getElementById('addCancel');
    const backdrop = document.getElementById('addBackdrop');

    function closeAddModal() {
      addModalEl.classList.remove('is-open');
      addModalEl.setAttribute('aria-hidden', 'true');
    }

    if (btnClose) {
      btnClose.addEventListener('click', (e) => { e.preventDefault(); closeAddModal(); });
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', (e) => { e.preventDefault(); closeAddModal(); });
    }
    if (backdrop) {
      backdrop.addEventListener('click', (e) => { e.preventDefault(); closeAddModal(); });
    }

    // Also handle Escape key to close the modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && addModalEl.classList.contains('is-open')) {
        closeAddModal();
      }
    });
  } catch (err) { console.warn('bind addModal close failed', err); }
});

// --- Text-to-speech helpers: speak menu name+price and speak order confirmation ---
(function(){
  function speakText(txt) {
    try {
      if (!window.speechSynthesis) return;
      // stop any previous speech to avoid overlap
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'th-TH';
      u.rate = 0.95;
      u.pitch = 1.0;
      // try to pick a Thai voice when available
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) {
        const thai = voices.find(v => /th|thai/i.test(v.lang) || /thai/i.test(v.name));
        if (thai) u.voice = thai;
      }
      window.speechSynthesis.speak(u);
    } catch(e){ console.warn('speakText error', e); }
  }

  function speakMenu(item) {
    try {
      if (!item) return;
      const price = Number(item.price) || 0;
      const p = Number.isInteger(price) ? price : price.toFixed(2);
      const txt = `${item.name} ราคา ${p} บาท`;
      speakText(txt);
    } catch(e){ console.warn('speakMenu error', e); }
  }

  // listen for clicks on menu cards and speak (delegated)
  document.addEventListener('click', function(ev){
    try {
      // find nearest menu card
      const card = ev.target.closest && ev.target.closest('.card');
      if (!card) return;
      const id = card.dataset && card.dataset.id;
      if (!id) return;
      // ignore clicks on buttons inside the card (like edit)
      if (ev.target.closest && ev.target.closest('button, .btn')) return;
      // get item from menu and speak
      if (typeof loadMenu === 'function') {
        const item = loadMenu().find(x => x.id === id);
        if (item) speakMenu(item);
      }
    } catch(err){ /* ignore */ }
  }, true);

  // speak when directly adding (for items that add straight without modal)
  // we also catch click on elements that call addToCart by dataset-id if needed
  document.addEventListener('click', function(ev){
    try {
      const t = ev.target;
      // element with data-add-id (optional pattern)
      if (t && t.dataset && t.dataset.addId) {
        const id = t.dataset.addId;
        if (typeof loadMenu === 'function') {
          const item = loadMenu().find(x => x.id === id);
          if (item) speakMenu(item);
        }
      }
    } catch(e){}
  }, true);

  // speak when confirming order: button id 'orderConfirmConfirm'
  document.addEventListener('click', function(ev){
    try {
      const t = ev.target;
      if (t && (t.id === 'orderConfirmConfirm' || t.classList.contains('order-confirm'))) {
        // delay slightly to avoid overlapping with previous TTS
        setTimeout(() => speakText('สั่งอาหารแล้ว'), 150);
      }
    } catch(e){}
  }, true);

})();


// --- TTS for Payment: speak subtotal + change ---
(function(){

  function speak(txt) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "th-TH";
      u.rate = 0.95;
      const voices = window.speechSynthesis.getVoices();
      const th = voices.find(v => /th|thai/i.test(v.lang));
      if (th) u.voice = th;
      window.speechSynthesis.speak(u);
    } catch(e){ console.warn("TTS error", e); }
  }

  // 🔊 พูดยอดรวมเมื่อเปิด Pop-up ชำระเงิน
  document.addEventListener("click", function(ev){
    const btn = ev.target.closest("#payBtn");
    if (!btn) return;

    setTimeout(() => {
      try {
        const subtotalEl = document.querySelector("#payTotal");
        if (!subtotalEl) return;

        const txt = subtotalEl.textContent.replace("฿","").trim();
        const num = Number(txt.replace(/,/g,""));
        if (!isNaN(num)) speak(`ยอดรวม ${num} บาท`);
      } catch(e){}
    }, 300);
  });

  // 🔊 พูดเงินทอนเมื่อกด "เสร็จสิ้น"
  document.addEventListener("click", function(ev){
    const btn = ev.target.closest("#payConfirm");
    if (!btn) return;

    setTimeout(() => {
      try {
        const changeEl = document.querySelector("#payChange");
        if (!changeEl) return;

        const txt = changeEl.textContent.replace("฿","").trim();
        const num = Number(txt.replace(/,/g,""));

        if (!isNaN(num) && num > 0) {
          // speak(`เงินทอน ${num} บาท`);
        }
      } catch(e){}
    }, 200);
  });

})();









// --- Speak change immediately when it becomes > 0 ---
// --- Improved payment TTS: speak "รับเงิน X บาท" first, then "เงินทอน Y บาท" ---
(function(){
  let lastSpokenReceived = null;
  let lastSpokenChange = null;
  let speakTimer = null;

  function speakNow(txt) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'th-TH';
      u.rate = 0.95;
      const voices = window.speechSynthesis.getVoices();
      const thai = voices && voices.find(v => /th|thai/i.test(v.lang) || /thai/i.test(v.name));
      if (thai) u.voice = thai;
      window.speechSynthesis.speak(u);
    } catch(e){ console.warn('speakNow error', e); }
  }

  function parseMoneyText(str){
    if (str === null || str === undefined) return 0;
    try {
      return Number(String(str).replace(/[^\d.-]+/g,'') || 0);
    } catch(e){ return 0; }
  }

  // ---- TTS helpers: return utterance so caller can chain onend ----
function speakNow(txt, opts = {}) {
  try {
    if (!window.speechSynthesis) return null;
    // cancel only if opts.cancelExisting === true (safe guard)
    if (opts.cancelExisting) window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(txt);
    u.lang = opts.lang || 'th-TH';
    // allow caller to override rate if needed, default comfortable speed
    u.rate = (typeof opts.rate === 'number') ? opts.rate : 1.0;
    const voices = window.speechSynthesis.getVoices();
    // try to pick Thai voice if available
    const thai = voices && voices.find(v => /th|thai/i.test(v.lang) || /thai/i.test(v.name));
    if (thai) u.voice = thai;

    // return the utterance but also speak it
    window.speechSynthesis.speak(u);
    return u;
  } catch (e) {
    console.warn('speakNow error', e);
    return null;
  }
}

/*
 Improved: speakReceiveThenChange
 - สั่งพูด "รับเงิน ..." โดยรับ utterance กลับมา
 - ถ้าต้องพูดเงินทอน (change > 0) จะรอ event onend ของ utterance ก่อน แล้วจึงพูดเงินทอน
 - กรณีไม่มี received แต่มี change (แปลว่ระบบคำนวณจาก received state อื่น) จะพูดเงินทอนทันที
 - ป้องกันการพูดซ้ำด้วย lastSpokenReceived/Change (ถ้ามีในโค้ดเดิม)
*/
function speakReceiveThenChange(received, change) {
  try {
    const r = Math.round((Number(received) + Number.EPSILON) * 100) / 100;
    const c = Math.round((Number(change) + Number.EPSILON) * 100) / 100;

    // หากมีตัวแปร lastSpokenReceived/lastSpokenChange ใน scope เดิมให้ใช้งานได้ (หรือจะไม่มีก็ไม่เป็นไร)
    if (typeof lastSpokenReceived !== 'undefined' && typeof lastSpokenChange !== 'undefined') {
      if (lastSpokenReceived === r && lastSpokenChange === c) return;
      lastSpokenReceived = r;
      lastSpokenChange = c;
    }

    // ถ้ามี received ให้พูดก่อน และรอ onend แล้วค่อยพูด change (ถ้ามี)
    if (r > 0) {
      // ปรับรูปประโยคสำหรับจำนวนเต็ม/ทศนิยม
      const rText = Number.isInteger(r) ? `รับเงิน ${r} บาท` : `รับเงิน ${r.toFixed(2)} บาท`;
      const u = speakNow(rText, { cancelExisting: true, rate: 1.0 });

      if (c > 0) {
        // ถ้าได้ utterance ให้ต่อด้วย onend, ถ้าไม่ได้ (browser ปัญหา) ให้ fallback เป็น timeout
        if (u) {
          u.onend = () => {
            // small pause (optional) เพื่อคนฟังตามทันก่อนพูดเงินทอน
            setTimeout(() => {
              const cText = Number.isInteger(c) ? `เงินทอน ${c} บาท` : `เงินทอน ${c.toFixed(2)} บาท`;
              speakNow(cText, { cancelExisting: false, rate: 1.0 });
            }, 120); // 120ms pause หลังรับเงินจบ (ปรับได้)
          };
          u.onerror = () => {
            // fallback: speak change after short delay
            setTimeout(() => {
              const cText = Number.isInteger(c) ? `เงินทอน ${c} บาท` : `เงินทอน ${c.toFixed(2)} บาท`;
              speakNow(cText, { cancelExisting: false, rate: 1.0 });
            }, 350);
          };
        } else {
          // no utterance returned → fallback: delayed speak
          setTimeout(() => {
            const cText = Number.isInteger(c) ? `เงินทอน ${c} บาท` : `เงินทอน ${c.toFixed(2)} บาท`;
            speakNow(cText, { cancelExisting: false, rate: 1.0 });
          }, 600);
        }
      }
    } else {
      // ไม่มี received แต่มี change ให้พูดเงินทอนทันที (กรณีพิเศษ)
      if (c > 0) {
        const cText = Number.isInteger(c) ? `เงินทอน ${c} บาท` : `เงินทอน ${c.toFixed(2)} บาท`;
        speakNow(cText, { cancelExisting: true, rate: 1.0 });
      }
    }
  } catch (e) {
    console.warn('speakReceiveThenChange error', e);
  }
}


  // central checker: read #payReceived (or #payManual) and #payChange
  function checkPaymentSpeak(){
    try {
      const changeEl = document.querySelector('#payChange');
      const recvManual = document.querySelector('#payManual');
      const recvDisplay = document.querySelector('#payReceived');
      const recvText = (recvManual && recvManual.value !== undefined && String(recvManual.value).trim() !== '') ? recvManual.value : (recvDisplay ? recvDisplay.textContent : '');
      const received = parseMoneyText(recvText);
      const change = changeEl ? parseMoneyText(changeEl.textContent || changeEl.innerText || changeEl.value) : 0;
      // Only trigger when received > 0 (or change > 0)
      if ((received > 0 || change > 0)) {
        speakReceiveThenChange(received, change);
      } else {
        // reset last values when nothing to announce
        lastSpokenReceived = null;
        lastSpokenChange = null;
      }
    } catch(e){ console.warn('checkPaymentSpeak error', e); }
  }

  // listen input on payManual
  document.addEventListener('input', function(ev){
    try {
      if (ev.target && ev.target.id === 'payManual') {
        // debounce small delay
        clearTimeout(speakTimer);
        speakTimer = setTimeout(() => checkPaymentSpeak(), 120);
      }
    } catch(e){}
  }, true);

  // listen denom buttons clicks (class .btn-denom--blue used earlier)
  document.addEventListener('click', function(ev){
    try {
      const btn = ev.target.closest && ev.target.closest('.btn-denom--blue');
      if (btn) {
        // small delay to allow UI updates
        setTimeout(() => checkPaymentSpeak(), 120);
      }
      // also listen to payExact button and payClear
      if (ev.target && (ev.target.id === 'payExactBtn' || ev.target.id === 'payClearBtn')) {
        setTimeout(() => checkPaymentSpeak(), 120);
      }
    } catch(e){}
  }, true);

  // Observe #payChange node for changes (fallback)
  function attachObserver(){
    try {
      const node = document.querySelector('#payChange');
      if (!node) return;
      const mo = new MutationObserver(() => {
        setTimeout(() => checkPaymentSpeak(), 60);
      });
      mo.observe(node, { childList: true, characterData: true, subtree: true });
    } catch(e){ console.warn('attachObserver error', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachObserver); else attachObserver();

  // reset lastSpoken when opening payment modal
  document.addEventListener('click', function(ev){
    try {
      if (ev.target && (ev.target.id === 'payBtn' || ev.target.closest && ev.target.closest('#paymentModal'))) {
        lastSpokenReceived = null;
        lastSpokenChange = null;
      }
    } catch(e){}
  }, true);

})();























  // ---- Init ----
  function init(){
    MENU = loadMenu();
    state = loadJSON(CART_KEY, { cart: [], heldBills: [], table:"", orderType:"dine-in" });
    bind();
    ensureControlButtons();
    renderMenu("all", "");
    renderCart();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // ---- Expose helpers for debug ----
  window._pos_helpers = {
    loadMenu, saveMenuList, loadReceipts, loadPrepList, addDenom, openPaymentModal, renderMenu, renderCart, saveState
  };

})();

// --- listener: update orderType when user selects ---
const orderTypeEl = document.querySelector('#orderType');
if (orderTypeEl) {
  orderTypeEl.addEventListener('change', (e) => {
    state.orderType = e.target.value;
    saveState();
  });
}


// วางไว้ตอน DOM โหลดเสร็จ (วางไว้ท้ายไฟล์ app.js หลัง init())
document.addEventListener('DOMContentLoaded', () => {
  const orderTypeEl = document.querySelector('#orderType');
  if (!orderTypeEl) {
    console.warn('orderType select not found (#orderType)');
    return;
  }
  // debug log — ลบออกได้เมื่อแน่ใจแล้ว
  orderTypeEl.addEventListener('change', (e) => {
    console.log('orderType changed ->', e.target.value);
    // บันทึกเข้า state ทันที
    window.state = window.state || {};
    window.state.orderType = e.target.value;
    if (typeof saveState === 'function') saveState();
  });
});
