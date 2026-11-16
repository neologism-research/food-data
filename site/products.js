// Packaged products section (Open Food Facts data). Uses the helpers of app.js (api, esc, fmt, crumbs ...).
// API: /api/products/meta  /api/products/list  /api/products/search  /api/product
// Routes:
//   #/p                                   products home
//   #/p/c/<category | all>?m=<market>&sort=<sort>&page=<n>
//   #/p/search/<text or barcode>
//   #/p/i/<barcode>                       product page (barcodes not stored are looked up live)
"use strict";

let PMETA = null, PCATS = {};
async function loadProductMeta() {
  if (PMETA) return;
  PMETA = await api("/api/products/meta");
  PCATS = Object.fromEntries(PMETA.categories.map((c) => [c.id, c]));
  groupbarFor = null;   // build the product group bar again with the categories
}

// Notice shown when a product search is submitted (Enter): the data is user-entered and not checked
// by us. "不再顯示" keeps it hidden in this browser.
function showBetaNotice() {
  const dlg = document.getElementById("betaNotice");
  if (!dlg || dlg.open || localStorage.getItem("hideBetaNotice") === "1") return;
  dlg.showModal();
}
document.getElementById("betaNotice")?.addEventListener("close", () => {
  if (document.getElementById("betaHide").checked) localStorage.setItem("hideBetaNotice", "1");
});
document.getElementById("searchForm").addEventListener("submit", () => {
  if (inProducts() && q.value.trim()) {
    clearTimeout(searchTimer);
    location.hash = `#/p/search/${encodeURIComponent(q.value.trim())}`;
    showBetaNotice();
  }
});

// Products home: everyday Hong Kong products, picked by hand (2026-11-13). Each one has a photo and
// nutrition facts. [barcode, Chinese name shown on the card]
const HK_PICKS = [
  ["4891028703907", "維他檸檬茶（低糖）"], ["4891028172345", "維他奶（低糖麥精豆奶）"], ["4897878000012", "出前一丁"],
  ["4897878100408", "合味道（海鮮味）"], ["0089782032881", "嘉頓生命麵包"], ["4892294101428", "卡樂B 粟一燒"],
  ["4895047047288", "奇華雞蛋卷"], ["0078895100020", "李錦記蠔油"], ["4891014896033", "益力多"],
  ["4893318633536", "維記低脂高鈣奶"], ["4890008171606", "陽光檸檬茶"], ["6937761805022", "寶礦力水特"],
];

// The newest products from users, and a stamp that changes when a user adds or completes a product.
// Read once per visit (the api() memory cache is cleared after a user submits a product).
const userProducts = () => api("/api/products/recent?limit=8");

const P_ALL = { id: "all", name_zh: "全部包裝食品", name_en: "All products" };
const marketName = (id) => PMETA.markets.find((m) => m.id === id)?.name_zh || id;
const pHref = (cid, o = {}) => {
  const qs = new URLSearchParams(Object.entries(o).filter(([k, v]) => v && !(k === "sort" && v === "popular") && !(k === "page" && +v === 1)));
  return `#/p/c/${cid}${qs.toString() ? "?" + qs : ""}`;
};
// Products with "ml" / "L" in the quantity are drinks: their label values are per 100 ml.
const perUnit = (p) => (p.nutrients?._per === "ml" || /\d\s*(ml|cl|l)\b|毫升|公升|ミリリットル/i.test(p.quantity || "") || p.category === "drinks" || p.category === "alcohol" ? "毫升" : "克");
const ICON_BOX = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>';
const thumb = (p, cls = "thumb") => p.image
  ? `<span class="${cls}"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
  : `<span class="${cls} empty">${ICON_BOX}</span>`;
const nutriBadge = (g) => (g ? `<span class="nutri nutri-${g}" title="Nutri-Score ${g.toUpperCase()}">${g.toUpperCase()}</span>` : "");

function productRow(p) {
  const sub = [p.brand, p.quantity].filter(Boolean).map(esc).join(" · ");
  return `<li><a class="prow" href="#/p/i/${encodeURIComponent(p.code)}">
    ${thumb(p)}
    <span class="pmain"><span class="nm">${esc(p.name)}${p.origin === "user" ? ' <span class="pill user-pill">用戶新增</span>' : p.origin === "off_user" ? ' <span class="pill user-pill">用戶補充標籤</span>' : ""}</span><span class="sub">${sub || '<span class="muted">未有品牌資料</span>'}</span></span>
    <span class="kc">${p.has_nutrition && typeof p.energy_kcal === "number" ? `${Math.round(p.energy_kcal)}<small>kcal/100${perUnit(p) === "毫升" ? "ml" : "g"}</small>` : '<small class="nodata">未有營養資料</small>'}</span>
  </a></li>`;
}

async function productRoute(parts, params) {
  if (parts[0] === "c" && parts[1]) return productCategory(parts[1], params);
  if (parts[0] === "search" && parts[1]) return productSearch(parts[1]);
  if (parts[0] === "i" && parts[1]) return productPage(parts[1]);
  if (parts[0] === "add") return productAdd(params.get("code") || "");
  if (parts[0] === "fill" && parts[1]) return productFill(parts[1]);
  return productsHome();
}

// ---------- products home ----------

async function productsHome() {
  setActiveGroup(null);
  document.title = "包裝食品 - 食物營養資料庫";
  app.innerHTML = `
    <section class="home-hero">
      <h1>包裝食品營養標籤</h1>
      <p>掃描條碼或輸入產品名稱，查看包裝上的營養標籤、成分及致敏物。</p>
      <div class="hero-row">
        <form class="search" id="pHomeSearch" role="search">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="phq" type="search" placeholder="產品名稱、品牌或條碼，例如：維他奶、Calbee" autocomplete="off" aria-label="搜尋包裝食品">
        </form>
        <button type="button" class="scan-cta" id="pScan">
          <svg class="icon" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10.5 8v8M14 8v8M17 8v8"/></svg>
          掃描條碼</button>
      </div>
      <div class="meta-line"><a href="#/p/c/all"><b>${PMETA.total.toLocaleString()}</b> 件產品</a> · <b>${PMETA.markets.length}</b> 個亞洲地區 · 資料來源 <b>Open Food Facts</b></div>
      <div class="meta-line">找不到你的產品？<a class="link" href="#/p/add">新增產品</a></div>
    </section>

    <section class="home-section">
      <div class="section-head"><h2>香港人熟悉的產品</h2><a class="eyebrow" href="${pHref("all", { m: "HK" })}">標示在香港有售的產品 ›</a></div>
      <p class="muted section-note">本站挑選的香港常見產品；本站用戶新增或補充的產品排在最前。營養數值由用戶按包裝標籤輸入，只供參考。</p>
      <div class="pcards" id="pPopular"><p class="muted">載入中…</p></div>
    </section>

    <section class="home-section">
      <div class="section-head"><h2>按地區瀏覽</h2><span class="eyebrow">用戶標示的有售地區</span></div>
      <div class="tabs markets">${PMETA.markets.map((m) => `<a href="${pHref("all", { m: m.id })}">${esc(m.name_zh)} <span class="n">${m.n.toLocaleString()}</span></a>`).join("")}</div>
    </section>

    <section class="home-section">
      <div class="section-head"><h2>產品類別</h2><a class="eyebrow" href="#/p/c/all">全部產品 ›</a></div>
      <div class="grid">${PMETA.categories.map((c) => `
        <a href="#/p/c/${c.id}">
          <span class="txt"><strong>${esc(c.name_zh)}</strong><span class="sub">${esc(c.name_en)}</span></span>
          <span class="count">${c.n.toLocaleString()} 件</span>${ICON_CHEVRON}</a>`).join("")}
      </div>
    </section>

    <section class="home-section">
      <div class="source-card off-card">
        <div class="flag">Open Food Facts</div>
        <div><strong>資料來自 Open Food Facts</strong>
          <span class="sub">全球用戶按包裝標籤輸入的公開資料庫。本站收錄被用戶標示在亞洲地區有售的產品；其他條碼會即時向 Open Food Facts 查詢。</span>
          <span class="sub">${esc(PMETA.source.licence)}</span></div>
      </div>
    </section>`;
  const phq = document.getElementById("phq");
  document.getElementById("pHomeSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!phq.value.trim()) return;
    clearTimeout(searchTimer);
    location.hash = `#/p/search/${encodeURIComponent(phq.value.trim())}`;
    showBetaNotice();
  });
  phq.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = phq.value.trim();
      if (!v) return;
      location.hash = `#/p/search/${encodeURIComponent(v)}`;
      q.value = phq.value;
      q.focus();
    }, 400);
  });
  document.getElementById("pScan").addEventListener("click", openScanner);
  // products that users added or completed come first (newest first), then the hand-picked ones
  const [d, mine] = await Promise.all([
    api(`/api/products/codes?codes=${HK_PICKS.map(([c]) => c).join(",")}`),
    userProducts().catch(() => ({ results: [] })),
  ]);
  const box = document.getElementById("pPopular");
  if (!box) return;
  const label = Object.fromEntries(HK_PICKS);
  const picked = d.results.filter((p) => !mine.results.some((u) => u.code === p.code));
  box.innerHTML = [...mine.results, ...picked.map((p) => ({ ...p, sub: p.name, name: label[p.code] || p.name }))].map((p) => `
    <a href="#/p/i/${encodeURIComponent(p.code)}">
      ${thumb(p, "pimg")}
      <div class="nm">${esc(p.name)}</div>
      <div class="sub">${esc([p.brand, p.sub && p.sub !== p.name && p.sub.toLowerCase() !== (p.brand || "").toLowerCase() ? p.sub : p.quantity].filter(Boolean).join(" · "))}</div>
      ${p.origin && p.origin !== "off" ? `<div class="sub"><span class="pill user-pill">${p.origin === "user" ? "用戶新增" : "用戶補充標籤"}</span></div>` : ""}
      <div class="kc">${typeof p.energy_kcal === "number" ? Math.round(p.energy_kcal) : "—"}<small>kcal/100${perUnit(p) === "毫升" ? "ml" : "g"}</small>${nutriBadge(p.nutriscore)}</div>
    </a>`).join("");
}

