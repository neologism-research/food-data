// Snack box (零食盒): the user puts packaged products into a box and sees the protein / carbohydrate /
// fat of each product and of the whole box, where each macronutrient comes from, and an AI comment on
// the combination. Uses the helpers of app.js and products.js (api, esc, fmtNum, macros, thumb, runAi ...).
// Boxes are kept in this browser (localStorage); nothing is saved on the server except AI answers.
// Routes:  #/box  (all boxes)   #/box/<id>  (one box)
"use strict";

const BOX_KEY = "snackBoxes";
// Product identity colours: the validated categorical palette (dataviz skill), in fixed order. A product
// keeps its slot while it stays in the box; products past the 8th share the "other" grey.
const BOX_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const BOX_OTHER = "#B9B4A9";

function boxStore() {
  try {
    const s = JSON.parse(localStorage.getItem(BOX_KEY) || "null");
    if (s && Array.isArray(s.boxes)) return s;
  } catch { /* broken data: start again */ }
  return { boxes: [], active: null };
}
function saveBoxes(s) {
  localStorage.setItem(BOX_KEY, JSON.stringify(s));
  updateBoxBadge();
}
function newBox(s, name) {
  const box = { id: Date.now().toString(36), name: name || `零食盒 ${s.boxes.length + 1}`, created: new Date().toISOString(), items: [] };
  s.boxes.push(box);
  s.active = box.id;
  return box;
}
const findBox = (s, id) => s.boxes.find((b) => b.id === id);
const activeBox = (s) => findBox(s, s.active) || s.boxes[s.boxes.length - 1] || null;

function updateBoxBadge() {
  const el = document.getElementById("boxN");
  if (!el) return;
  const b = activeBox(boxStore());
  const n = b ? b.items.length : 0;
  el.textContent = n ? String(n) : "";
  el.hidden = !n;
}

// A box item: a copy of the product data the box needs, so the box opens without reading every product.
function boxItem(p, amount) {
  const n = p.nutrients || {};
  const v = (k, col = k) => (typeof n[k] === "number" ? n[k] : typeof p[col] === "number" ? p[col] : null);
  const unit = perUnit(p) === "毫升" ? "ml" : "g";
  return {
    code: p.code, name: p.name, brand: p.brand || null, image: p.image || null, unit,
    per100: { kcal: v("energy_kcal"), p: v("protein"), c: v("carbohydrate"), f: v("fat"), sugars: v("sugars"), sodium: v("sodium") },
    has: !!p.has_nutrition, serving_g: p.serving_g > 0 ? p.serving_g : null, serving_size: p.serving_size || null,
    amount: Math.round(amount || (p.serving_g > 0 ? p.serving_g : 100)), color: null,
  };
}

// Add to a box (the active one; a new box if there is none). The same product again adds its amount.
function addToBox(item, boxId = null) {
  const s = boxStore();
  const box = (boxId && findBox(s, boxId)) || activeBox(s) || newBox(s, "我的零食盒");
  s.active = box.id;
  const old = box.items.find((i) => i.code === item.code);
  if (old) old.amount = Math.min(old.amount + item.amount, 5000);
  else {
    const used = new Set(box.items.map((i) => i.color));
    item.color = BOX_COLORS.find((c) => !used.has(c)) || null;
    box.items.push(item);
  }
  saveBoxes(s);
  return box;
}

function toast(html) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.innerHTML = html;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), 3200);
}

// Product page: "加入零食盒" with the amount chosen there
function addProductToBox(p, amount) {
  const box = addToBox(boxItem(p, amount));
  toast(`已把 ${fmtNum(amount)}${perUnit(p)}「${esc(p.name)}」加入「${esc(box.name)}」 <a href="#/box/${box.id}">查看零食盒 ›</a>`);
}

// ---------- routes ----------

async function boxRoute(parts) {
  setActiveGroup(null);
  if (parts[0]) return boxPage(parts[0]);
  return boxList();
}

function boxTotals(box) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, sugars: 0, sodium: 0, missing: 0 };
  for (const i of box.items) {
    if (!i.has) { t.missing++; continue; }
    const k = i.amount / 100;
    for (const key of ["kcal", "p", "c", "f", "sugars", "sodium"]) t[key] += (i.per100[key] || 0) * k;
  }
  return t;
}

