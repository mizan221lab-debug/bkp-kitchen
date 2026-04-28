// ════════════════════════════════════════════════════════════
//  BKP Kitchen LINE Webhook v2 — Phase 1-3
//  Covers: sales, payments, expenses, PO, products, raw materials,
//          recipes, shareholders, overhead, dividends, images,
//          multi-step dialog, daily reports, rich-menu support
// ════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://suatxkfygvlrlsscvmoo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1YXR4a2Z5Z3Zscmxzc2N2bW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzM5MjIsImV4cCI6MjA4OTc0OTkyMn0.5yBBvcYRGbrcnAftTuT08_Os3ouwSmnPiixCuOxRODA';
const LINE_TOKEN   = 'qs64c7efuccICIPZGwLmq2Xh1eipJuFry4hXBsacnbS/jNp+40bbSgiyF01t9qCsEFYkJm6qsd677rbh+xetUrEFsYS79OPoy5EasGTFAmwiG4TaP8KGEJ/oamnup7gyvll4xjMW65u8ap+rASDMPQdB04t89/1O/w1cDnyilFU=';
const WEB_URL      = 'https://midle-kitchen-yyv2.vercel.app';
const STORAGE_URL  = `${SUPABASE_URL}/storage/v1`;

const SB_HDR = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ════════ Supabase helpers ════════
async function sbGet(table, q = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, { headers: SB_HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HDR, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return Array.isArray(data) ? data[0] : data;
}
async function sbPatch(table, q, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: 'PATCH',
    headers: { ...SB_HDR, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function sbDelete(table, q) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: 'DELETE', headers: SB_HDR,
  });
}

// ════════ LINE helpers ════════
async function lineReply(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}
async function linePush(userId, text) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
}
async function lineGetImage(messageId) {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}` },
  });
  if (!r.ok) return null;
  return r.arrayBuffer();
}

// ════════ Utilities ════════
const fmt   = n => parseFloat(n || 0).toLocaleString('th-TH');
const today = () => new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' })).toISOString().split('T')[0];
const thisMonthStart = () => {
  const d = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

// ════════ Payment matching ════════
function exactMatch(bills, target) {
  const limit = Math.min(bills.length, 20);
  for (let mask = 1; mask < (1 << limit); mask++) {
    let s = 0, idx = [];
    for (let i = 0; i < limit; i++) if (mask & (1 << i)) { s += parseFloat(bills[i].total || 0); idx.push(i); }
    if (Math.abs(s - target) < 0.01) return idx;
  }
  return null;
}
function fifoMatch(bills, target) {
  let rem = target, cleared = [];
  for (const b of bills) {
    if (rem <= 0) break;
    const t = parseFloat(b.total || 0);
    if (rem >= t) { cleared.push(b.id); rem -= t; }
    else break;
  }
  return cleared;
}

// ════════ Image upload to Supabase Storage ════════
async function uploadImage(buffer, filename) {
  try {
    const r = await fetch(`${STORAGE_URL}/object/receipts/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (!r.ok) return null;
    return `${STORAGE_URL}/object/public/receipts/${filename}`;
  } catch { return null; }
}

