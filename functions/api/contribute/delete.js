// POST /api/contribute/delete   body: {"code": "...", "api_version": "..."}
// Deletes a product that a user added on the site (origin 'user'). Needs the add password
// (header x-add-password). Products from Open Food Facts cannot be deleted here.
// Removes: user_products and products rows, the search index entry, the saved AI answer, the photos
// in R2, the counts, and the cached product page of this data centre.
import { json, bad } from "../../_lib.js";
import { pdb, addPasswordError } from "../../_products.js";
import { forgetCached } from "../../_contribute.js";
import { AI_VERSION } from "../product-ai.js";

export async function onRequestPost({ request, env }) {
  const denied = addPasswordError(env, request.headers.get("x-add-password") || "");
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "");
  if (!/^\d{6,14}$/.test(code)) return bad("code must be a barcode (6-14 digits)");
  const db = pdb(env);
  const row = await db.prepare("SELECT code, category, markets, origin FROM products WHERE code = ?1").bind(code).first();
  if (!row) return bad("product not found", 404);
  if (row.origin !== "user") return bad("only products added by users can be deleted", 403);

  const markets = (row.markets || "").split(",").filter(Boolean);
  await db.batch([
    db.prepare("DELETE FROM user_products WHERE code = ?1").bind(code),
    db.prepare("DELETE FROM products WHERE code = ?1").bind(code),
    db.prepare("DELETE FROM products_fts WHERE code = ?1").bind(code),
    db.prepare(`CREATE TABLE IF NOT EXISTS product_ai (code TEXT NOT NULL, ai_version TEXT NOT NULL,
      result TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (code, ai_version)) WITHOUT ROWID`),
    db.prepare("DELETE FROM product_ai WHERE code = ?1").bind(code),
    db.prepare("UPDATE product_categories SET n = max(n - 1, 0) WHERE id = ?1").bind(row.category),
    ...markets.map((m) => db.prepare("UPDATE product_markets SET n = max(n - 1, 0) WHERE id = ?1").bind(m)),
  ]);
  const photos = await env.PHOTOS.list({ prefix: `p/${code}/` });
  if (photos.objects.length) await env.PHOTOS.delete(photos.objects.map((o) => o.key));
  await forgetCached(request, code, String(body.api_version || ""), AI_VERSION);
  return json({ deleted: code, photos: photos.objects.length }, 0);
}
