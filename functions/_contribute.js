// Shared code for products that users add or complete on the site (functions/api/contribute/*).
// The add password is checked by the endpoints (addPasswordError in _products.js).
import { DATA_VERSION } from "./_lib.js";

// Columns of products and user_products, in table order (pipeline/build_products.py PRODUCT_COLUMNS)
export const COLUMNS = ["code", "name", "generic_name", "brand", "quantity", "category", "off_category", "markets", "countries",
  "image", "nutriscore", "nova", "serving_size", "serving_g", "energy_kcal", "protein", "fat", "carbohydrate", "sugars",
  "fibre", "sodium", "nutrients", "has_nutrition", "ingredients", "allergens", "traces", "labels", "scans",
  "last_modified", "search_text", "origin", "photos"];
export const MARKETS = ["HK", "MO", "TW", "CN", "JP", "KR", "SG", "MY", "TH", "PH", "ID", "VN", "IN"];
// [field, max value] per 100 g / 100 ml. Grams cannot be more than 100.
const NUMBERS = [["energy_kcal", 950], ["energy_kj", 4000], ["protein", 100], ["fat", 100], ["fat_sat", 100],
  ["fat_trans", 100], ["carbohydrate", 100], ["sugars", 100], ["fibre", 100], ["sodium", 40000]];
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTOS = 3, MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export const text = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, n) : null;
};
export const today = () => new Date().toISOString().slice(0, 10);

// Label values of the form -> { nutrients, hasNutrition, servingSize, servingG } or { error }
export function readLabel(form) {
  const nutrients = {};
  for (const [id, max] of NUMBERS) {
    const raw = text(form.get(id), 20);
    if (raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) return { error: `${id} must be a number from 0 to ${max}` };
    nutrients[id] = v;
  }
  if (nutrients.energy_kj !== undefined && nutrients.energy_kcal === undefined) nutrients.energy_kcal = +(nutrients.energy_kj / 4.184).toFixed(1);
  if (nutrients.energy_kcal !== undefined && nutrients.energy_kj === undefined) nutrients.energy_kj = +(nutrients.energy_kcal * 4.184).toFixed(0);
  for (const [part, whole] of [["fat_sat", "fat"], ["fat_trans", "fat"], ["sugars", "carbohydrate"]]) {
    if (nutrients[part] !== undefined && nutrients[whole] !== undefined && nutrients[part] > nutrients[whole] + 0.05) {
      return { error: `${part} cannot be more than ${whole}` };
    }
  }
  if (nutrients.sodium !== undefined) nutrients.salt_eq = +(nutrients.sodium * 2.5 / 1000).toFixed(3);
  if (form.get("per") === "ml") nutrients._per = "ml";
  const hasNutrition = ["energy_kcal", "protein", "fat", "carbohydrate"].some((k) => k in nutrients) ? 1 : 0;
  const raw = text(form.get("serving_g"), 10);
  const servingG = raw === null ? null : Number(raw);
  if (servingG !== null && !(servingG > 0 && servingG <= 5000)) return { error: "serving_g must be from 0 to 5000" };
  return { nutrients, hasNutrition, servingSize: text(form.get("serving_size"), 60), servingG };
}

// The key columns that come from the nutrients object
export const keyColumns = (n) => ({
  energy_kcal: n.energy_kcal ?? null, protein: n.protein ?? null, fat: n.fat ?? null, carbohydrate: n.carbohydrate ?? null,
  sugars: n.sugars ?? null, fibre: n.fibre ?? null, sodium: n.sodium ?? null,
});

// Photo files of the form -> { files } or { error }
export function readPhotos(form) {
  const files = form.getAll("photo").filter((f) => f && typeof f === "object" && f.size > 0).slice(0, MAX_PHOTOS);
  for (const f of files) {
    if (!IMAGE_TYPES[f.type]) return { error: "photos must be JPEG, PNG or WebP" };
    if (f.size > MAX_PHOTO_BYTES) return { error: "a photo is too large (6 MB at most)" };
  }
  return { files };
}

// Save photos to R2 (binding PHOTOS) as p/<code>/<time>-<n>.<ext>; returns the paths (/photos/...)
export async function savePhotos(env, code, files) {
  const out = [], stamp = Date.now();
  for (const [i, f] of files.entries()) {
    const key = `p/${code}/${stamp}-${i}.${IMAGE_TYPES[f.type]}`;
    await env.PHOTOS.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    out.push(`/photos/${key}`);
  }
  return out;
}

const marks = (n) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(", ");

// Statements that write one product row to user_products (master copy, kept by rebuilds) and products
export function writeRow(db, row, { replace = false } = {}) {
  const values = COLUMNS.map((c) => row[c] ?? null);
  const verb = replace ? "INSERT OR REPLACE" : "INSERT";
  return [
    db.prepare(`${verb} INTO user_products (${COLUMNS.join(", ")}, created) VALUES (${marks(COLUMNS.length + 1)})`)
      .bind(...values, new Date().toISOString()),
    db.prepare(`${verb} INTO products (${COLUMNS.join(", ")}) VALUES (${marks(COLUMNS.length)})`).bind(...values),
  ];
}

// Remove old answers for one product from the edge cache of this data centre (the one the user is on),
// so the product page shows the new data at once. Keys as made by cached() in _lib.js.
export async function forgetCached(request, code, apiVersion, aiVersion) {
  const origin = new URL(request.url).origin;
  const v = encodeURIComponent(apiVersion || "");
  const keys = [
    `${origin}/api/product?code=${code}&v=${v}&_v=${DATA_VERSION}`,
    `${origin}/api/product-ai?code=${code}&v=${v}&ai=${aiVersion}&_v=${DATA_VERSION}`,
  ];
  await Promise.all(keys.map((k) => caches.default.delete(new Request(k)).catch(() => false)));
}