// ════════ Line state (multi-step dialog) ════════
async function getState(userId) {
  const rows = await sbGet('line_state', `?user_id=eq.${encodeURIComponent(userId)}`);
  const s = rows?.[0];
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) { await sbDelete('line_state', `?user_id=eq.${encodeURIComponent(userId)}`); return null; }
  return s;
}
async function setState(userId, flow, step, data = {}) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/line_state`, {
    method: 'POST',
    headers: { ...SB_HDR, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, flow, step, data, expires_at: expires, updated_at: new Date().toISOString() }),
  });
}
async function clearState(userId) {
  await sbDelete('line_state', `?user_id=eq.${encodeURIComponent(userId)}`);
}

// ════════ Track LINE user ════════
async function trackUser(userId, displayName) {
  await fetch(`${SUPABASE_URL}/rest/v1/line_users`, {
    method: 'POST',
    headers: { ...SB_HDR, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, display_name: displayName || userId, last_seen: new Date().toISOString() }),
  });
}

// ════════════════════════════════════════════════════════════
//  REPORT BUILDERS
// ════════════════════════════════════════════════════════════
async function dailyReport(date) {
  const [sales, payments, expenses] = await Promise.all([
    sbGet('bkp_sales', `?sale_date=eq.${date}`),
    sbGet('bkp_payments', `?payment_date=eq.${date}`),
    sbGet('bkp_expenses', `?expense_date=eq.${date}`),
  ]);
  const salesTotal = sales.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal  = payments.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const expTotal   = expenses.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  return `📊 ยอดวันที่ ${date}\n━━━━━━━━━━━━━━\n💰 ขาย ${sales.length} รายการ: ฿${fmt(salesTotal)}\n💵 รับเงิน ${payments.length} ครั้ง: ฿${fmt(paidTotal)}\n💸 ค่าใช้จ่าย ${expenses.length} รายการ: ฿${fmt(expTotal)}\n━━━━━━━━━━━━━━\n📈 กำไรสุทธิ: ฿${fmt(paidTotal - expTotal)}`;
}

async function monthReport() {
  const start = thisMonthStart(), end = today();
  const [sales, payments, expenses] = await Promise.all([
    sbGet('bkp_sales', `?sale_date=gte.${start}&sale_date=lte.${end}`),
    sbGet('bkp_payments', `?payment_date=gte.${start}&payment_date=lte.${end}`),
    sbGet('bkp_expenses', `?expense_date=gte.${start}&expense_date=lte.${end}`),
  ]);
  const salesTotal = sales.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal  = payments.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const expTotal   = expenses.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  return `📊 สรุปเดือน (${start} → ${end})\n━━━━━━━━━━━━━━\n💰 ยอดขายรวม: ฿${fmt(salesTotal)}\n💵 รับเงินแล้ว: ฿${fmt(paidTotal)}\n⏳ ค้างชำระ: ฿${fmt(Math.max(0, salesTotal - paidTotal))}\n💸 ค่าใช้จ่าย: ฿${fmt(expTotal)}\n━━━━━━━━━━━━━━\n📈 กำไรสุทธิ: ฿${fmt(paidTotal - expTotal)}\n📦 ใบขาย ${sales.length} ใบ`;
}

async function customerReport(name) {
  const [unpaid, paid] = await Promise.all([
    sbGet('bkp_sales', `?paid=eq.false&customer=ilike.*${encodeURIComponent(name)}*&order=sale_date.asc`),
    sbGet('bkp_sales', `?paid=eq.true&customer=ilike.*${encodeURIComponent(name)}*&order=sale_date.desc&limit=5`),
  ]);
  const unpaidTotal = unpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  let msg = `👤 ลูกค้า: ${name}\n━━━━━━━━━━━━━━\n⏳ ค้าง ${unpaid.length} ใบ: ฿${fmt(unpaidTotal)}\n✅ ชำระแล้ว ${paid.length}+ ใบ\n`;
  if (unpaid.length) msg += `\n📋 รายการค้าง:\n` + unpaid.slice(0, 10).map(b => `• ${b.sale_date}: ฿${fmt(b.total)}`).join('\n');
  return msg;
}

// ════════════════════════════════════════════════════════════
//  PHASE 1 HANDLERS — Products / RM / Recipes / Shareholders / Overhead / Dividends
// ════════════════════════════════════════════════════════════

// ── สินค้า+ [ชื่อ] [rm] [ราคา]
async function cmdAddProduct(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: สินค้า+ [ชื่อ] [ต้นทุน/กก] [ราคาขาย/กก]\nเช่น: สินค้า+ หมูสับ 85 140');
  const [, name, rm, price] = rx;
  const margin = ((parseFloat(price) - parseFloat(rm)) / parseFloat(price) * 100).toFixed(1);
  await sbPost('bkp_products', { name: name.trim(), rm: parseFloat(rm), price: parseFloat(price) });
  return lineReply(rt, `✅ เพิ่มสินค้าแล้ว\n🍱 ${name.trim()}\n💸 ต้นทุน: ฿${fmt(rm)}/กก.\n💰 ราคาขาย: ฿${fmt(price)}/กก.\n📊 Margin: ${margin}%`);
}

// ── สินค้า / สินค้า [ชื่อ]
async function cmdListProducts(name, rt) {
  if (name) {
    const rows = await sbGet('bkp_products', `?name=ilike.*${encodeURIComponent(name)}*&order=sort_order.asc`);
    if (!rows.length) return lineReply(rt, `❌ ไม่พบสินค้า "${name}"`);
    const p = rows[0];
    const margin = ((parseFloat(p.price) - parseFloat(p.rm)) / parseFloat(p.price) * 100).toFixed(1);
    return lineReply(rt, `🍱 ${p.name}\n━━━━━━━━━━━━━━\n💸 ต้นทุน: ฿${fmt(p.rm)}/กก.\n💰 ราคาขาย: ฿${fmt(p.price)}/กก.\n📊 Margin: ${margin}%\n🆔 ID: ${p.id}`);
  }
  const rows = await sbGet('bkp_products', '?order=sort_order.asc');
  if (!rows.length) return lineReply(rt, '❌ ยังไม่มีสินค้า พิมพ์: สินค้า+ [ชื่อ] [ต้นทุน] [ราคา]');
  let msg = `🍱 สินค้าทั้งหมด (${rows.length})\n━━━━━━━━━━━━━━\n`;
  msg += rows.map(p => {
    const margin = ((parseFloat(p.price) - parseFloat(p.rm)) / parseFloat(p.price) * 100).toFixed(0);
    return `• ${p.name}  ฿${fmt(p.rm)}→฿${fmt(p.price)}/กก. (${margin}%)`;
  }).join('\n');
  return lineReply(rt, msg);
}

// ── ปรับราคา [ชื่อ] [ราคาใหม่]
async function cmdUpdatePrice(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: ปรับราคา [ชื่อสินค้า] [ราคาใหม่]');
  const [, name, price] = rx;
  const rows = await sbGet('bkp_products', `?name=ilike.*${encodeURIComponent(name.trim())}*&limit=1`);
  if (!rows.length) return lineReply(rt, `❌ ไม่พบสินค้า "${name.trim()}"`);
  const p = rows[0];
  const margin = ((parseFloat(price) - parseFloat(p.rm)) / parseFloat(price) * 100).toFixed(1);
  await sbPatch('bkp_products', `?id=eq.${p.id}`, { price: parseFloat(price) });
  return lineReply(rt, `✅ อัพเดทราคาแล้ว\n🍱 ${p.name}\n💰 ราคาใหม่: ฿${fmt(price)}/กก.\n📊 Margin ใหม่: ${margin}%`);
}

// ── วัตถุดิบ+ [ชื่อ] [ราคา] [หน่วย?]
async function cmdAddRM(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)(?:\s+(\S+))?$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: วัตถุดิบ+ [ชื่อ] [ราคา] [หน่วย]\nเช่น: วัตถุดิบ+ หมู 95 kg');
  const [, name, price, unit = 'kg'] = rx;
  await sbPost('bkp_raw_materials', { name: name.trim(), price: parseFloat(price), unit });
  return lineReply(rt, `✅ เพิ่มวัตถุดิบแล้ว\n📦 ${name.trim()}\n💰 ฿${fmt(price)}/${unit}`);
}

// ── วัตถุดิบ / ราคาวัตถุดิบ [ชื่อ] [ราคาใหม่]
async function cmdListRM(rt) {
  const rows = await sbGet('bkp_raw_materials', '?order=sort_order.asc,name.asc');
  if (!rows.length) return lineReply(rt, '❌ ยังไม่มีวัตถุดิบ พิมพ์: วัตถุดิบ+ [ชื่อ] [ราคา]');
  let msg = `📦 วัตถุดิบ (${rows.length})\n━━━━━━━━━━━━━━\n`;
  msg += rows.map(r => `• ${r.name}  ฿${fmt(r.price)}/${r.unit || 'kg'}`).join('\n');
  return lineReply(rt, msg);
}
async function cmdUpdateRM(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: ราคาวัตถุดิบ [ชื่อ] [ราคาใหม่]');
  const [, name, price] = rx;
  const rows = await sbGet('bkp_raw_materials', `?name=ilike.*${encodeURIComponent(name.trim())}*&limit=1`);
  if (!rows.length) return lineReply(rt, `❌ ไม่พบวัตถุดิบ "${name.trim()}"`);
  await sbPatch('bkp_raw_materials', `?id=eq.${rows[0].id}`, { price: parseFloat(price) });
  return lineReply(rt, `✅ อัพเดทราคาวัตถุดิบ\n📦 ${rows[0].name}: ฿${fmt(price)}/${rows[0].unit || 'kg'}`);
}

// ── สูตร+ [สินค้า] [วัตถุดิบ] [qty/kg]
async function cmdAddRecipe(args, rt) {
  const rx = args.match(/^(.+?)\s+(.+?)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: สูตร+ [สินค้า] [วัตถุดิบ] [ปริมาณต่อกก.]\nเช่น: สูตร+ หมูสับ หมู 1.15');
  const [, pName, rmName, qty] = rx;
  const [products, rms] = await Promise.all([
    sbGet('bkp_products', `?name=ilike.*${encodeURIComponent(pName.trim())}*&limit=1`),
    sbGet('bkp_raw_materials', `?name=ilike.*${encodeURIComponent(rmName.trim())}*&limit=1`),
  ]);
  if (!products.length) return lineReply(rt, `❌ ไม่พบสินค้า "${pName.trim()}"`);
  if (!rms.length) return lineReply(rt, `❌ ไม่พบวัตถุดิบ "${rmName.trim()}"`);
  await sbPost('bkp_recipes', { product_id: products[0].id, rm_id: rms[0].id, qty_per_kg: parseFloat(qty) });
  const cost = parseFloat(qty) * parseFloat(rms[0].price);
  return lineReply(rt, `✅ เพิ่มสูตรแล้ว\n🍱 ${products[0].name} ← ${rms[0].name} ${qty} ${rms[0].unit}/กก.\n💸 ต้นทุน: ฿${fmt(cost)}/กก.`);
}

// ── สูตร [สินค้า]
async function cmdShowRecipe(name, rt) {
  const products = await sbGet('bkp_products', `?name=ilike.*${encodeURIComponent(name)}*&limit=1`);
  if (!products.length) return lineReply(rt, `❌ ไม่พบสินค้า "${name}"`);
  const p = products[0];
  const recipes = await sbGet('bkp_recipes', `?product_id=eq.${p.id}`);
  if (!recipes.length) return lineReply(rt, `❌ ยังไม่มีสูตรสำหรับ ${p.name}`);
  const rmIds = recipes.map(r => r.rm_id).join(',');
  const rms = await sbGet('bkp_raw_materials', `?id=in.(${rmIds})`);
  const rmMap = Object.fromEntries(rms.map(r => [r.id, r]));
  let totalCost = 0;
  let msg = `🍱 สูตร: ${p.name}\n━━━━━━━━━━━━━━\n`;
  for (const rec of recipes) {
    const rm = rmMap[rec.rm_id];
    if (!rm) continue;
    const cost = parseFloat(rec.qty_per_kg) * parseFloat(rm.price);
    totalCost += cost;
    msg += `• ${rm.name}: ${rec.qty_per_kg} ${rm.unit}/กก. = ฿${fmt(cost)}\n`;
  }
  const margin = p.price ? ((parseFloat(p.price) - totalCost) / parseFloat(p.price) * 100).toFixed(1) : 'N/A';
  msg += `━━━━━━━━━━━━━━\n💸 ต้นทุนรวม: ฿${fmt(totalCost)}/กก.\n💰 ราคาขาย: ฿${fmt(p.price)}/กก.\n📊 Margin: ${margin}%`;
  return lineReply(rt, msg);
}

// ── หุ้น+ [ชื่อ] [%] [เงินลงทุน]
async function cmdAddShareholder(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: หุ้น+ [ชื่อ] [%หุ้น] [เงินลงทุน]\nเช่น: หุ้น+ สมชาย 30 50000');
  const [, name, pct, inv] = rx;
  await sbPost('bkp_shareholders', { name: name.trim(), pct: parseFloat(pct), investment: parseFloat(inv), investment_amount: parseFloat(inv), join_date: today() });
  return lineReply(rt, `✅ เพิ่มผู้ถือหุ้นแล้ว\n👤 ${name.trim()}\n📊 สัดส่วน: ${pct}%\n💰 เงินลงทุน: ฿${fmt(inv)}`);
}

// ── หุ้น
async function cmdListShareholders(rt) {
  const rows = await sbGet('bkp_shareholders', '?order=sort_order.asc,pct.desc');
  if (!rows.length) return lineReply(rt, '❌ ยังไม่มีผู้ถือหุ้น พิมพ์: หุ้น+ [ชื่อ] [%] [เงินลงทุน]');
  const totalPct = rows.reduce((s, r) => s + parseFloat(r.pct || 0), 0);
  let msg = `👥 ผู้ถือหุ้น (${rows.length} คน)\n━━━━━━━━━━━━━━\n`;
  msg += rows.map(r => `• ${r.name}  ${r.pct}%  ฿${fmt(r.investment || 0)}`).join('\n');
  msg += `\n━━━━━━━━━━━━━━\n📊 รวม: ${totalPct.toFixed(1)}%`;
  return lineReply(rt, msg);
}

// ── ปรับหุ้น [ชื่อ] [%ใหม่]
async function cmdUpdateSharePct(args, rt) {
  const rx = args.match(/^(.+?)\s+([\d.]+)$/);
  if (!rx) return lineReply(rt, '❌ รูปแบบ: ปรับหุ้น [ชื่อ] [%ใหม่]');
  const [, name, pct] = rx;
  const rows = await sbGet('bkp_shareholders', `?name=ilike.*${encodeURIComponent(name.trim())}*&limit=1`);
  if (!rows.length) return lineReply(rt, `❌ ไม่พบผู้ถือหุ้น "${name.trim()}"`);
  await sbPatch('bkp_shareholders', `?id=eq.${rows[0].id}`, { pct: parseFloat(pct) });
  return lineReply(rt, `✅ อัพเดทหุ้นแล้ว\n👤 ${rows[0].name}: ${pct}%`);
}

// ── โสหุ้ย / โสหุ้ย [หมวด] [%]
async function cmdOverhead(args, rt) {
  const fields = { 'แรงงาน': 'labor', 'บัญชี': 'accounting', 'ไฟ': 'electricity', 'ทำความสะอาด': 'cleaning', 'ค่าเสื่อม': 'depreciation', 'แก๊ส': 'gas', 'labor': 'labor', 'accounting': 'accounting', 'electricity': 'electricity', 'cleaning': 'cleaning', 'depreciation': 'depreciation', 'gas': 'gas' };
  const rx = args.match(/^(.+?)\s+([\d.]+)$/);
  if (rx) {
    const [, cat, pct] = rx;
    const field = fields[cat.trim()];
    if (!field) return lineReply(rt, `❌ หมวดไม่ถูกต้อง\nหมวดที่รองรับ: ${Object.keys(fields).filter(k => !['labor','accounting','electricity','cleaning','depreciation','gas'].includes(k)).join(' | ')}`);
    await sbPatch('bkp_overhead', '?id=eq.1', { [field]: parseFloat(pct) });
    return lineReply(rt, `✅ อัพเดทโสหุ้ย\n🏭 ${cat.trim()}: ${pct}%`);
  }
  const rows = await sbGet('bkp_overhead', '?id=eq.1&limit=1');
  if (!rows.length) return lineReply(rt, '❌ ยังไม่มีข้อมูลโสหุ้ย');
  const oh = rows[0];
  const total = ['labor','accounting','electricity','cleaning','depreciation','gas'].reduce((s,k) => s + parseFloat(oh[k] || 0), 0);
  return lineReply(rt, `🏭 ค่าโสหุ้ย (% ของยอดขาย)\n━━━━━━━━━━━━━━\n👷 แรงงาน: ${oh.labor || 0}%\n📊 บัญชี: ${oh.accounting || 0}%\n⚡ ไฟ: ${oh.electricity || 0}%\n🧹 ทำความสะอาด: ${oh.cleaning || 0}%\n🔧 ค่าเสื่อม: ${oh.depreciation || 0}%\n🔥 แก๊ส: ${oh.gas || 0}%\n━━━━━━━━━━━━━━\n📊 รวม: ${total.toFixed(1)}%`);
}

// ── ปันผล [ปี] [กำไรรวม] [ยอดปันผล] หรือ ปันผล [ปี]
async function cmdDividend(args, rt) {
  const createRx = args.match(/^(\d{4})\s+([\d.]+)\s+([\d.]+)$/);
  const viewRx = args.match(/^(\d{4})$/);
  if (createRx) {
    const [, year, profit, divAmt] = createRx;
    const retained = parseFloat(profit) - parseFloat(divAmt);
    const div = await sbPost('bkp_dividends', { year: parseInt(year), total_profit: parseFloat(profit), dividend_amount: parseFloat(divAmt), retained_amount: retained, approved_date: today() });
    const shareholders = await sbGet('bkp_shareholders', '?order=sort_order.asc');
    if (!shareholders.length) return lineReply(rt, `✅ สร้าง round ปันผลปี ${year} แล้ว\n💰 ยอดปันผล: ฿${fmt(divAmt)}\nหมายเหตุ: ยังไม่มีผู้ถือหุ้น`);
    for (const sh of shareholders) {
      const amount = (parseFloat(divAmt) * parseFloat(sh.pct || 0) / 100).toFixed(2);
      await sbPost('bkp_dividend_items', { dividend_id: div.id, shareholder_id: sh.id, amount: parseFloat(amount), paid: false });
    }
    let msg = `✅ สร้าง round ปันผลปี ${year}\n━━━━━━━━━━━━━━\n💰 กำไรรวม: ฿${fmt(profit)}\n📤 ปันผล: ฿${fmt(divAmt)}\n💾 สะสม: ฿${fmt(retained)}\n━━━━━━━━━━━━━━\n`;
    for (const sh of shareholders) {
      const amount = (parseFloat(divAmt) * parseFloat(sh.pct || 0) / 100).toFixed(2);
      msg += `• ${sh.name} (${sh.pct}%): ฿${fmt(amount)}\n`;
    }
    return lineReply(rt, msg.trim());
  }
  if (viewRx) {
    const divs = await sbGet('bkp_dividends', `?year=eq.${viewRx[1]}&limit=1`);
    if (!divs.length) return lineReply(rt, `❌ ไม่พบ round ปันผลปี ${viewRx[1]}`);
    const div = divs[0];
    const items = await sbGet('bkp_dividend_items', `?dividend_id=eq.${div.id}`);
    const shIds = items.map(i => i.shareholder_id).join(',');
    const shs = shIds ? await sbGet('bkp_shareholders', `?id=in.(${shIds})`) : [];
    const shMap = Object.fromEntries(shs.map(s => [s.id, s]));
    let msg = `📋 ปันผลปี ${div.year}\n💰 ฿${fmt(div.dividend_amount)}\n━━━━━━━━━━━━━━\n`;
    for (const item of items) {
      const sh = shMap[item.shareholder_id];
      msg += `${item.paid ? '✅' : '⏳'} ${sh?.name || '?'}: ฿${fmt(item.amount)}${item.paid_at ? ` (${item.paid_at})` : ''}\n`;
    }
    return lineReply(rt, msg.trim());
  }
  return lineReply(rt, '❌ รูปแบบ:\nปันผล [ปี] [กำไรรวม] [ยอดปันผล]\nปันผล [ปี]  ← ดูสถานะ\nเช่น: ปันผล 2025 500000 200000');
}

// ── จ่ายปันผล [ชื่อ]
async function cmdPayDividend(name, rt) {
  const shs = await sbGet('bkp_shareholders', `?name=ilike.*${encodeURIComponent(name)}*&limit=1`);
  if (!shs.length) return lineReply(rt, `❌ ไม่พบผู้ถือหุ้น "${name}"`);
  const sh = shs[0];
  const items = await sbGet('bkp_dividend_items', `?shareholder_id=eq.${sh.id}&paid=eq.false&order=dividend_id.asc&limit=1`);
  if (!items.length) return lineReply(rt, `✅ ${sh.name} ไม่มียอดปันผลค้าง`);
  await sbPatch('bkp_dividend_items', `?id=eq.${items[0].id}`, { paid: true, paid_at: today() });
  return lineReply(rt, `✅ บันทึกจ่ายปันผลแล้ว\n👤 ${sh.name}: ฿${fmt(items[0].amount)}`);
}

// ════════════════════════════════════════════════════════════
//  PHASE 2 — Delete / Edit / Link / Image State
// ════════════════════════════════════════════════════════════

// ── ลบค่า [id], ลบขาย [id]
async function cmdDelete(type, id, rt) {
  const tableMap = { 'ค่า': 'bkp_expenses', 'expense': 'bkp_expenses', 'ขาย': 'bkp_sales', 'sale': 'bkp_sales', 'สั่ง': 'bkp_purchase_orders', 'po': 'bkp_purchase_orders' };
  const table = tableMap[type];
  if (!table) return lineReply(rt, `❌ ประเภทที่รองรับ: ค่า | ขาย | สั่ง`);
  await sbDelete(table, `?id=eq.${id}`);
  return lineReply(rt, `🗑️ ลบรายการแล้ว (${type} #${id.slice(0,8)}...)`);
}