function boxList() {
  document.title = "零食盒 - 包裝食品 - 食物營養資料庫";
  const s = boxStore();
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], ["零食盒", ""]])}
    <h1 class="page">零食盒</h1>
    <p class="muted">把幾件零食放進零食盒，即時計算整盒的蛋白質、碳水化合物及脂肪，並由 AI 評估這個組合。零食盒只儲存在這部裝置的瀏覽器。</p>
    <div class="box-grid">
      <button type="button" class="box-card new" id="newBox">
        <span class="plus" aria-hidden="true">＋</span><strong>新增零食盒</strong><span class="sub">建立一個空的零食盒</span>
      </button>
      ${s.boxes.slice().reverse().map((b) => {
        const t = boxTotals(b);
        return `<a class="box-card" href="#/box/${b.id}">
          <strong>${esc(b.name)}</strong>
          <span class="sub">${b.items.length} 件產品${b.id === s.active ? " · 使用中" : ""}</span>
          <span class="kc">${Math.round(t.kcal)}<small>kcal</small></span>
          <span class="sub">P ${fmtNum(t.p)} · C ${fmtNum(t.c)} · F ${fmtNum(t.f)} 克</span>
        </a>`;
      }).join("")}
    </div>`;
  document.getElementById("newBox").addEventListener("click", () => {
    const st = boxStore();
    const b = newBox(st);
    saveBoxes(st);
    location.hash = `#/box/${b.id}`;
  });
  window.scrollTo(0, 0);
}

let boxAiTimer = null;

