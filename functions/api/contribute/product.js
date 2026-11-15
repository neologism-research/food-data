// POST /api/contribute/product   (multipart/form-data)
// A user adds a packaged product on the site. Needs the add password (header x-add-password,
// secret ADD_PASSWORD). The product is shown at once, marked as user-added and not checked.
//
// Fields: code (barcode; empty = no barcode), name*, brand, quantity, category*, markets (repeated, e.g. HK),
//   per ("g" or "ml": the label is per 100 g or per 100 ml), energy_kcal, energy_kj, protein, fat, fat_sat,
//   fat_trans, carbohydrate, sugars, fibre, sodium (mg), serving_size, serving_g, ingredients, allergens,
//   photo (0-3 image files, front photo first)
// Saved in user_products (master copy, kept by rebuilds) and in products + products_fts (what the site reads).
// Photos go to the R2 bucket (binding PHOTOS) as p/<code>/<time>-<n>.<ext>.
import { json, bad } from "../../_lib.js";
import { pdb, addPasswordError, barcodeVariants } from "../../_products.js";

const COLUMNS = ["code", "name", "generic_name", "brand", "quantity", "category", "off_category", "markets", "countries",
  "image", "nutriscore", "nova", "serving_size", "serving_g", "energy_kcal", "protein", "fat", "carbohydrate", "sugars",
  "fibre", "sodium", "nutrients", "has_nutrition", "ingredients", "allergens", "traces", "labels", "scans",
  "last_modified", "search_text", "origin", "photos"];
// [field, max value] per 100 g / 100 ml. Grams cannot be more than 100.
const NUMBERS = [["energy_kcal", 950], ["energy_kj", 4000], ["protein", 100], ["fat", 100], ["fat_sat", 100],
  ["fat_trans", 100], ["carbohydrate", 100], ["sugars", 100], ["fibre", 100], ["sodium", 40000]];
const MARKETS = ["HK", "MO", "TW", "CN", "JP", "KR", "SG", "MY", "TH", "PH", "ID", "VN", "IN"];
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTOS = 3, MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const text = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, n) : null;
};