// ── แก้ขาย [id] [ยอดใหม่], แก้ค่า [id] [ยอดใหม่]
async function cmdEdit(type, id, amount, rt) {
  const tableMap = { 'ขาย': ['bkp_sales', 'total'], 'ค่า': ['bkp_expenses', 'amount'] };
  const info = tableMap[type];
  if (!info) return lineReply(rt, '❌ รูปแบบ: แก้ขาย [id] [ยอดใหม่]  หรือ  แก้ค่า [id] [ยอดใหม่]');
  await sbPatch(info[0], `?id=eq.${id}`, { [info[1]]: parseFloat(amount) });
  return lineReply(rt, `✅ แก้ไขแล้ว\n${type} #${id.slice(0,8)}...\n💰 ยอดใหม่: ฿${fmt(amount)}`);
}

// ════════════════════════════════════════════════════════════
//  PHASE 3 — Multi-step dialog flows
// ════════════════════════════════════════════════════════════

const FLOW_HELP = {
  'เพิ่มสินค้า': 'add_product',
  'เพิ่มวัตถุดิบ': 'add_rm',
  'เพิ่มหุ้น': 'add_shareholder',
};

async function handleFlow(state, txt, userId, rt) {
  const { flow, step, data } = state;

  // ── add_product flow ──
  if (flow === 'add_product') {
    if (step === 0) { await setState(userId, flow, 1, { ...data }); return lineReply(rt, '🍱 ชื่อสินค้า?'); }
    if (step === 1) { await setState(userId, flow, 2, { ...data, name: txt }); return lineReply(rt, `💸 ต้นทุน/กก. ของ "${txt}"?`); }
    if (step === 2) { await setState(userId, flow, 3, { ...data, rm: parseFloat(txt) }); return lineReply(rt, `💰 ราคาขาย/กก. ของ "${data.name}"?`); }
    if (step === 3) {
      const { name, rm } = data; const price = parseFloat(txt);
      const margin = ((price - rm) / price * 100).toFixed(1);
      await sbPost('bkp_products', { name, rm, price });
      await clearState(userId);
      return lineReply(rt, `✅ เพิ่มสินค้าแล้ว!\n🍱 ${name}\n💸 ต้นทุน: ฿${fmt(rm)}/กก.\n💰 ราคาขาย: ฿${fmt(price)}/กก.\n📊 Margin: ${margin}%`);
    }
  }

  // ── add_rm flow ──
  if (flow === 'add_rm') {
    if (step === 0) { await setState(userId, flow, 1, {}); return lineReply(rt, '📦 ชื่อวัตถุดิบ?'); }
    if (step === 1) { await setState(userId, flow, 2, { name: txt }); return lineReply(rt, `💰 ราคาต่อหน่วยของ "${txt}"?`); }
    if (step === 2) { await setState(userId, flow, 3, { ...data, price: parseFloat(txt) }); return lineReply(rt, 'หน่วย? (เช่น kg, กก., ลัง, แพ็ก) หรือพิมพ์ - เพื่อใช้ kg'); }
    if (step === 3) {
      const unit = txt === '-' ? 'kg' : txt;
      await sbPost('bkp_raw_materials', { name: data.name, price: data.price, unit });
      await clearState(userId);
      return lineReply(rt, `✅ เพิ่มวัตถุดิบแล้ว!\n📦 ${data.name}: ฿${fmt(data.price)}/${unit}`);
    }
  }

  // ── add_shareholder flow ──
  if (flow === 'add_shareholder') {
    if (step === 0) { await setState(userId, flow, 1, {}); return lineReply(rt, '👤 ชื่อผู้ถือหุ้น?'); }
    if (step === 1) { await setState(userId, flow, 2, { name: txt }); return lineReply(rt, `📊 สัดส่วนหุ้น (%) ของ "${txt}"?`); }
    if (step === 2) { await setState(userId, flow, 3, { ...data, pct: parseFloat(txt) }); return lineReply(rt, '💰 เงินลงทุน (บาท)?'); }
    if (step === 3) {
      const inv = parseFloat(txt);
      await sbPost('bkp_shareholders', { name: data.name, pct: data.pct, investment: inv, investment_amount: inv, join_date: today() });
      await clearState(userId);
      return lineReply(rt, `✅ เพิ่มผู้ถือหุ้นแล้ว!\n👤 ${data.name}\n📊 ${data.pct}%\n💰 ฿${fmt(inv)}`);
    }
  }

  // ── unknown flow ──
  await clearState(userId);
  return lineReply(rt, '❌ ยกเลิกการป้อนข้อมูล พิมพ์คำสั่งใหม่ได้เลย');
}

