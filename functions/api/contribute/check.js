// POST /api/contribute/check   body: {"password": "..."}
// Checks the password for adding products (secret ADD_PASSWORD). 204 = correct.
import { addPasswordError } from "../../_products.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  return addPasswordError(env, String(body.password || "")) || new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