export async function onRequestPost({ request, env }) {
  const denied = addPasswordError(env, request.headers.get("x-add-password") || "");
  if (denied) return denied;
  let form;
  try {
    form = await request.formData();
  } catch {
    return bad("send multipart/form-data");
  }
  const db = pdb(env);

  // --- fields
  const name = text(form.get("name"), 200);
  if (!name) return bad("name is required");
  const category = text(form.get("category"), 40);
  const cat = category && await db.prepare("SELECT id FROM product_categories WHERE id = ?1").bind(category).first();
  if (!cat) return bad("category is not valid");
  const markets = [...new Set(form.getAll("markets").map(String))].filter((m) => MARKETS.includes(m));
  const per = form.get("per") === "ml" ? "ml" : "g";

  const nutrients = {};
  for (const [id, max] of NUMBERS) {
    const raw = text(form.get(id), 20);
    if (raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) return bad(`${id} must be a number from 0 to ${max}`);
    nutrients[id] = v;
  }
  if (nutrients.energy_kj !== undefined && nutrients.energy_kcal === undefined) nutrients.energy_kcal = +(nutrients.energy_kj / 4.184).toFixed(1);
  if (nutrients.energy_kcal !== undefined && nutrients.energy_kj === undefined) nutrients.energy_kj = +(nutrients.energy_kcal * 4.184).toFixed(0);
  for (const [part, whole] of [["fat_sat", "fat"], ["fat_trans", "fat"], ["sugars", "carbohydrate"]]) {
    if (nutrients[part] !== undefined && nutrients[whole] !== undefined && nutrients[part] > nutrients[whole] + 0.05) {
      return bad(`${part} cannot be more than ${whole}`);
    }
  }
  if (nutrients.sodium !== undefined) nutrients.salt_eq = +(nutrients.sodium * 2.5 / 1000).toFixed(3);
  if (per === "ml") nutrients._per = "ml";
  const hasNutrition = ["energy_kcal", "protein", "fat", "carbohydrate"].some((k) => k in nutrients) ? 1 : 0;

  const servingG = text(form.get("serving_g"), 10);
  const servingGrams = servingG === null ? null : Number(servingG);
  if (servingGrams !== null && !(servingGrams > 0 && servingGrams <= 5000)) return bad("serving_g must be from 0 to 5000");

  // --- barcode: given, or a new in-store number (GS1 prefix 29, never used on real products)
  let code = text(form.get("code"), 20);
  if (code) {
    if (!barcodeVariants(code).length) return bad("code must be a barcode (6-14 digits)");
    code = code.replace(/\D/g, "");
    const exists = await db.prepare("SELECT code FROM products WHERE code IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(barcodeVariants(code))).first();
    if (exists) return json({ error: "product exists", code: exists.code }, 0, 409);
  } else {
    for (let i = 0; i < 5 && !code; i++) {
      const c = "29" + Array.from(crypto.getRandomValues(new Uint8Array(11)), (b) => b % 10).join("");
      if (!(await db.prepare("SELECT 1 FROM products WHERE code = ?1").bind(c).first())) code = c;
    }
    if (!code) return bad("could not make a product number, try again", 500);
  }

  // --- photos
  const files = form.getAll("photo").filter((f) => f && typeof f === "object" && f.size > 0).slice(0, MAX_PHOTOS);
  for (const f of files) {
    if (!IMAGE_TYPES[f.type]) return bad("photos must be JPEG, PNG or WebP");
    if (f.size > MAX_PHOTO_BYTES) return bad("a photo is too large (6 MB at most)");
  }
  const photos = [];
  const stamp = Date.now();
  for (const [i, f] of files.entries()) {
    const key = `p/${code}/${stamp}-${i}.${IMAGE_TYPES[f.type]}`;
    await env.PHOTOS.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    photos.push(`/photos/${key}`);
  }

  // --- save
  const brand = text(form.get("brand"), 80);
  const quantity = text(form.get("quantity"), 40);
  const today = new Date().toISOString().slice(0, 10);
  const row = {
    code, name, generic_name: null, brand, quantity, category, off_category: null,
    markets: markets.length ? `,${markets.join(",")},` : ",", countries: null,
    image: photos[0] || null, nutriscore: null, nova: null,
    serving_size: text(form.get("serving_size"), 60), serving_g: servingGrams,
    energy_kcal: nutrients.energy_kcal ?? null, protein: nutrients.protein ?? null, fat: nutrients.fat ?? null,
    carbohydrate: nutrients.carbohydrate ?? null, sugars: nutrients.sugars ?? null, fibre: nutrients.fibre ?? null,
    sodium: nutrients.sodium ?? null, nutrients: JSON.stringify(nutrients), has_nutrition: hasNutrition,
    ingredients: text(form.get("ingredients"), 3000), allergens: text(form.get("allergens"), 300), traces: null,
    labels: null, scans: 0, last_modified: today,
    search_text: [name, brand, quantity, code].filter(Boolean).join(" ").toLowerCase(),
    origin: "user", photos: photos.length ? JSON.stringify(photos) : null,
  };
  const values = COLUMNS.map((c) => row[c]);
  const marks = (n) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(", ");
  await db.batch([
    db.prepare(`INSERT INTO user_products (${COLUMNS.join(", ")}, created) VALUES (${marks(COLUMNS.length + 1)})`)
      .bind(...values, new Date().toISOString()),
    db.prepare(`INSERT INTO products (${COLUMNS.join(", ")}) VALUES (${marks(COLUMNS.length)})`).bind(...values),
    db.prepare("INSERT INTO products_fts (code, search_text) VALUES (?1, ?2)").bind(code, row.search_text),
    db.prepare("UPDATE product_categories SET n = n + 1 WHERE id = ?1").bind(category),
    ...markets.map((m) => db.prepare("UPDATE product_markets SET n = n + 1 WHERE id = ?1").bind(m)),
  ]);
  return json({ code, photos: photos.length }, 0, 201);
}