// ════════════════════════════════════════════════════════════
//  IMAGE HANDLER
// ════════════════════════════════════════════════════════════
async function handleImage(msgId, userId, rt) {
  const state = await getState(userId);
  const buffer = await lineGetImage(msgId);
  if (!buffer) return lineReply(rt, '❌ ดาวน์โหลดรูปไม่สำเร็จ');

  const filename = `${userId}-${Date.now()}.jpg`;
  const url = await uploadImage(buffer, filename);
  if (!url) return lineReply(rt, '❌ อัพโหลดรูปไม่สำเร็จ');

  // attach to most recent action
  const recentExp = await sbGet('bkp_expenses', `?expense_date=eq.${today()}&order=created_at.desc&limit=1`);
  if (recentExp.length) {
    await sbPatch('bkp_expenses', `?id=eq.${recentExp[0].id}`, { receipt_url: url });
    return lineReply(rt, `✅ แนบรูปใบเสร็จแล้ว\n📝 ${recentExp[0].note || '(ค่าใช้จ่าย)'}\n🖼️ อัพโหลดสำเร็จ`);
  }
  const recentSale = await sbGet('bkp_sales', `?sale_date=eq.${today()}&order=created_at.desc&limit=1`);
  if (recentSale.length) {
    await sbPatch('bkp_sales', `?id=eq.${recentSale[0].id}`, { receipt_url: url });
    return lineReply(rt, `✅ แนบรูปแล้ว\n👤 ${recentSale[0].customer}\n🖼️ อัพโหลดสำเร็จ`);
  }
  return lineReply(rt, `✅ อัพโหลดรูปแล้ว\n🖼️ ${url}\n\nหมายเหตุ: ไม่พบรายการล่าสุดวันนี้ รูปจะถูกเก็บในระบบ`);
}