// ---------- category / market list ----------

async function productCategory(cid, params) {
  const c = cid === "all" ? P_ALL : PCATS[cid];
  if (!c) return failed({ status: 404 });
  const m = params.get("m") || "";
  const sort = params.get("sort") || "popular";
  const page = Math.max(parseInt(params.get("page") || "1", 10) || 1, 1);
  setActiveGroup(cid);
  document.title = `${c.name_zh} - 包裝食品 - 食物營養資料庫`;
  loading();
  const qs = new URLSearchParams({ c: cid, sort, page: String(page) });
  if (m) qs.set("m", m);
  qs.set("u", (await userProducts().catch(() => ({ stamp: "0" }))).stamp);   // new user products: read the list again
  const d = await api(`/api/products/list?${qs}`);
  const pages = Math.max(Math.ceil(d.total / d.page_size), 1);
  const href = (o) => pHref(cid, { m, sort, page: 1, ...o });
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], [c.name_zh, ""]])}
    <h1 class="page">${esc(c.name_zh)}${m ? ` <span class="h-sub">· 標示在${esc(marketName(m))}有售</span>` : ""}</h1>
    <p class="muted">${esc(c.name_en)} · ${d.total.toLocaleString()} 件產品</p>
    <div class="tabs filters markets">
      <a href="${href({ m: "" })}" class="${m ? "" : "on"}">所有地區</a>
      ${PMETA.markets.map((x) => `<a href="${href({ m: x.id })}" class="${m === x.id ? "on" : ""}">${esc(x.name_zh)}</a>`).join("")}
    </div>
    <div class="card">
      <div class="toolbar"><span class="eyebrow">每100克 / 毫升 · 第 ${page} / ${pages} 頁</span>
        <select id="psort" aria-label="排序">
          <option value="popular">最多人掃描</option><option value="name">按名稱</option>
          <option value="kcalAsc">卡路里：低至高</option><option value="kcalDesc">卡路里：高至低</option>
          <option value="protein">蛋白質最高</option>
        </select></div>
      <ul class="list plist">${d.results.map(productRow).join("") || '<li class="muted">沒有產品</li>'}</ul>
      ${pages > 1 ? `<nav class="pager" aria-label="分頁">
        ${page > 1 ? `<a href="${href({ page: page - 1 })}">‹ 上一頁</a>` : "<span></span>"}
        <span class="muted">第 ${page} / ${pages} 頁</span>
        ${page < pages ? `<a href="${href({ page: page + 1 })}">下一頁 ›</a>` : "<span></span>"}
      </nav>` : ""}
    </div>`;
  const sel = document.getElementById("psort");
  sel.value = sort;
  sel.onchange = () => { location.hash = href({ sort: sel.value }); };
  window.scrollTo(0, 0);
}

// ---------- search ----------

async function productSearch(term) {
  setActiveGroup(null);
  document.title = `搜尋「${term}」 - 包裝食品 - 食物營養資料庫`;
  if (q.value !== term) q.value = term;
  const d = await api(`/api/products/search?limit=100&q=${encodeURIComponent(term)}`);
  if (location.hash !== `#/p/search/${encodeURIComponent(term)}`) return;   // user kept typing
  // a full barcode that we do not store: go to the product page (live lookup)
  if (d.barcode && !d.results.length && /^\d{8,14}$/.test(term)) { location.replace(`#/p/i/${term}`); return; }
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], ["搜尋", ""]])}
    <h1 class="page">搜尋「${esc(term)}」</h1>
    <p class="muted">找到 ${d.total.toLocaleString()} 件產品${d.total > d.results.length ? `，顯示首 ${d.results.length} 件` : ""}</p>
    <div class="card"><ul class="list plist">${d.results.map(productRow).join("") ||
      `<li class="muted">找不到符合的產品。可以試試<a class="link" href="#/search/${encodeURIComponent(term)}">在「食物」中搜尋「${esc(term)}」</a>，或<button type="button" class="link" onclick="openScanner()">掃描條碼</button>。如果本站沒有這件產品，你可以<a class="link" href="#/p/add${/^\d{6,14}$/.test(term) ? `?code=${term}` : ""}">新增產品</a>。</li>`}</ul></div>`;
}

// ---------- product page ----------

const P_LABEL = [
  ["energy_kcal", "能量", "major", "kcal"], ["protein", "蛋白質", "major"], ["fat", "總脂肪", "major"],
  ["fat_sat", "飽和脂肪", "sub"], ["fat_trans", "反式脂肪", "sub"], ["fat_mono", "單元不飽和脂肪", "sub", null, true],
  ["fat_poly", "多元不飽和脂肪", "sub", null, true], ["cholesterol", "膽固醇", "", null, true],
  ["carbohydrate", "碳水化合物", "major"], ["sugars", "糖", "sub"], ["fibre", "膳食纖維", "sub", null, true],
  ["sodium", "鈉", "major"],
];

function productLabel(n, factor, servingText) {
  const unit = (id) => NUTRIENTS[id]?.unit || "";
  const val = (id) => (typeof n[id] === "number" ? `${fmtNum(n[id] * factor)} ${unit(id)}` : "—");
  const shown = new Set([...P_LABEL.map((r) => r[0]), "energy_kj", "salt_eq"]);
  const more = Object.keys(n).filter((id) => !shown.has(id) && NUTRIENTS[id]);
  return `
    <div class="label">
      <h3>營養標籤</h3>
      <div class="per">每 <b>${esc(servingText)}</b></div>
      <table>
        ${P_LABEL.filter(([id, , , , optional]) => !optional || id in n)
          .map(([id, t, cls]) => `<tr class="${cls}"><td>${t}</td><td>${val(id)}${id === "energy_kcal" && typeof n.energy_kj === "number" ? `<span class="kj"> / ${fmtNum(n.energy_kj * factor)} kJ</span>` : ""}</td></tr>`).join("")}
        ${more.length ? `<tr class="sec"><td colspan="2">其他營養素</td></tr>
          ${more.map((id) => `<tr><td>${esc(NUTRIENTS[id].name_zh || NUTRIENTS[id].name_en)}</td><td>${val(id)}</td></tr>`).join("")}` : ""}
      </table>
    </div>
    <p class="src">數值按記錄的包裝標籤（每100${esc(servingText.includes("毫升") ? "毫升" : "克")}）換算。「—」表示沒有資料。</p>`;
}

const NOVA = { 1: "未經加工或輕度加工", 2: "烹調用配料", 3: "加工食品", 4: "超加工食品" };

async function productPage(code) {
  loading();
  let d;
  try {
    d = await api(`/api/product?code=${encodeURIComponent(code)}${freshArg(code)}`);
  } catch (e) {
    if (e.status === 404 || e.status === 400) return productNotFound(code);
    throw e;
  }
  const p = d.product, n = p.nutrients || {};
  const cat = PCATS[p.category];
  setActiveGroup(cat ? cat.id : null);
  document.title = `${p.name} 營養標籤 - 包裝食品 - 食物營養資料庫`;
  const u = perUnit(p);
  const servings = [{ text: `100${u}`, g: 100 }];
  if (p.serving_g > 0 && p.serving_g !== 100) servings.push({ text: `每份 ${p.serving_size || fmtNum(p.serving_g) + u}`, g: p.serving_g });
  const markets = (p.markets || "").split(",").filter(Boolean).map(marketName);
  const offUrl = `https://world.openfoodfacts.org/product/${encodeURIComponent(p.code)}`;
  const path = [["包裝食品", "#/p"], ...(cat ? [[cat.name_zh, `#/p/c/${cat.id}`]] : []), [p.name, ""]];

  app.innerHTML = `<div class="food-page product-page">
    ${crumbs(path)}
    ${d.live ? `<div class="notice">本站未收錄這件產品，以下資料即時取自 Open Food Facts。</div>` : ""}
    ${p.origin === "user" ? `<div class="notice">這件產品由本站用戶新增，資料未經核實，請以包裝為準。</div>` : ""}
    ${p.origin === "off_user" ? `<div class="notice">營養標籤由本站用戶補充，未經核實，請以包裝為準。其他資料來自 Open Food Facts。</div>` : ""}
    <section class="card">
      <div class="food-head">
        ${p.image ? `<a class="pphoto" href="${esc(p.image.replace(/\.(\d+)\.jpg$/, ".400.jpg"))}" target="_blank" rel="noopener"><img src="${esc(p.image)}" alt="${esc(p.name)} 包裝相片" referrerpolicy="no-referrer"></a>` : `<span class="pphoto empty">${ICON_BOX}</span>`}
        <div class="phead-txt">
          <h1>${esc(p.name)}</h1>
          <div class="en">${esc([p.brand, p.quantity].filter(Boolean).join(" · "))}${p.generic_name ? `<br><span class="muted">${esc(p.generic_name)}</span>` : ""}</div>
          <div class="chips">
            ${p.code.startsWith("29") && p.origin === "user" ? '<span class="pill soft">沒有條碼</span>' : `<span class="pill soft barcode">${esc(p.code)}</span>`}
            ${p.origin === "user" ? '<span class="pill user-pill">用戶新增</span>' : p.origin === "off_user" ? '<span class="pill user-pill">用戶補充標籤</span>' : ""}
            ${p.nutriscore ? `<span class="pill nutri-pill nutri-${p.nutriscore}">Nutri-Score ${p.nutriscore.toUpperCase()}</span>` : ""}
            ${p.nova ? `<span class="pill soft" title="NOVA 加工程度分類">NOVA ${p.nova} · ${NOVA[p.nova]}</span>` : ""}
            ${p.off_category ? `<span class="pill soft">${esc(p.off_category)}</span>` : ""}
          </div>
          ${markets.length ? `<p class="muted desc">用戶標示的有售地區：${markets.map(esc).join("、")}</p>` : p.countries ? `<p class="muted desc">用戶標示的有售地區：${esc(p.countries)}</p>` : ""}
        </div>
      </div>
      ${p.has_nutrition ? `<div class="serving-row">
        <div class="eyebrow" style="margin-bottom:8px">食用分量</div>
        <div class="serving" id="serving">
          ${servings.map((s, i) => `<button type="button" data-g="${s.g}" data-t="${esc(s.text)}" class="${i === 0 ? "on" : ""}">${esc(s.text)}</button>`).join("")}
          <label>自訂 <input type="number" id="grams" min="1" max="5000" step="1" placeholder="${u}" aria-label="自訂分量"> ${u}</label>
          <button type="button" class="add-box-btn" id="addBoxBtn">＋ 加入零食盒</button>
        </div>
      </div>
      <div class="kcal-card" id="kcalCard"></div>` : `<div class="empty-nutrition fill-cta">
        <div><strong>這件產品未有營養資料。</strong>
        <span>如果你手上有這件產品，可以按包裝上的營養標籤，在本站補上資料。</span></div>
        <a class="scan-cta" href="#/p/fill/${encodeURIComponent(p.code)}">補上營養資料</a></div>`}
    </section>
    ${photoList(p).length > (p.origin === "user" ? 1 : 0) ? `<section class="card"><div class="section-head"><h2>包裝相片</h2><span class="eyebrow">用戶上載</span></div>
      <div class="gallery">${photoList(p).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(p.name)} 包裝相片" loading="lazy"></a>`).join("")}</div></section>` : ""}
    ${p.has_nutrition || p.ingredients ? `<section class="card ai-card" id="aiCard">
      <div class="section-head"><h2>AI 健康評分</h2><span class="ai-state" id="aiState">AI 分析</span></div>
      <div id="aiBody"></div>
    </section>` : ""}
    ${p.has_nutrition ? `<div class="two-col">
      <section class="card"><div class="section-head"><h2>主要營養分佈</h2></div><div id="macros"></div></section>
      <section class="card" id="label"></section>
    </div>` : ""}
    ${p.ingredients || p.allergens || p.traces ? `<section class="card">
      <div class="section-head"><h2>成分及致敏物</h2></div>
      ${p.allergens ? `<p class="allergen"><b>致敏物：</b>${esc(p.allergens)}</p>` : ""}
      ${p.traces ? `<p class="allergen soft"><b>可能含有：</b>${esc(p.traces)}</p>` : ""}
      ${p.ingredients ? `<p class="ingredients">${esc(p.ingredients)}</p>` : ""}
      <p class="src">成分按包裝原文記錄，可能是其他語言。</p>
    </section>` : ""}
    ${d.same_brand.length ? `<section class="card"><div class="section-head"><h2>同品牌產品</h2><span class="eyebrow">${esc(p.brand)}</span></div>
      <ul class="list plist">${d.same_brand.map(productRow).join("")}</ul></section>` : ""}
    ${p.origin === "user" ? `<p class="src source-line">資料來源：本站用戶新增${p.last_modified ? `（${esc(p.last_modified)}）` : ""}，未經核實。</p>
      <div class="danger-zone"><div><strong>刪除這件產品</strong><span>只可刪除由本站用戶新增的產品。刪除後不能復原，相片亦會一併刪除。需要新增密碼。</span></div>
        <button type="button" class="btn-danger" id="delBtn">刪除產品</button></div>
      <p class="form-status" id="delStatus" role="status"></p>`
      : p.origin === "off_user" ? `<p class="src source-line">資料來源：<a class="link" href="${offUrl}" target="_blank" rel="noopener">Open Food Facts</a>（授權：${esc(d.source.licence)}）；營養標籤由本站用戶補充${p.last_modified ? `（${esc(p.last_modified)}）` : ""}，未經核實。</p>`
      : `<p class="src source-line">資料來源：<a class="link" href="${offUrl}" target="_blank" rel="noopener">Open Food Facts</a>${p.last_modified ? ` · 最後更新：${esc(p.last_modified)}` : ""} · 授權：${esc(d.source.licence)}。${esc(d.source.note)}</p>`}
  </div>`;

  if (document.getElementById("aiBody")) runAi(p.code);   // automatic: saved answers load at once
  document.getElementById("delBtn")?.addEventListener("click", () => deleteProduct(p));
  if (p.has_nutrition) {
    const nv = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { value: v }]));   // shape used by macros()
    let curAmount = 100;
    document.getElementById("addBoxBtn").addEventListener("click", () => addProductToBox(p, curAmount));
    const render = (amount, text) => {
      curAmount = amount;
      const factor = amount / 100;
      document.getElementById("kcalCard").innerHTML = `
        <div><span class="eyebrow">每${esc(text)}</span><div class="big">${fmt(n.energy_kcal, factor)}<small>kcal</small></div></div>
        <div class="pcf">${[["protein", "蛋白質"], ["carbohydrate", "碳水化合物"], ["fat", "脂肪"]].map(([k, l]) =>
          `<div><b>${fmt(n[k], factor)}${typeof n[k] === "number" ? " g" : ""}</b><span>${l}</span></div>`).join("")}</div>`;
      document.getElementById("macros").innerHTML = macros(nv, factor);
      document.getElementById("label").innerHTML = productLabel(n, factor, text);
    };
    const box = document.getElementById("serving");
    const input = document.getElementById("grams");
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      input.value = "";
      render(+b.dataset.g, b.dataset.t);
    });
    input.addEventListener("input", () => {
      const v = +input.value;
      if (v > 0) {
        box.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        render(v, `${v}${u}`);
      }
    });
    render(100, `100${u}`);
  }
  window.scrollTo(0, 0);
}

// ---------- AI health score ----------

const AI_BANDS = [[90, "excellent"], [70, "good"], [50, "ok"], [30, "poor"], [0, "bad"]];
// Loading state: a placeholder with the same shape as the result (score ring, text lines, two lists),
// so the card does not jump, and a status line that moves through the steps of the analysis.
const AI_STEPS = ["正在讀取營養標籤…", "正在比較糖、脂肪及鈉的含量…", "正在參考食物安全中心的「三低」標準…", "正在撰寫分析…"];
const AI_SKELETON = `
  <div class="ai-top">
    <svg class="ai-ring ai-ring-wait" viewBox="0 0 100 100" aria-hidden="true">
      <circle r="42" cx="50" cy="50" fill="none" stroke="var(--track)" stroke-width="9"/>
      <circle class="wait-arc" r="42" cx="50" cy="50" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="60 204"/>
      <text x="50" y="58" text-anchor="middle" font-size="24" font-weight="900" fill="var(--ink-3)">AI</text>
    </svg>
    <div class="sk-col">
      <div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div>
      <p class="ai-step"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span id="aiStep">${AI_STEPS[0]}</span></p>
    </div>
  </div>
  <div class="ai-lists" aria-hidden="true">
    <div><div class="sk sk-h"></div><div class="sk sk-chip"></div><div class="sk sk-chip"></div></div>
    <div><div class="sk sk-h"></div><div class="sk sk-chip"></div><div class="sk sk-chip"></div></div>
  </div>
  <p class="src">首次分析這件產品約需 5 至 15 秒；之後會即時顯示。</p>`;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// url: the AI address (default: the product AI of code). Used by the product page and the snack box.
async function runAi(code, url = null, note = "首次分析這件產品約需 5 至 15 秒；之後會即時顯示。") {
  const box = document.getElementById("aiBody");
  if (!box) return;
  const token = String(Math.random());
  box.dataset.req = token;   // a newer request (box changed again) wins
  const state = document.getElementById("aiState");
  box.className = "ai-wait";
  box.classList.remove("stale");
  box.setAttribute("aria-busy", "true");
  box.innerHTML = AI_SKELETON.replace("首次分析這件產品約需 5 至 15 秒；之後會即時顯示。", note);
  if (state) { state.textContent = "分析中"; state.classList.add("busy"); }
  let step = 0;
  const stepTimer = setInterval(() => {
    const el = document.getElementById("aiStep");
    if (!el || step >= AI_STEPS.length - 1) return clearInterval(stepTimer);
    el.textContent = AI_STEPS[++step];
  }, 2200);
  const done = () => {
    clearInterval(stepTimer);
    box.removeAttribute("aria-busy");
    if (state) { state.textContent = "AI 分析"; state.classList.remove("busy"); }
  };
  let a;
  try {
    a = await api(url || `/api/product-ai?code=${encodeURIComponent(code)}${freshArg(code)}`);
  } catch (e) {
    if (box.dataset.req !== token) return clearInterval(stepTimer);
    done();
    box.className = "ai-start";
    box.innerHTML = `<p class="muted">${e.status === 503 ? "AI 功能尚未設定。" : e.status === 422 ? "這件產品的資料不足，未能分析。" : "暫時未能完成分析，請稍後再試。"}</p>
      ${e.status === 503 || e.status === 422 ? "" : '<button type="button" class="btn-ghost" id="aiGo">再試一次</button>'}`;
    document.getElementById("aiGo")?.addEventListener("click", () => runAi(code, url, note));
    return;
  }
  if (document.getElementById("aiBody") !== box || box.dataset.req !== token) return clearInterval(stepTimer);   // left the page, or a newer request
  done();
  const band = AI_BANDS.find(([min]) => a.score >= min)[1];
  const R = 42, C = 2 * Math.PI * R;
  box.className = "ai-result ai-in";
  box.innerHTML = `
    <div class="ai-top">
      <svg class="ai-ring band-${band}" viewBox="0 0 100 100" role="img" aria-label="健康分數 ${a.score} 分（滿分100）">
        <circle r="${R}" cx="50" cy="50" fill="none" stroke="var(--track)" stroke-width="9"/>
        <circle class="arc" r="${R}" cx="50" cy="50" fill="none" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="0 ${C}" data-len="${(a.score / 100) * C}" data-c="${C}" transform="rotate(-90 50 50)"/>
        <text class="ai-num" x="50" y="52" text-anchor="middle" font-size="28" font-weight="900" fill="var(--ink)">0</text>
        <text x="50" y="68" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-3)">/ 100</text>
      </svg>
      <div>
        <div class="ai-verdict band-${band}">${esc(a.verdict)}</div>
        <p class="ai-summary">${esc(a.summary)}</p>
        ${a.confidence === "low" ? '<span class="pill soft">資料不足，分數只供粗略參考</span>' : ""}
      </div>
    </div>
    ${a.good.length || a.watch.length ? `<div class="ai-lists">
      ${a.good.length ? `<div><h3>優點</h3><ul class="ai-good">${a.good.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${a.watch.length ? `<div><h3>要注意</h3><ul class="ai-watch">${a.watch.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    </div>` : ""}
    ${a.tip ? `<p class="ai-tip"><b>小貼士：</b>${esc(a.tip)}</p>` : ""}
    <p class="src">由 AI 根據本頁的標籤資料自動生成，可能有錯，只供參考，不能代替醫生或營養師的意見。</p>`;
  // fill the ring and count the score up (no animation if the user asks for reduced motion)
  const arc = box.querySelector(".ai-ring .arc"), num = box.querySelector(".ai-num");
  const finish = () => { arc.setAttribute("stroke-dasharray", `${arc.dataset.len} ${arc.dataset.c}`); num.textContent = a.score; };
  if (reduceMotion()) return finish();
  requestAnimationFrame(() => requestAnimationFrame(finish));   // the CSS transition draws the ring
  num.textContent = "0";
  const t0 = performance.now(), ms = 900;
  const tick = (t) => {
    const k = Math.min((t - t0) / ms, 1);
    num.textContent = Math.round(a.score * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function productNotFound(code) {
  setActiveGroup(null);
  document.title = "找不到產品 - 包裝食品 - 食物營養資料庫";
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], ["找不到產品", ""]])}
    <section class="card not-found">
      <span class="pphoto empty">${ICON_BOX}</span>
      <div>
        <h1 class="page">找不到條碼 ${esc(code)}</h1>
        <p class="muted">本站及 Open Food Facts 都沒有這個條碼的產品。</p>
        <div class="nf-actions">
          <a class="scan-cta" href="#/p/add?code=${encodeURIComponent(code)}">新增這件產品</a>
          <button type="button" class="btn-ghost" onclick="openScanner()">再掃描一次</button>
        </div>
        <p class="src">新增的產品會即時在本站顯示，並標示為「用戶新增，未經核實」。</p>
      </div>
    </section>`;
}

// ---------- add a product (needs the add password) ----------

const photoList = (p) => { try { return JSON.parse(p.photos || "[]"); } catch { return []; } };
const ADD_PW_KEY = "addPassword";
// After a user fills in a product, its page and AI answer are read again (new address = no old cache).
const FRESH = {};
const freshArg = (code) => (FRESH[code] ? `&r=${FRESH[code]}` : "");
const ADD_NUTRIENTS = [
  ["energy_kcal", "能量", "kcal", 950], ["energy_kj", "能量", "kJ", 4000], ["protein", "蛋白質", "克", 100],
  ["fat", "總脂肪", "克", 100], ["fat_sat", "飽和脂肪", "克", 100], ["fat_trans", "反式脂肪", "克", 100],
  ["carbohydrate", "碳水化合物", "克", 100], ["sugars", "糖", "克", 100], ["fibre", "膳食纖維", "克", 100],
  ["sodium", "鈉", "毫克", 40000],
];
const PHOTO_SLOTS = [["front", "正面"], ["nutrition", "營養標籤"], ["ingredients", "成分表"]];

// Label per 100 ml? The pack size decides first (instant coffee 95 g is per 100 g, even in drinks).
const fillPerMl = (p) => (/\d\s*(ml|cl|l)\b|毫升|公升/i.test(p.quantity || "") ? true
  : /\d\s*(g|kg)\b|克|公斤/i.test(p.quantity || "") ? false : perUnit(p) === "毫升");

// Fill in the label of a product that has no nutrition data (#/p/fill/<code>)
async function productFill(code) {
  loading();
  let d;
  try {
    d = await api(`/api/product?code=${encodeURIComponent(code)}${freshArg(code)}`);
  } catch (e) {
    if (e.status === 404 || e.status === 400) return productNotFound(code);
    throw e;
  }
  if (d.product.has_nutrition) { location.replace(`#/p/i/${encodeURIComponent(d.product.code)}`); return; }
  return productAdd(d.product.code, d.product);
}

// fill = null: add a new product. fill = a product: fill in its label, ingredients and photos.
async function productAdd(code, fill = null) {
  setActiveGroup(null);
  const title = fill ? "補上營養資料" : "新增產品";
  document.title = `${title} - 包裝食品 - 食物營養資料庫`;
  if (!sessionStorage.getItem(ADD_PW_KEY)) return addPasswordGate(code, fill);
  const cats = PMETA.categories.slice().sort((a, b) => (a.id === "other") - (b.id === "other"));
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], ...(fill ? [[fill.name, `#/p/i/${encodeURIComponent(fill.code)}`]] : []), [title, ""]])}
    <h1 class="page">${title}</h1>
    <p class="muted">${fill ? "請按包裝上的營養標籤填寫。資料會即時在產品頁顯示，並標示為「用戶補充，未經核實」。至少要填寫能量、蛋白質、脂肪或碳水化合物其中一項。"
      : "請按包裝上的資料填寫。產品會即時在本站顯示，並標示為「用戶新增，未經核實」。有 * 的欄目必須填寫。"}</p>
    <form class="add-form" id="addForm" novalidate>
      ${fill ? `<section class="card fill-product">
        ${thumb(fill)}
        <div><strong>${esc(fill.name)}</strong><span class="sub">${esc([fill.brand, fill.quantity].filter(Boolean).join(" · "))}</span>
          <span class="sub barcode">${esc(fill.code)}</span></div>
        <input type="hidden" name="code" value="${esc(fill.code)}">
      </section>` : `<section class="card">
        <div class="section-head"><h2>基本資料</h2></div>
        <div class="fgrid">
          <label class="f"><span>條碼</span>
            <input name="code" id="fCode" inputmode="numeric" pattern="[0-9]{6,14}" maxlength="14" value="${esc(code)}" placeholder="例如 4891028164456" autocomplete="off"></label>
          <label class="f check"><input type="checkbox" id="fNoCode"> 這件產品沒有條碼</label>
          <label class="f wide"><span>產品名稱 *</span><input name="name" required maxlength="200" placeholder="例如：維他檸檬茶（低糖）"></label>
          <label class="f"><span>品牌</span><input name="brand" maxlength="80" placeholder="例如：維他"></label>
          <label class="f"><span>淨含量／容量</span><input name="quantity" maxlength="40" placeholder="例如：250毫升"></label>
          <label class="f"><span>類別 *</span><select name="category" required>
            <option value="">請選擇</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name_zh)}</option>`).join("")}</select></label>
        </div>
        <div class="f"><span>有售地區</span>
          <div class="chipset">${PMETA.markets.map((m) => `<label class="chip"><input type="checkbox" name="markets" value="${m.id}" ${m.id === "HK" ? "checked" : ""}> ${esc(m.name_zh)}</label>`).join("")}</div>
        </div>
      </section>`}

      <section class="card">
        <div class="section-head"><h2>營養標籤</h2><span class="eyebrow">香港標籤：能量 + 7 種營養素</span></div>
        <div class="per-switch" role="radiogroup" aria-label="營養標籤單位">
          <label><input type="radio" name="per" value="g" ${fill && fillPerMl(fill) ? "" : "checked"}> 每100克</label>
          <label><input type="radio" name="per" value="ml" ${fill && fillPerMl(fill) ? "checked" : ""}> 每100毫升</label>
        </div>
        <div class="ngrid">${ADD_NUTRIENTS.map(([id, label, unit, max]) => `
          <label class="f"><span>${label}${id === "energy_kj" ? "（如只有千焦）" : ""}</span>
            <span class="unit-input"><input name="${id}" type="number" inputmode="decimal" min="0" max="${max}" step="any"><i>${unit}</i></span></label>`).join("")}
        </div>
        <div class="fgrid">
          <label class="f"><span>每份食用分量</span><input name="serving_size" maxlength="60" placeholder="例如：1包"></label>
          <label class="f"><span>每份重量／容量</span><span class="unit-input"><input name="serving_g" type="number" inputmode="decimal" min="0" max="5000" step="any"><i id="servingUnit">克</i></span></label>
        </div>
      </section>

      <section class="card">
        <div class="section-head"><h2>成分及致敏物</h2></div>
        <label class="f wide"><span>成分</span><textarea name="ingredients" rows="4" maxlength="3000" placeholder="按包裝抄寫，例如：水、糖、紅茶、檸檬汁…">${esc(fill?.ingredients || "")}</textarea></label>
        <label class="f wide"><span>致敏物</span><input name="allergens" maxlength="300" placeholder="例如：含牛奶、大豆" value="${esc(fill?.allergens || "")}"></label>
      </section>

      <section class="card">
        <div class="section-head"><h2>包裝相片</h2><span class="eyebrow">最多 3 張</span></div>
        <div class="photo-slots">${PHOTO_SLOTS.map(([id, label]) => `
          <label class="photo-slot" id="slot-${id}">
            <input type="file" accept="image/*" data-slot="${id}">
            <span class="ph-empty">${ICON_BOX}<b>${label}</b><small>拍照或選擇相片</small></span>
          </label>`).join("")}
        </div>
      </section>

      <div class="add-actions">
        <p class="form-status" id="addStatus" role="status"></p>
        <button type="submit" class="scan-cta" id="addSubmit">${fill ? "提交營養資料" : "提交產品"}</button>
      </div>
    </form>`;

  const form = document.getElementById("addForm");
  const codeInput = document.getElementById("fCode");
  document.getElementById("fNoCode")?.addEventListener("change", (e) => {
    codeInput.disabled = e.target.checked;
    if (e.target.checked) codeInput.value = "";
  });
  form.querySelectorAll('input[name="per"]').forEach((r) => r.addEventListener("change", () => {
    document.getElementById("servingUnit").textContent = form.per.value === "ml" ? "毫升" : "克";
  }));
  const photos = {};
  form.querySelectorAll(".photo-slot input").forEach((inp) => inp.addEventListener("change", async () => {
    const f = inp.files[0];
    const slot = inp.closest(".photo-slot");
    if (!f) return;
    try {
      photos[inp.dataset.slot] = await shrinkPhoto(f);
      slot.style.backgroundImage = `url(${URL.createObjectURL(photos[inp.dataset.slot])})`;
      slot.classList.add("has");
    } catch {
      setAddStatus("未能讀取這張相片，請試另一張。", true);
    }
  }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = addFormError(form, fill);
    if (err) return setAddStatus(err, true);
    const fd = new FormData(form);
    if (fill) fd.append("api_version", API_VERSION);
    fd.delete("photo");
    for (const [id] of PHOTO_SLOTS) if (photos[id]) fd.append("photo", photos[id], `${id}.jpg`);
    const btn = document.getElementById("addSubmit");
    btn.disabled = true;
    setAddStatus("正在提交…");
    try {
      const r = await fetch(fill ? "/api/contribute/fill" : "/api/contribute/product", {
        method: "POST", body: fd, headers: { "x-add-password": sessionStorage.getItem(ADD_PW_KEY) || "" },
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 201 || (fill && r.status === 200)) {
        cache.clear();   // lists and counts in this browser: read again
        FRESH[d.code] = Date.now();
        location.hash = `#/p/i/${d.code}`;
        return;
      }
      if (r.status === 401) {
        sessionStorage.removeItem(ADD_PW_KEY);
        setAddStatus("新增密碼不正確，請重新輸入。", true);
        return addPasswordGate(fill ? fill.code : codeInput.value, fill);
      }
      if (r.status === 409) return setAddStatus(fill ? `這件產品已經有營養資料。<a class="link" href="#/p/i/${esc(d.code)}">查看產品</a>`
        : `本站已有這個條碼的產品。<a class="link" href="#/p/i/${esc(d.code)}">查看產品</a>`, true, true);
      setAddStatus(`未能提交：${d.error || "請稍後再試"}`, true);
    } catch {
      setAddStatus("網絡出錯，未能提交，請再試。", true);
    } finally {
      btn.disabled = false;
    }
  });
  window.scrollTo(0, 0);
}

