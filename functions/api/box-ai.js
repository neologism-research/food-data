// GET /api/box-ai?items=<code>:<amount>,<code>:<amount>,...   (amount in g or ml; at most 30 items)
// AI comment on a snack box: the combination of products, at the amounts in the box. Same answer
// shape as /api/product-ai (score 0-100, verdict, summary, good, watch, tip). DeepSeek, HK Chinese.
// The site sends the items sorted by code, so the same box has the same address. Answers are saved in
// the table box_ai (key = the items, AI version), so the same box calls DeepSeek only once.
import { json, bad, cached } from "../_lib.js";
import { pdb, getProduct } from "../_products.js";

const BOX_AI_VERSION = "1";
const MAX_AGE = 30 * 86400;
const MAX_ITEMS = 30;

const SYSTEM = `你是香港的註冊營養師。用戶把幾件包裝零食放進一個「零食盒」，請評估這個組合是否適合作為一份零食。
你會收到每件產品的份量（克或毫升）及該份量的營養素，以及整盒的總和。
評分 0 至 100（整個組合）：90-100 非常好；70-89 好；50-69 一般；30-49 不太好；0-29 差。
考慮：總熱量（一份零食一般 150-300 kcal 較適合，多於 500 kcal 已接近一餐）；蛋白質、糖、鈉、飽和脂肪；
參考香港食物安全中心標準（高糖 >15克/100克，飲品 >7.5克/100毫升；高鈉 >600毫克/100克）；組合是否均衡。
請指出哪一件產品帶來最多糖、鈉或脂肪，並給一個具體建議（例如把某件換成另一類產品，或減少份量）。
資料不足時要說明並給較保守的分數。不要給醫療建議。全部用香港繁體中文（書面語）。只輸出 json，格式如下：
{"score": 55, "verdict": "一般，可以改善", "summary": "不超過90字的總結", "good": ["優點，每點不超過25字"], "watch": ["要注意的地方，每點不超過30字"], "tip": "一句具體建議，不超過45字", "confidence": "high"}
good 和 watch 各 0 至 3 點。confidence 是 high、medium 或 low。`;

const r1 = (x) => Math.round(x * 10) / 10;

function parseItems(raw) {
  const items = (raw || "").split(",").filter(Boolean).map((x) => {
    const [code, amount] = x.split(":");
    return { code, amount: Number(amount) };
  });
  if (!items.length || items.length > MAX_ITEMS) return null;
  if (items.some((i) => !/^\d{6,14}$/.test(i.code) || !(i.amount > 0 && i.amount <= 5000))) return null;
  return items;
}

async function askDeepSeek(env, text) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || "deepseek-flash",
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
      response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 1500,
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`DeepSeek HTTP ${res.status}`), { status: res.status });
  const d = await res.json();
  const content = (d.choices?.[0]?.message?.content || "").trim();
  return content ? JSON.parse(content) : null;
}

const str = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const list = (a) => (Array.isArray(a) ? a.map((s) => str(s, 70)).filter(Boolean).slice(0, 3) : []);

async function handle({ request, env }) {
  const raw = new URL(request.url).searchParams.get("items");
  const items = parseItems(raw);
  if (!items) return bad(`items must be 1-${MAX_ITEMS} entries of code:amount (amount 1-5000)`);
  if (!env.DEEPSEEK_API_KEY) return bad("AI is not set up (DEEPSEEK_API_KEY is missing)", 503);
  const key = items.map((i) => `${i.code}:${i.amount}`).sort().join(",");
  const db = pdb(env);
  await db.prepare(`CREATE TABLE IF NOT EXISTS box_ai (items TEXT NOT NULL, ai_version TEXT NOT NULL,
    result TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (items, ai_version)) WITHOUT ROWID`).run();
  const saved = await db.prepare("SELECT result FROM box_ai WHERE items = ?1 AND ai_version = ?2").bind(key, BOX_AI_VERSION).first();
  if (saved) return json(JSON.parse(saved.result), MAX_AGE);

  // the products, at the amounts in the box
  const found = await Promise.all(items.map((i) => getProduct(env, i.code)));
  const total = { kcal: 0, protein: 0, fat: 0, fat_sat: 0, carbohydrate: 0, sugars: 0, fibre: 0, sodium: 0 };
  const lines = [];
  let missing = 0;
  items.forEach((it, idx) => {
    const p = found[idx]?.product;
    if (!p) { missing++; return; }
    const n = p.nutrients || {};
    const unit = n._per === "ml" || /\d\s*(ml|l)\b|毫升/i.test(p.quantity || "") ? "毫升" : "克";
    if (!p.has_nutrition) { missing++; lines.push(`- ${p.name}（${p.brand || "無品牌"}），${it.amount}${unit}：沒有營養資料`); return; }
    const f = it.amount / 100;
    const at = (k) => (typeof n[k] === "number" ? n[k] * f : null);
    const kcal = at("energy_kcal");
    for (const k of Object.keys(total)) {
      const v = k === "kcal" ? kcal : at(k);
      if (v !== null) total[k] += v;
    }
    const parts = [["熱量", kcal, "kcal"], ["蛋白質", at("protein"), "克"], ["脂肪", at("fat"), "克"], ["飽和脂肪", at("fat_sat"), "克"],
      ["碳水化合物", at("carbohydrate"), "克"], ["糖", at("sugars"), "克"], ["鈉", at("sodium"), "毫克"]]
      .filter(([, v]) => v !== null).map(([k, v, u]) => `${k} ${r1(v)}${u}`).join("、");
    lines.push(`- ${p.name}（${p.brand || "無品牌"}${p.off_category ? `，${p.off_category}` : ""}），${it.amount}${unit}：${parts}`);
  });
  if (missing === items.length) return bad("no product in the box has nutrition data", 422);
  const text = [`零食盒共有 ${items.length} 件產品：`, ...lines,
    `整盒總和：熱量 ${r1(total.kcal)} kcal、蛋白質 ${r1(total.protein)} 克、脂肪 ${r1(total.fat)} 克（飽和脂肪 ${r1(total.fat_sat)} 克）、碳水化合物 ${r1(total.carbohydrate)} 克、糖 ${r1(total.sugars)} 克、膳食纖維 ${r1(total.fibre)} 克、鈉 ${r1(total.sodium)} 毫克。`,
    missing ? `有 ${missing} 件產品沒有營養資料，未計入總和。` : ""].filter(Boolean).join("\n");

  let out = null;
  for (let i = 0; i < 3 && !out; i++) {   // retries: a blank or broken JSON answer
    try {
      out = await askDeepSeek(env, text);
    } catch (e) {
      if (e.status) return bad("AI service error", 502);
    }
  }
  const score = Math.round(Number(out?.score));
  if (!out || !(score >= 0 && score <= 100)) return bad("AI answer was not valid", 502);
  const result = {
    score, verdict: str(out.verdict, 14), summary: str(out.summary, 220), good: list(out.good), watch: list(out.watch),
    tip: str(out.tip, 120), confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium",
    model: env.DEEPSEEK_MODEL || "deepseek-flash", created: new Date().toISOString().slice(0, 10),
  };
  await db.prepare("INSERT OR REPLACE INTO box_ai (items, ai_version, result, created) VALUES (?1, ?2, ?3, ?4)")
    .bind(key, BOX_AI_VERSION, JSON.stringify(result), result.created).run();
  return json(result, MAX_AGE);
}

export const onRequestGet = (context) => cached(context, handle);