// ════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ════════════════════════════════════════════════════════════
async function handleText(txt, userId, rt) {
  // ── check active multi-step flow ──
  const state = await getState(userId);
  if (state && state.step > 0) {
    if (/^(ยกเลิก|cancel|หยุด|ออก)$/i.test(txt)) { await clearState(userId); return lineReply(rt, '❌ ยกเลิกแล้ว'); }
    return handleFlow(state, txt, userId, rt);
  }

  // ── start flow ──
  const flowKey = FLOW_HELP[txt];
  if (flowKey) { await setState(userId, flowKey, 1, {}); return handleFlow({ flow: flowKey, step: 0, data: {} }, txt, userId, rt); }

  // ─── สั่ง [รายการ] [จำนวน] [หน่วย] [ราคา] ───
  const orderRx = txt.match(/^สั่ง\s+(.+?)\s+([\d.]+)\s+(\S+)\s+([\d.]+)/);
  if (orderRx) {
    const [, item, qty, unit, priceU] = orderRx;
    const total = parseFloat(qty) * parseFloat(priceU);
    await sbPost('bkp_purchase_orders', { ordered_at: today(), item, quantity: parseFloat(qty), unit, price_per_unit: parseFloat(priceU), total_price: total, status: 'pending' });
    return lineReply(rt, `✅ บันทึกใบสั่งซื้อแล้ว\n📦 ${item} ${qty} ${unit}\n💰 ฿${fmt(priceU)}/${unit}\n💵 รวม ฿${fmt(total)}\n📋 สถานะ: รอรับสินค้า`);
  }

  // ─── รับของ [รายการ] [จำนวน] ───
  const recvRx = txt.match(/^รับของ\s+(.+?)\s+([\d.]+)/);
  if (recvRx) {
    const [, item, qty] = recvRx;
    const pending = await sbGet('bkp_purchase_orders', `?status=eq.pending&item=ilike.*${encodeURIComponent(item)}*&order=ordered_at.asc&limit=1`);
    if (!pending.length) return lineReply(rt, `⚠️ ไม่พบใบสั่งซื้อ "${item}" ที่ค้างอยู่`);
    const po = pending[0];
    await sbPatch('bkp_purchase_orders', `?id=eq.${po.id}`, { status: 'received', received_at: new Date().toISOString(), received_qty: parseFloat(qty) });
    return lineReply(rt, `✅ รับสินค้าแล้ว\n📦 ${po.item} ${qty}/${po.quantity} ${po.unit || ''}\n💵 ฿${fmt(po.total_price)}`);
  }

  // ─── ขาย (detailed / simple) ───
  const saleDetailRx = txt.match(/^ขาย\s+(\S+)\s+(.+?)\s+([\d.]+)\s+(\S+)\s+([\d.]+)$/);
  const saleSimpleRx = txt.match(/^ขาย\s+(\S+)\s+([\d.]+)$/);
  if (saleDetailRx) {
    const [, customer, item, qty, unit, priceU] = saleDetailRx;
    const total = parseFloat(qty) * parseFloat(priceU);
    await sbPost('bkp_sales', { sale_date: today(), customer, item, quantity: parseFloat(qty), unit, price_per_unit: parseFloat(priceU), total, paid: false, line_user_id: userId });
    return lineReply(rt, `✅ บันทึกการขาย\n👤 ${customer}\n📦 ${item} ${qty} ${unit}\n💵 ฿${fmt(total)}\n📋 ยังไม่ชำระ`);
  }
  if (saleSimpleRx) {
    const [, customer, amount] = saleSimpleRx;
    await sbPost('bkp_sales', { sale_date: today(), customer, total: parseFloat(amount), paid: false, line_user_id: userId });
    return lineReply(rt, `✅ บันทึกการขาย\n👤 ${customer}\n💵 ฿${fmt(amount)}\n📋 ยังไม่ชำระ`);
  }

  // ─── รับ [จำนวน] หรือ รับ [ลูกค้า] [จำนวน] ───
  if (/^รับ\s/.test(txt) && !/^รับของ/.test(txt)) {
    const parts = txt.replace(/^รับ\s*/, '').trim().split(/\s+/);
    const lastNum = parseFloat(parts[parts.length - 1]);
    const amount = !isNaN(lastNum) ? lastNum : parseFloat(parts[0]);
    const customer = (!isNaN(lastNum) && parts.length > 1) ? parts.slice(0, -1).join(' ') : null;
    if (!amount || isNaN(amount)) return lineReply(rt, '❌ รูปแบบ:\nรับ 5000\nรับ [ลูกค้า] 5000');
    let q = '?paid=eq.false&order=sale_date.asc,id.asc';
    if (customer) q += `&customer=ilike.*${encodeURIComponent(customer)}*`;
    const unpaid = await sbGet('bkp_sales', q);
    if (!unpaid.length) return lineReply(rt, '✅ ไม่มียอดค้างในระบบ');
    let clearedIds = [];
    const exactIdx = exactMatch(unpaid, amount);
    if (exactIdx) clearedIds = exactIdx.map(i => unpaid[i].id);
    else clearedIds = fifoMatch(unpaid, amount);
    if (!clearedIds.length) {
      const minBill = Math.min(...unpaid.map(b => parseFloat(b.total || 0)));
      return lineReply(rt, `⚠️ ฿${fmt(amount)} น้อยกว่ายอดใบแรก (฿${fmt(minBill)})`);
    }
    await sbPatch('bkp_sales', `?id=in.(${clearedIds.join(',')})`, { paid: true, paid_at: new Date().toISOString() });
    await sbPost('bkp_payments', { customer: customer || 'ไม่ระบุ', amount, payment_date: today(), status: 'reconciled', bills_cleared: clearedIds, line_user_id: userId });
    const clearedTotal = unpaid.filter(b => clearedIds.includes(b.id)).reduce((s, b) => s + parseFloat(b.total || 0), 0);
    const still = unpaid.filter(b => !clearedIds.includes(b.id)).reduce((s, b) => s + parseFloat(b.total || 0), 0);
    let msg = `✅ รับชำระ ฿${fmt(amount)}\n━━━━━━━━━━━━━━\n📋 ตัด ${clearedIds.length} ใบ (฿${fmt(clearedTotal)})\n`;
    if (exactIdx) msg += `🎯 ตรงยอดพอดี!\n`;
    msg += still > 0 ? `⏳ ยังค้าง ฿${fmt(still)}` : `🎉 หมดยอดค้างแล้ว!`;
    return lineReply(rt, msg);
  }

  // ─── ค่า [รายการ] [จำนวน] [หมวด?] ───
  const expRx = txt.match(/^ค่า\s+(.+?)\s+([\d.]+)(?:\s+(.*))?$/);
  if (expRx) {
    const [, note, amount, category] = expRx;
    await sbPost('bkp_expenses', { expense_date: today(), amount: parseFloat(amount), note, category: category || null, line_user_id: userId });
    return lineReply(rt, `✅ บันทึกค่าใช้จ่าย\n📝 ${note}\n💸 ฿${fmt(amount)}${category ? `\n🏷️ ${category}` : ''}\n\n💡 ส่งรูปใบเสร็จได้เลย (แนบอัตโนมัติ)`);
  }

  // ─── Phase 1: สินค้า ───
  const productAddRx = txt.match(/^สินค้า\+\s*(.+)$/);
  if (productAddRx) return cmdAddProduct(productAddRx[1], rt);
  const productViewRx = txt.match(/^สินค้า\s+(.+)$/);
  if (productViewRx) return cmdListProducts(productViewRx[1], rt);
  if (/^สินค้า$/.test(txt)) return cmdListProducts(null, rt);
  const priceUpdateRx = txt.match(/^ปรับราคา\s+(.+)$/);
  if (priceUpdateRx) return cmdUpdatePrice(priceUpdateRx[1], rt);

  // ─── วัตถุดิบ ───
  const rmAddRx = txt.match(/^วัตถุดิบ\+\s*(.+)$/);
  if (rmAddRx) return cmdAddRM(rmAddRx[1], rt);
  const rmPriceRx = txt.match(/^ราคาวัตถุดิบ\s+(.+)$/);
  if (rmPriceRx) return cmdUpdateRM(rmPriceRx[1], rt);
  if (/^วัตถุดิบ$/.test(txt)) return cmdListRM(rt);

  // ─── สูตร ───
  const recipeAddRx = txt.match(/^สูตร\+\s*(.+)$/);
  if (recipeAddRx) return cmdAddRecipe(recipeAddRx[1], rt);
  const recipeViewRx = txt.match(/^สูตร\s+(.+)$/);
  if (recipeViewRx) return cmdShowRecipe(recipeViewRx[1], rt);

  // ─── หุ้น ───
  const shAddRx = txt.match(/^หุ้น\+\s*(.+)$/);
  if (shAddRx) return cmdAddShareholder(shAddRx[1], rt);
  const shUpdateRx = txt.match(/^ปรับหุ้น\s+(.+)$/);
  if (shUpdateRx) return cmdUpdateSharePct(shUpdateRx[1], rt);
  if (/^หุ้น$/.test(txt)) return cmdListShareholders(rt);

  // ─── โสหุ้ย ───
  const ohRx = txt.match(/^โสหุ้ย(.*)$/);
  if (ohRx) return cmdOverhead(ohRx[1].trim(), rt);

  // ─── ปันผล / จ่ายปันผล ───
  const divRx = txt.match(/^ปันผล\s+(.+)$/);
  if (divRx) return cmdDividend(divRx[1], rt);
  const payDivRx = txt.match(/^จ่ายปันผล\s+(.+)$/);
  if (payDivRx) return cmdPayDividend(payDivRx[1], rt);

  // ─── Phase 2: ลบ / แก้ ───
  const delRx = txt.match(/^ลบ(ค่า|ขาย|สั่ง)\s+(\S+)$/);
  if (delRx) return cmdDelete(delRx[1], delRx[2], rt);
  const editRx = txt.match(/^แก้(ขาย|ค่า)\s+(\S+)\s+([\d.]+)$/);
  if (editRx) return cmdEdit(editRx[1], editRx[2], editRx[3], rt);

  // ─── Reports ───
  if (/^ยอดวันนี้$/.test(txt)) return lineReply(rt, await dailyReport(today()));
  if (/^ยอดเดือน$/.test(txt)) return lineReply(rt, await monthReport());
  const reportRx = txt.match(/^รายงาน\s+(\d{4}-\d{2}-\d{2})$/);
  if (reportRx) return lineReply(rt, await dailyReport(reportRx[1]));
  const custRx = txt.match(/^ลูกค้า\s+(.+)$/);
  if (custRx) return lineReply(rt, await customerReport(custRx[1]));

  if (/^(ยอดค้าง|ค้าง|outstanding)$/i.test(txt)) {
    const unpaid = await sbGet('bkp_sales', '?paid=eq.false&order=sale_date.asc&limit=20');
    if (!unpaid.length) return lineReply(rt, '✅ ไม่มียอดค้าง 🎉');
    const total = unpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
    let msg = `📋 ยอดค้าง ${unpaid.length} รายการ\n💰 รวม ฿${fmt(total)}\n━━━━━━━━━━━━━━\n`;
    msg += unpaid.map(b => `• ${b.customer || 'ไม่ระบุ'}  ฿${fmt(b.total)}  (${b.sale_date || '-'})`).join('\n');
    return lineReply(rt, msg);
  }

  if (/^(ใบสั่ง|คำสั่งซื้อ|po|สั่งซื้อ)$/i.test(txt)) {
    const orders = await sbGet('bkp_purchase_orders', '?status=eq.pending&order=ordered_at.desc&limit=10');
    if (!orders.length) return lineReply(rt, '📦 ไม่มีใบสั่งซื้อค้างอยู่');
    const total = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    let msg = `📦 ใบสั่งซื้อรอรับ ${orders.length} รายการ\n💰 รวม ฿${fmt(total)}\n━━━━━━━━━━━━━━\n`;
    msg += orders.map(o => `• ${o.item} ${o.quantity} ${o.unit || ''} = ฿${fmt(o.total_price)}`).join('\n');
    return lineReply(rt, msg);
  }

  // ─── ลิงก์เว็บ ───
  if (/^(ลิงค์|ลิงก์|link|เว็บ|web|app|แอพ|แอป|dashboard)$/i.test(txt)) {
    return lineReply(rt, `🌐 BKP Kitchen Dashboard\n━━━━━━━━━━━━━━\n🔗 ${WEB_URL}\n\nเปิดในมือถือเพื่อดูรายงาน ยอดขาย และกราฟ`);
  }

  // ─── Help (unknown → show all) ───
  return lineReply(rt,
    (txt !== 'help' && txt !== 'คำสั่ง' ? `❓ ไม่เข้าใจ "${txt}"\n` : '') +
    `📱 BKP Kitchen — คำสั่งทั้งหมด\n━━━━━━━━━━━━━━\n` +
    `📦 งานประจำ:\n• สั่ง [ของ] [qty] [หน่วย] [ราคา]\n• รับของ [ของ] [qty]\n• ขาย [ลูกค้า] [ยอด]\n• รับ [ยอด] หรือ รับ [ลูกค้า] [ยอด]\n• ค่า [รายการ] [ยอด] [หมวด]\n\n` +
    `🍱 สินค้า/วัตถุดิบ:\n• สินค้า+ [ชื่อ] [ต้นทุน] [ราคา]\n• สินค้า | สินค้า [ชื่อ]\n• ปรับราคา [ชื่อ] [ราคาใหม่]\n• วัตถุดิบ+ [ชื่อ] [ราคา]\n• วัตถุดิบ | ราคาวัตถุดิบ [ชื่อ] [ราคา]\n• สูตร+ [สินค้า] [วัตถุดิบ] [qty]\n• สูตร [สินค้า]\n\n` +
    `👥 หุ้น/การเงิน:\n• หุ้น+ [ชื่อ] [%] [เงิน] | หุ้น\n• ปรับหุ้น [ชื่อ] [%ใหม่]\n• โสหุ้ย | โสหุ้ย [หมวด] [%]\n• ปันผล [ปี] [กำไร] [ปันผล]\n• จ่ายปันผล [ชื่อ]\n\n` +
    `📊 รายงาน:\n• ยอดวันนี้ | ยอดเดือน | รายงาน YYYY-MM-DD\n• ยอดค้าง | ใบสั่ง | ลูกค้า [ชื่อ]\n\n` +
    `✏️ แก้ไข:\n• ลบค่า/ลบขาย [id]\n• แก้ขาย/แก้ค่า [id] [ยอดใหม่]\n\n` +
    `🌐 เว็บ | 📸 ส่งรูปแนบใบเสร็จได้เลย\n` +
    `💬 เพิ่มสินค้า | เพิ่มวัตถุดิบ | เพิ่มหุ้น (guided)`
  );
}

// ════════════════════════════════════════════════════════════
//  EXPORT HANDLER
// ════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'BKP Kitchen LINE Webhook v2' });
  if (req.method !== 'POST') return res.status(405).end();

  const { events } = req.body || {};
  if (!events?.length) return res.status(200).json({ ok: true });

  for (const ev of events) {
    const userId = ev.source?.userId;
    const rt = ev.replyToken;

    try {
      if (userId) await trackUser(userId, null);

      if (ev.type === 'message') {
        if (ev.message?.type === 'text') {
          await handleText(ev.message.text.trim(), userId, rt);
        } else if (ev.message?.type === 'image') {
          await handleImage(ev.message.id, userId, rt);
        }
      }
    } catch (e) {
      console.error('Webhook error:', JSON.stringify({ err: e.message, ev: ev.type }));
      try { await lineReply(rt, `❌ เกิดข้อผิดพลาด: ${e.message.slice(0, 100)}`); } catch {}
    }
  }

  return res.status(200).json({ ok: true });
}