function setAddStatus(msg, isError = false, html = false) {
  const el = document.getElementById("addStatus");
  if (!el) return;
  el.className = "form-status" + (isError ? " warn" : "");
  if (html) el.innerHTML = msg; else el.textContent = msg;
}

function addFormError(form, fill = null) {
  const v = (n) => (form.elements[n]?.value || "").trim();
  if (fill && !["energy_kcal", "energy_kj", "protein", "fat", "carbohydrate"].some((n) => v(n))) return "請至少填寫能量、蛋白質、脂肪或碳水化合物其中一項。";
  if (!fill && !document.getElementById("fNoCode").checked && v("code") && !/^\d{6,14}$/.test(v("code"))) return "條碼應該是 6 至 14 位數字；如沒有條碼，請剔選「這件產品沒有條碼」。";
  if (!fill && !document.getElementById("fNoCode").checked && !v("code")) return "請輸入條碼，或剔選「這件產品沒有條碼」。";
  if (!fill && !v("name")) return "請輸入產品名稱。";
  if (!fill && !v("category")) return "請選擇類別。";
  for (const [id, label, , max] of ADD_NUTRIENTS) {
    const x = v(id);
    if (x && !(Number(x) >= 0 && Number(x) <= max)) return `${label}的數值不正確（0 至 ${max}）。`;
  }
  const num = (n) => (v(n) === "" ? null : Number(v(n)));
  if (num("fat_sat") !== null && num("fat") !== null && num("fat_sat") > num("fat")) return "飽和脂肪不可以多過總脂肪。";
  if (num("sugars") !== null && num("carbohydrate") !== null && num("sugars") > num("carbohydrate")) return "糖不可以多過碳水化合物。";
  return "";
}

