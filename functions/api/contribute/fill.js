// POST /api/contribute/fill   (multipart/form-data)
// A user fills in the nutrition label (and the ingredients, allergens, photos) of a product that has
// no nutrition data: an Open Food Facts product, a product from the live Open Food Facts search, or a
// product added by a user without a label. Needs the add password (header x-add-password).
//
// Fields: code*, api_version (to clear the cached product page), and the label / ingredient / photo
// fields of /api/contribute/product. Empty fields keep the old value.
// The completed product is saved in user_products (a rebuild keeps it) and products. Products from Open
// Food Facts get origin 'off_user' (label from a user, the rest from Open Food Facts).
import { json, bad } from "../../_lib.js";
import { pdb, addPasswordError, barcodeVariants, getProduct } from "../../_products.js";
import { text, today, readLabel, keyColumns, readPhotos, savePhotos, writeRow, forgetCached } from "../../_contribute.js";
import { AI_VERSION } from "../product-ai.js";

export async function onRequestPost({ request, env }) {
  const denied = addPasswordError(env, request.headers.get("x-add-password") || "");
  if (denied) return denied;
  let form;
  try {
    form = await request.formData();
  } catch {
    return bad("send multipart/form-data");
  }
  const code = text(form.get("code"), 20);
  if (!code || !barcodeVariants(code).length) return bad("code must be a barcode (6-14 digits)");
  const found = await getProduct(env, code);
  if (!found) return bad("product not found", 404);
  const old = found.product;
  if (old.has_nutrition) return json({ error: "product already has nutrition data", code: old.code }, 0, 409);

  const label = readLabel(form);
  if (label.error) return bad(label.error);
  if (!label.hasNutrition) return bad("enter at least energy, protein, fat or carbohydrate");
  const photoFiles = readPhotos(form);
  if (photoFiles.error) return bad(photoFiles.error);

  const db = pdb(env);
  const stored = found.live ? null
    : await db.prepare("SELECT search_text FROM products WHERE code = ?1").bind(old.code).first();
  const photos = [...(old.photos ? JSON.parse(old.photos) : []), ...await savePhotos(env, old.code, photoFiles.files)];
  const nutrients = { ...(old.nutrients || {}), ...label.nutrients };
  const row = {
    ...old,
    category: old.category || "other",
    markets: old.markets || ",",
    serving_size: label.servingSize ?? old.serving_size, serving_g: label.servingG ?? old.serving_g,
    ...keyColumns(nutrients), nutrients: JSON.stringify(nutrients), has_nutrition: 1,
    ingredients: text(form.get("ingredients"), 3000) ?? old.ingredients,
    allergens: text(form.get("allergens"), 300) ?? old.allergens,
    image: old.image || photos[0] || null, photos: photos.length ? JSON.stringify(photos) : null,
    last_modified: today(), scans: old.scans || 0,
    search_text: stored?.search_text || [old.name, old.brand, old.quantity, old.code].filter(Boolean).join(" ").toLowerCase(),
    origin: old.origin === "user" ? "user" : "off_user",
  };
  const isNew = found.live;   // from the live Open Food Facts search: not in our database yet
  await db.batch([
    ...writeRow(db, row, { replace: true }),
    ...(isNew ? [
      db.prepare("INSERT INTO products_fts (code, search_text) VALUES (?1, ?2)").bind(row.code, row.search_text),
      db.prepare("UPDATE product_categories SET n = n + 1 WHERE id = ?1").bind(row.category),
    ] : []),
    // the old AI analysis was made without the label: remove it (the table is made on first use)
    db.prepare(`CREATE TABLE IF NOT EXISTS product_ai (code TEXT NOT NULL, ai_version TEXT NOT NULL,
      result TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (code, ai_version)) WITHOUT ROWID`),
    db.prepare("DELETE FROM product_ai WHERE code = ?1").bind(row.code),
  ]);
  await forgetCached(request, row.code, text(form.get("api_version"), 40), AI_VERSION);
  return json({ code: row.code, photos: photos.length }, 0, 200);
}