function boxPage(id) {
  const s = boxStore();
  const box = findBox(s, id);
  if (!box) return failed({ status: 404 });
  s.active = box.id;
  saveBoxes(s);
  document.title = `${box.name} - 零食盒 - 食物營養資料庫`;
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], ["零食盒", "#/box"], [box.name, ""]])}
    <div class="box-head">
      <input class="box-name" id="boxName" value="${esc(box.name)}" maxlength="40" aria-label="零食盒名稱">
      <button type="button" class="btn-ghost" id="boxDelete">刪除零食盒</button>
    </div>
    <section class="card box-add">
      <div class="box-add-row">
        <div class="search box-search">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="boxQ" type="search" placeholder="搜尋產品名稱、品牌或條碼，加入零食盒" autocomplete="off" aria-label="搜尋產品加入零食盒">
        </div>
        <button type="button" class="scan-cta" id="boxScan">
          <svg class="icon" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10.5 8v8M14 8v8M17 8v8"/></svg>
          掃描加入</button>
      </div>
      <ul class="list plist box-results" id="boxResults" hidden></ul>
    </section>
    <div class="box-cols">
      <section class="card">
        <div class="section-head"><h2>盒內產品</h2><span class="eyebrow" id="boxCount"></span></div>
        <ul class="box-items" id="boxItems"></ul>
      </section>
      <div class="box-side">
        <section class="card box-total" id="boxTotal"></section>
        <section class="card" id="boxSources"></section>
      </div>
    </div>
    <section class="card ai-card" id="aiCard">
      <div class="section-head"><h2>AI 組合評估</h2><span class="ai-state" id="aiState">AI 分析</span></div>
      <div id="aiBody"></div>
    </section>`;

  const get = () => findBox(boxStore(), id);
  const update = (fn) => {
    const st = boxStore();
    const b = findBox(st, id);
    if (!b) return;
    fn(b);
    saveBoxes(st);
    renderBox(get());
  };

  document.getElementById("boxName").addEventListener("change", (e) => {
    const name = e.target.value.trim() || "零食盒";
    update((b) => { b.name = name; });
    document.title = `${name} - 零食盒 - 食物營養資料庫`;
  });
  document.getElementById("boxDelete").addEventListener("click", () => {
    if (!confirm(`確定要刪除「${get().name}」嗎？`)) return;
    const st = boxStore();
    st.boxes = st.boxes.filter((b) => b.id !== id);
    if (st.active === id) st.active = st.boxes.length ? st.boxes[st.boxes.length - 1].id : null;
    saveBoxes(st);
    location.hash = "#/box";
  });

  // add by search
  const q2 = document.getElementById("boxQ");
  const results = document.getElementById("boxResults");
  let found = [], timer;
  q2.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const term = q2.value.trim();
      if (!term) { results.hidden = true; return; }
      const d = await api(`/api/products/search?limit=8&q=${encodeURIComponent(term)}`).catch(() => null);
      if (q2.value.trim() !== term) return;
      found = d ? d.results : [];
      results.hidden = false;
      results.innerHTML = found.map((p, i) => `<li><button type="button" class="prow box-pick" data-i="${i}">
        ${thumb(p)}
        <span class="pmain"><span class="nm">${esc(p.name)}</span><span class="sub">${esc([p.brand, p.quantity].filter(Boolean).join(" · ")) || "&nbsp;"}</span></span>
        <span class="add-pill">＋ 加入</span></button></li>`).join("") || '<li class="muted box-none">找不到產品。可以試試掃描條碼。</li>';
    }, 280);
  });
  results.addEventListener("click", (e) => {
    const b = e.target.closest(".box-pick");
    if (!b) return;
    const p = found[+b.dataset.i];
    addToBox(boxItem(p), id);
    toast(`已加入「${esc(p.name)}」`);
    renderBox(get());
  });

  // add by scanning (camera stays open; each new barcode is added)
  document.getElementById("boxScan").addEventListener("click", () => openScanner(async (code) => {
    let d;
    try {
      d = await api(`/api/product?code=${encodeURIComponent(code)}`);
    } catch (e) {
      return [e.status === 404 ? `找不到條碼 ${code}，可以之後在本站新增。` : "未能讀取產品，請再試。", false];
    }
    addToBox(boxItem(d.product), id);
    renderBox(get());
    return [`已加入：${d.product.name}${d.product.has_nutrition ? "" : "（沒有營養資料）"}`, true];
  }));

  // amounts and removing
  const itemsEl = document.getElementById("boxItems");
  itemsEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-code]");
    if (!row) return;
    const code = row.dataset.code;
    if (e.target.closest(".rm")) update((b) => { b.items = b.items.filter((i) => i.code !== code); });
    const step = e.target.closest("[data-step]");
    if (step) update((b) => {
      const it = b.items.find((i) => i.code === code);
      const d = +step.dataset.step * (it.serving_g || (it.unit === "ml" ? 50 : 10));
      it.amount = Math.min(Math.max(Math.round(it.amount + d), 1), 5000);
    });
  });
  itemsEl.addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-amount]");
    if (!inp) return;
    const v = Math.round(+inp.value);
    update((b) => { const it = b.items.find((i) => i.code === inp.dataset.amount); if (v > 0) it.amount = Math.min(v, 5000); });
  });

  renderBox(box);
  window.scrollTo(0, 0);
}

const unitZh = (it) => (it.unit === "ml" ? "毫升" : "克");
const g1 = (x) => (x >= 100 ? String(Math.round(x)) : String(+x.toFixed(1)));   // grams: 1 decimal at most

function renderBox(box) {
  const itemsEl = document.getElementById("boxItems");
  if (!itemsEl || !box) return;
  const t = boxTotals(box);
  document.getElementById("boxCount").textContent = `${box.items.length} 件`;

  itemsEl.innerHTML = box.items.map((it) => {
    const k = it.amount / 100;
    const at = (key) => (it.has && typeof it.per100[key] === "number" ? it.per100[key] * k : null);
    const servings = it.serving_g ? it.amount / it.serving_g : null;
    return `<li class="bitem${it.has ? "" : " nodata"}" data-code="${esc(it.code)}">
      <span class="sw" style="background:${it.color || BOX_OTHER}" aria-hidden="true"></span>
      ${thumb(it)}
      <div class="bmain">
        <a class="nm" href="#/p/i/${encodeURIComponent(it.code)}">${esc(it.name)}</a>
        <span class="sub">${esc(it.brand || "")}${it.has && it.per100.kcal !== null ? `${it.brand ? " · " : ""}每100${unitZh(it)} ${Math.round(it.per100.kcal)} kcal` : ""}</span>
        <div class="amt">
          <button type="button" data-step="-1" aria-label="減少">−</button>
          <input type="number" min="1" max="5000" step="1" value="${it.amount}" data-amount="${esc(it.code)}" aria-label="${esc(it.name)} 份量">
          <span>${unitZh(it)}</span>
          <button type="button" data-step="1" aria-label="增加">＋</button>
          ${servings ? `<span class="muted serv">≈ ${fmtNum(servings)} 份${it.serving_size ? `（每份 ${esc(it.serving_size)}）` : ""}</span>` : ""}
        </div>
      </div>
      <div class="bvals">${it.has
        ? `<b>${Math.round(at("kcal") || 0)}</b><small>kcal</small><span>P ${g1(at("p") || 0)} · C ${g1(at("c") || 0)} · F ${g1(at("f") || 0)} 克</span>`
        : `<span class="warn">沒有營養資料，未計入</span><a class="link" href="#/p/fill/${encodeURIComponent(it.code)}">補上</a>`}</div>
      <button type="button" class="rm" aria-label="移除 ${esc(it.name)}">×</button>
    </li>`;
  }).join("") || `<li class="box-empty">零食盒是空的。用上面的搜尋或「掃描加入」，把產品放進來。</li>`;

  // totals: hero number + the energy ring of products pages (macros() in app.js)
  const n = { energy_kcal: { value: t.kcal }, protein: { value: t.p }, carbohydrate: { value: t.c }, fat: { value: t.f } };
  document.getElementById("boxTotal").innerHTML = box.items.length ? `
    <div class="section-head"><h2>整盒營養</h2><span class="eyebrow">${box.items.length - t.missing} 件已計算</span></div>
    <div class="box-hero"><span class="big">${Math.round(t.kcal)}</span><small>kcal</small></div>
    <div class="box-pcf">
      <div><b>${g1(t.p)} 克</b><span>蛋白質</span></div><div><b>${g1(t.c)} 克</b><span>碳水化合物</span></div>
      <div><b>${g1(t.f)} 克</b><span>脂肪</span></div><div><b>${g1(t.sugars)} 克</b><span>糖</span></div>
      <div><b>${Math.round(t.sodium)} 毫克</b><span>鈉</span></div>
    </div>
    ${t.kcal > 0 ? macros(n, 1) : ""}
    ${t.missing ? `<p class="kc-note-light">${t.missing} 件產品沒有營養資料，未計入總和。</p>` : ""}`
    : `<div class="section-head"><h2>整盒營養</h2></div><p class="muted">加入產品後，這裏會即時計算總熱量及蛋白質、碳水化合物、脂肪。</p>`;

  document.getElementById("boxSources").innerHTML = sourceBars(box, t);
  bindTips(document.getElementById("boxSources"));
  scheduleBoxAi(box);
}

// Where each macronutrient comes from: one 100% bar per nutrient (protein, carbohydrate, fat), one
// segment per product, in the product's colour; the list of products is the legend and the table view.
function sourceBars(box, t) {
  const counted = box.items.filter((i) => i.has);
  if (counted.length < 1 || t.kcal <= 0) return `<div class="section-head"><h2>營養素來源</h2></div><p class="muted">加入有營養資料的產品後，這裏會顯示蛋白質、碳水化合物及脂肪各來自哪件產品。</p>`;
  const rows = [["p", "蛋白質"], ["c", "碳水化合物"], ["f", "脂肪"]].map(([key, label]) => {
    const total = t[key];
    const parts = counted.map((i) => ({ it: i, v: (i.per100[key] || 0) * i.amount / 100 })).filter((x) => x.v > 0);
    const segs = parts.map(({ it, v }) => {
      const pct = (v / total) * 100;
      return `<i style="flex-grow:${v};background:${it.color || BOX_OTHER}" tabindex="0"
        data-tip="${esc(it.name)}：${g1(v)} 克（${Math.round(pct)}%）" aria-label="${esc(it.name)} ${g1(v)} 克，佔 ${Math.round(pct)}%"></i>`;
    }).join("");
    const top = parts.slice().sort((a, b) => b.v - a.v)[0];
    return `<div class="src-row">
      <div class="src-top"><span class="nm">${label}</span><span class="v">${g1(total)} 克${top ? `<small>最多來自 ${esc(top.it.name)}（${Math.round((top.v / total) * 100)}%）</small>` : ""}</span></div>
      <div class="src-bar" role="img" aria-label="${label}來源">${segs || '<i style="flex-grow:1;background:var(--track)"></i>'}</div>
    </div>`;
  }).join("");
  const legend = counted.map((i) => `<span><i style="background:${i.color || BOX_OTHER}"></i>${esc(i.name)}</span>`).join("");
  return `<div class="section-head"><h2>營養素來源</h2><span class="eyebrow">按產品</span></div>
    ${rows}<div class="src-legend">${legend}</div>`;
}

// hover / tap tooltip for the bar segments
function bindTips(root) {
  let tip = document.getElementById("vizTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "vizTip";
    tip.className = "viz-tip";
    document.body.appendChild(tip);
  }
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.style.left = `${Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${y - 40}px`;
    tip.classList.add("on");
  };
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("pointermove", (e) => show(el, e.clientX, e.clientY));
    el.addEventListener("pointerleave", () => tip.classList.remove("on"));
    el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); show(el, r.left, r.top); });
    el.addEventListener("blur", () => tip.classList.remove("on"));
  });
}

// AI comment on the combination: 1.5 s after the last change. The same box is answered from the saved copy.
function scheduleBoxAi(box) {
  clearTimeout(boxAiTimer);
  const body = document.getElementById("aiBody");
  const counted = box.items.filter((i) => i.has);
  if (!counted.length) {
    if (body) { body.className = "ai-start"; body.dataset.req = ""; body.innerHTML = '<p class="muted">加入有營養資料的產品後，AI 會評估這個組合是否適合作為一份零食。</p>'; }
    return;
  }
  const items = box.items.map((i) => `${i.code}:${i.amount}`).sort().join(",");
  if (body && body.dataset.items === items && body.className.startsWith("ai-")) return;   // already shown / loading
  if (body) { body.dataset.items = items; body.classList.add("stale"); }   // old answer dimmed until the new one
  boxAiTimer = setTimeout(() => runAi(null, `/api/box-ai?items=${encodeURIComponent(items)}`,
    "AI 正在評估這個組合；每個新組合約需 5 至 15 秒。"), 1500);
}

updateBoxBadge();