// Photos are made smaller in the browser before upload (longest side 1600 px, JPEG), so a phone
// photo of 5-10 MB becomes about 300 KB.
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("photo"))), "image/jpeg", 0.85));
}

function addPasswordGate(code, fill = null) {
  const title = fill ? "補上營養資料" : "新增產品";
  app.innerHTML = `
    ${crumbs([["包裝食品", "#/p"], [title, ""]])}
    <section class="card gate">
      <h1 class="page">${title}</h1>
      <p class="muted">這是測試版功能。新增資料前，請輸入新增密碼。</p>
      <form id="gateForm" class="gate-form">
        <input type="password" id="gatePw" autocomplete="off" placeholder="新增密碼" aria-label="新增密碼" autofocus>
        <button type="submit" class="scan-cta">確定</button>
      </form>
      <p class="form-status" id="gateStatus" role="status"></p>
    </section>`;
  document.getElementById("gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("gatePw").value;
    const st = document.getElementById("gateStatus");
    const r = await fetch("/api/contribute/check", { method: "POST", body: JSON.stringify({ password: pw }), headers: { "content-type": "application/json" } }).catch(() => null);
    if (r && r.status === 204) {
      sessionStorage.setItem(ADD_PW_KEY, pw);
      productAdd(code, fill);
    } else {
      st.className = "form-status warn";
      st.textContent = r && r.status === 503 ? "新增功能尚未設定。" : r && r.status === 401 ? "密碼不正確，請再試。" : "網絡出錯，請再試。";
      document.getElementById("gatePw").select();
    }
  });
}

