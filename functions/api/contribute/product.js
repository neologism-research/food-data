// POST /api/contribute/product   (multipart/form-data)
// A user adds a packaged product on the site. Needs the add password (header x-add-password,
// secret ADD_PASSWORD). The product is shown at once, marked as user-added and not checked.
//
// Fields: code (barcode; empty = no barcode), name*, brand, quantity, category*, markets (repeated, e.g. HK),
//   per ("g" or "ml": the label is per 100 g or per 100 ml), energy_kcal, energy_kj, protein, fat, fat_sat,
//   fat_trans, carbohydrate, sugars, fibre, sodium (mg), serving_size, serving_g, ingredients, allergens,
//   photo (0-3 image files, front photo first)
// Saved in user_products (master copy, kept by rebuilds) and in products + products_fts (what the site reads).
import { json, bad } from "../../_lib.js";
import { pdb, addPasswordError, barcodeVariants } from "../../_products.js";
import { MARKETS, text, today, readLabel, keyColumns, readPhotos, savePhotos, writeRow } from "../../_contribute.js";

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

  const name = text(form.get("name"), 200);
  if (!name) return bad("name is required");
  const category = text(form.get("category"), 40);
  const cat = category && await db.prepare("SELECT id FROM product_categories WHERE id = ?1").bind(category).first();
  if (!cat) return bad("category is not valid");
  const markets = [...new Set(form.getAll("markets").map(String))].filter((m) => MARKETS.includes(m));
  const label = readLabel(form);
  if (label.error) return bad(label.error);
  const photoFiles = readPhotos(form);
  if (photoFiles.error) return bad(photoFiles.error);

  // barcode: given, or a new in-store number (GS1 prefix 29, never used on real products)
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

  const photos = await savePhotos(env, code, photoFiles.files);
  const brand = text(form.get("brand"), 80);
  const quantity = text(form.get("quantity"), 40);
  const row = {
    code, name, brand, quantity, category, markets: markets.length ? `,${markets.join(",")},` : ",",
    image: photos[0] || null, serving_size: label.servingSize, serving_g: label.servingG,
    ...keyColumns(label.nutrients), nutrients: JSON.stringify(label.nutrients), has_nutrition: label.hasNutrition,
    ingredients: text(form.get("ingredients"), 3000), allergens: text(form.get("allergens"), 300),
    scans: 0, last_modified: today(),
    search_text: [name, brand, quantity, code].filter(Boolean).join(" ").toLowerCase(),
    origin: "user", photos: photos.length ? JSON.stringify(photos) : null,
  };
  await db.batch([
    ...writeRow(db, row),
    db.prepare("INSERT INTO products_fts (code, search_text) VALUES (?1, ?2)").bind(code, row.search_text),
    db.prepare("UPDATE product_categories SET n = n + 1 WHERE id = ?1").bind(category),
    ...markets.map((m) => db.prepare("UPDATE product_markets SET n = n + 1 WHERE id = ?1").bind(m)),
  ]);
  return json({ code, photos: photos.length }, 0, 201);
}
