// GET /photos/<key>  : a photo of a user-added product, from the private R2 bucket (binding PHOTOS).
// The site password (functions/_middleware.js) protects this path like every other path.
export async function onRequestGet({ params, env }) {
  const key = (params.path || []).join("/");
  if (!/^p\/\d{6,14}\/[\w.-]+$/.test(key)) return new Response("not found", { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",   // keys never change; private: behind a password
      etag: obj.httpEtag,
    },
  });
}