// ---------- delete a user-added product (needs the add password) ----------

async function deleteProduct(p) {
  const st = document.getElementById("delStatus");
  const say = (t) => { if (st) { st.className = "form-status warn"; st.textContent = t; } };
  if (!confirm(`確定要刪除「${p.name}」嗎？刪除後不能復原。`)) return;
  let pw = sessionStorage.getItem(ADD_PW_KEY);
  if (!pw) {
    pw = prompt("請輸入新增密碼");
    if (!pw) return;
  }
  const btn = document.getElementById("delBtn");
  btn.disabled = true;
  try {
    const r = await fetch("/api/contribute/delete", {
      method: "POST", body: JSON.stringify({ code: p.code, api_version: API_VERSION }),
      headers: { "content-type": "application/json", "x-add-password": pw },
    });
    if (r.ok) {
      sessionStorage.setItem(ADD_PW_KEY, pw);
      cache.clear();
      FRESH[p.code] = Date.now();
      location.hash = "#/p";
      return;
    }
    if (r.status === 401) { sessionStorage.removeItem(ADD_PW_KEY); say("新增密碼不正確，未有刪除。"); }
    else if (r.status === 403) say("只可刪除由本站用戶新增的產品。");
    else say("未能刪除，請稍後再試。");
  } catch {
    say("網絡出錯，未能刪除，請再試。");
  } finally {
    btn.disabled = false;
  }
}

