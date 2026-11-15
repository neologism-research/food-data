// GET /api/products/recent?limit=<n>
// The products that users added or completed most recently (user_products), newest first, and a
// stamp of the newest change. The site adds the stamp to its list addresses (u=...), so a list
// that was cached before a user added a product is not used again.
import { json, cached } from "../../_lib.js";
import { pdb, listCols } from "../../_products.js";

async function handle({ request, env }) {
  const limit = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get("limit") || "8", 10) || 8, 1), 40);
  const db = pdb(env);
  const [rows, stamp] = await db.batch([
    db.prepare(`SELECT ${listCols("p")}, u.created FROM user_products u JOIN products p ON p.code = u.code
      ORDER BY u.created DESC LIMIT ?1`).bind(limit),
    db.prepare("SELECT COUNT(*) AS n, MAX(created) AS last FROM user_products"),
  ]);
  const s = stamp.results[0];
  return json({ total: s.n, stamp: s.last ? `${s.n}-${Date.parse(s.last)}` : "0", results: rows.results }, 30);
}

export const onRequestGet = (context) => cached(context, handle);