// ---------- barcode scanner ----------
// Native BarcodeDetector (Chrome / Android, Safari 17+ on some devices); otherwise a polyfill
// (barcode-detector, ZXing compiled to WebAssembly, MIT) is loaded on first use.

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const POLYFILL = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/dist/iife/polyfill.js";
let detectorP = null, scanStream = null, scanTimer = null;

function getDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      let native = "BarcodeDetector" in window;
      if (native) {
        try {
          const ok = await BarcodeDetector.getSupportedFormats();
          native = BARCODE_FORMATS.some((f) => ok.includes(f));
        } catch { native = false; }
      }
      if (!native) {
        delete window.BarcodeDetector;
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = POLYFILL; s.onload = resolve; s.onerror = () => reject(new Error("polyfill"));
          document.head.appendChild(s);
        });
      }
      return new BarcodeDetector({ formats: BARCODE_FORMATS });
    })().catch((e) => { detectorP = null; throw e; });
  }
  return detectorP;
}

const scanEl = (id) => document.getElementById(id);
const scanStatus = (t, cls = "") => { const s = scanEl("scanStatus"); s.textContent = t; s.className = "scan-status " + cls; };

// scanHandler: null = open the product page of the code. A function = continuous mode (snack box):
// each new code is passed to it, the camera stays open, and its answer is shown as the status.
let scanHandler = null, lastScan = { code: "", t: 0 };

async function foundCode(code) {
  if (navigator.vibrate) navigator.vibrate(60);
  if (!scanHandler) {
    closeScanner();
    location.hash = `#/p/i/${code}`;
    return;
  }
  if (code === lastScan.code && Date.now() - lastScan.t < 3000) return;   // same pack still in view
  lastScan = { code, t: Date.now() };
  scanStatus("正在加入…");
  try {
    const [msg, ok] = await scanHandler(code);
    scanStatus(msg, ok ? "ok" : "warn");
  } catch {
    scanStatus("未能加入，請再試。", "warn");
  }
}

async function openScanner(handler = null) {
  const dlg = scanEl("scanner");
  if (dlg.open) return;
  scanHandler = typeof handler === "function" ? handler : null;
  lastScan = { code: "", t: 0 };
  scanEl("scanTitle").textContent = scanHandler ? "掃描加入零食盒" : "掃描條碼";
  dlg.showModal();
  scanEl("scanCode").value = "";
  scanEl("scanView").classList.remove("off");
  scanStatus("正在開啟相機…");
  if (!navigator.mediaDevices?.getUserMedia) {
    scanEl("scanView").classList.add("off");
    scanStatus("這個瀏覽器不能使用相機。請輸入條碼數字，或用相片掃描。", "warn");
    return;
  }
  try {
    const [stream, detector] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
      getDetector(),
    ]);
    if (!dlg.open) { stream.getTracks().forEach((t) => t.stop()); return; }
    scanStream = stream;
    const video = scanEl("scanVideo");
    video.srcObject = stream;
    await video.play();
    scanStatus(scanHandler ? "逐件掃描，掃完按右上角關閉" : "把條碼放在框內");
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => /^\d{6,14}$/.test(c.rawValue));
        if (hit && !scanHandler) return foundCode(hit.rawValue);
        if (hit) await foundCode(hit.rawValue);
      } catch { /* frame not ready */ }
      scanTimer = setTimeout(tick, 120);
    };
    tick();
  } catch (e) {
    scanEl("scanView").classList.add("off");
    scanStatus(e && e.name === "NotAllowedError" ? "相機權限被拒絕。請在瀏覽器設定中允許使用相機，或輸入條碼數字。"
      : e && e.message === "polyfill" ? "未能載入條碼掃描工具。請輸入條碼數字。"
      : "未能開啟相機。請輸入條碼數字，或用相片掃描。", "warn");
  }
}

function closeScanner() {
  clearTimeout(scanTimer);
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
  const dlg = scanEl("scanner");
  if (dlg.open) dlg.close();
}

(function initScanner() {
  const dlg = scanEl("scanner");
  scanEl("scanBtn").addEventListener("click", () => openScanner());
  scanEl("scanClose").addEventListener("click", closeScanner);
  dlg.addEventListener("close", closeScanner);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeScanner(); });
  scanEl("scanManual").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = scanEl("scanCode").value.replace(/\D/g, "");
    if (/^\d{6,14}$/.test(v)) { scanEl("scanCode").value = ""; lastScan = { code: "", t: 0 }; foundCode(v); }
    else scanStatus("條碼應該是 6 至 14 位數字。", "warn");
  });
  scanEl("scanFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    scanStatus("正在讀取相片…");
    try {
      const [detector, bmp] = await Promise.all([getDetector(), createImageBitmap(file)]);
      const codes = await detector.detect(bmp);
      const hit = codes.find((c) => /^\d{6,14}$/.test(c.rawValue));
      if (hit) foundCode(hit.rawValue);
      else scanStatus("相片中找不到條碼。請拍得近一點，條碼要清楚。", "warn");
    } catch {
      scanStatus("未能讀取相片。請輸入條碼數字。", "warn");
    }
  });
})();
