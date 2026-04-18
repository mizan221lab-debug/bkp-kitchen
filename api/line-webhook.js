const SUPABASE_URL = 'https://suatxkfygvlrlsscvmoo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1YXR4a2Z5Z3Zscmxzc2N2bW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzM5MjIsImV4cCI6MjA4OTc0OTkyMn0.5yBBvcYRGbrcnAftTuT08_Os3ouwSmnPiixCuOxRODA';
const LINE_TOKEN = 'qs64c7efuccICIPZGwLmq2Xh1eipJuFry4hXBsacnbS/jNp+40bbSgiyF01t9qCsEFYkJm6qsd677rbh+xetUrEFsYS79OPoy5EasGTFAmwiG4TaP8KGEJ/oamnup7gyvll4xjMW65u8ap+rASDMPQdB04t89/1O/w1cDnyilFU=';

const SB_HDR = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function sbGet(table, q = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, { headers: SB_HDR });
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SB_HDR, 'Prefer': 'return=representation' }, body: JSON.stringify(body)
  });
  return r.json();
}
async function sbPatch(table, q, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: 'PATCH', headers: SB_HDR, body: JSON.stringify(body)
  });
}

async function lineReply(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  });
}

// ── Utility ──
function fmt(n) { return parseFloat(n || 0).toLocaleString('th-TH'); }
function today() { return new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' })).toISOString().split('T')[0]; }
function thisMonthStart() { const d = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' })); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }

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
    if (rem >= t) { cleared.push(b.id); rem -= t; } else break;
  }
  return cleared;
}

// ── Report builders ──
async function dailyReport(date) {
  const [sales, payments, expenses] = await Promise.all([
    sbGet('bkp_sales', `?sale_date=eq.${date}`),
    sbGet('bkp_payments', `?payment_date=eq.${date}`),
    sbGet('bkp_expenses', `?expense_date=eq.${date}`),
  ]);
  const salesTotal = sales.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal = payments.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const expTotal = expenses.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  return `📊 ยอดวันที่ ${date}\n━━━━━━━━━━━━━━\n💰 ขาย ${sales.length} รายการ: ฿${fmt(salesTotal)}\n💵 รับเงิน ${payments.length} ครั้ง: ฿${fmt(paidTotal)}\n💸 ค่าใช้จ่าย ${expenses.length}: ฿${fmt(expTotal)}\n━━━━━━━━━━━━━━\n📈 สุทธิ: ฿${fmt(paidTotal - expTotal)}`;
}

async function monthReport() {
  const start = thisMonthStart();
  const end = today();
  const [sales, payments, expenses] = await Promise.all([
    sbGet('bkp_sales', `?sale_date=gte.${start}&sale_date=lte.${end}`),
    sbGet('bkp_payments', `?payment_date=gte.${start}&payment_date=lte.${end}`),
    sbGet('bkp_expenses', `?expense_date=gte.${start}&expense_date=lte.${end}`),
  ]);
  const salesTotal = sales.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal = payments.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const expTotal = expenses.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const outstanding = salesTotal - paidTotal;
  return `📊 สรุปเดือน (${start} → ${end})\n━━━━━━━━━━━━━━\n💰 ยอดขายรวม: ฿${fmt(salesTotal)}\n💵 รับเงินแล้ว: ฿${fmt(paidTotal)}\n⏳ ค้างชำระ: ฿${fmt(outstanding)}\n💸 ค่าใช้จ่าย: ฿${fmt(expTotal)}\n━━━━━━━━━━━━━━\n📈 กำไรสุทธิ: ฿${fmt(paidTotal - expTotal)}\n📦 ใบขาย ${sales.length} ใบ`;
}

async function customerReport(name) {
  const [unpaid, paid] = await Promise.all([
    sbGet('bkp_sales', `?paid=eq.false&customer=ilike.*${encodeURIComponent(name)}*&order=sale_date.asc`),
    sbGet('bkp_sales', `?paid=eq.true&customer=ilike.*${encodeURIComponent(name)}*&order=sale_date.desc&limit=5`),
  ]);
  const unpaidTotal = unpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal = paid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  let msg = `👤 ลูกค้า: ${name}\n━━━━━━━━━━━━━━\n⏳ ค้าง ${unpaid.length} ใบ: ฿${fmt(unpaidTotal)}\n✅ ชำระแล้ว ${paid.length}+ ใบ: ฿${fmt(paidTotal)}\n`;
  if (unpaid.length) {
    msg += `\n📋 รายการค้าง:\n` + unpaid.slice(0, 10).map(b => `• ${b.sale_date}: ฿${fmt(b.total)}`).join('\n');
  }
  return msg;
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'BKP Kitchen LINE Webhook' });
  if (req.method !== 'POST') return res.status(405).end();

  const { events } = req.body || {};
  if (!events?.length) return res.status(200).end();

  for (const ev of events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
    const txt = ev.message.text.trim();
    const rt = ev.replyToken;

    // ─── สั่ง [รายการ] [จำนวน] [หน่วย] [ราคา] ───
    const orderRx = txt.match(/^สั่ง\s+(.+?)\s+([\d.]+)\s+(\S+)\s+([\d.]+)/);
    if (orderRx) {
      const [, item, qty, unit, priceU] = orderRx;
      const total = parseFloat(qty) * parseFloat(priceU);
      await sbPost('bkp_purchase_orders', {
        ordered_at: today(), item, quantity: parseFloat(qty),
        unit, price_per_unit: parseFloat(priceU), total_price: total, status: 'pending'
      });
      await lineReply(rt, `✅ บันทึกใบสั่งซื้อแล้ว\n📦 ${item} ${qty} ${unit}\n💰 ฿${fmt(priceU)}/${unit}\n💵 รวม ฿${fmt(total)}\n📋 สถานะ: รอรับสินค้า`);
      continue;
    }

    // ─── รับของ [รายการ] [จำนวน] ───
    const recvRx = txt.match(/^รับของ\s+(.+?)\s+([\d.]+)/);
    if (recvRx) {
      const [, item, qty] = recvRx;
      const pending = await sbGet('bkp_purchase_orders', `?status=eq.pending&item=ilike.*${encodeURIComponent(item)}*&order=ordered_at.asc&limit=1`);
      if (!pending.length) {
        await lineReply(rt, `⚠️ ไม่พบใบสั่งซื้อ "${item}" ที่ค้างอยู่`);
        continue;
      }
      const po = pending[0];
      await sbPatch('bkp_purchase_orders', `?id=eq.${po.id}`, { status: 'received', received_at: new Date().toISOString(), received_qty: parseFloat(qty) });
      await lineReply(rt, `✅ รับสินค้าแล้ว\n📦 ${po.item} ${qty}/${po.quantity} ${po.unit}\n💵 ฿${fmt(po.total_price)}`);
      continue;
    }

    // ─── ขาย [ลูกค้า] [จำนวนเงิน] หรือ ขาย [ลูกค้า] [รายการ] [จำนวน] [ราคา] ───
    const saleDetailRx = txt.match(/^ขาย\s+(\S+)\s+(.+?)\s+([\d.]+)\s+(\S+)\s+([\d.]+)$/);
    const saleSimpleRx = txt.match(/^ขาย\s+(\S+)\s+([\d.]+)$/);
    if (saleDetailRx) {
      const [, customer, item, qty, unit, priceU] = saleDetailRx;
      const total = parseFloat(qty) * parseFloat(priceU);
      await sbPost('bkp_sales', {
        sale_date: today(), customer, item, quantity: parseFloat(qty), unit,
        price_per_unit: parseFloat(priceU), total, paid: false
      });
      await lineReply(rt, `✅ บันทึกการขาย\n👤 ${customer}\n📦 ${item} ${qty} ${unit}\n💵 ฿${fmt(total)}\n📋 ยังไม่ชำระ`);
      continue;
    }
    if (saleSimpleRx) {
      const [, customer, amount] = saleSimpleRx;
      await sbPost('bkp_sales', { sale_date: today(), customer, total: parseFloat(amount), paid: false });
      await lineReply(rt, `✅ บันทึกการขาย\n👤 ${customer}\n💵 ฿${fmt(amount)}\n📋 ยังไม่ชำระ`);
      continue;
    }

    // ─── รับ [จำนวน] หรือ รับ [ลูกค้า] [จำนวน] ───
    if (/^รับ\s/.test(txt) && !/^รับของ/.test(txt)) {
      const parts = txt.replace(/^รับ\s*/, '').trim().split(/\s+/);
      const lastNum = parseFloat(parts[parts.length - 1]);
      const amount = isNaN(lastNum) ? parseFloat(parts[0]) : lastNum;
      const customer = (!isNaN(lastNum) && parts.length > 1) ? parts.slice(0, -1).join(' ') : null;

      if (!amount || isNaN(amount)) {
        await lineReply(rt, '❌ รูปแบบ:\nรับ 5000\nรับ [ลูกค้า] 5000');
        continue;
      }

      let q = '?paid=eq.false&order=sale_date.asc,id.asc';
      if (customer) q += `&customer=ilike.*${encodeURIComponent(customer)}*`;
      const unpaid = await sbGet('bkp_sales', q);

      if (!unpaid.length) { await lineReply(rt, '✅ ไม่มียอดค้างในระบบ'); continue; }

      let clearedIds = [];
      const exactIdx = exactMatch(unpaid, amount);
      if (exactIdx) clearedIds = exactIdx.map(i => unpaid[i].id);
      else clearedIds = fifoMatch(unpaid, amount);

      if (!clearedIds.length) {
        const minBill = Math.min(...unpaid.map(b => parseFloat(b.total || 0)));
        await lineReply(rt, `⚠️ ฿${fmt(amount)} น้อยกว่ายอดใบแรก (฿${fmt(minBill)})\nลองระบุลูกค้าหรือตรวจยอดก่อน`);
        continue;
      }

      const now = new Date().toISOString();
      await sbPatch('bkp_sales', `?id=in.(${clearedIds.join(',')})`, { paid: true, paid_at: now });
      await sbPost('bkp_payments', {
        customer: customer || 'ไม่ระบุ', amount, payment_date: today(),
        status: 'reconciled', bills_cleared: clearedIds
      });

      const clearedTotal = unpaid.filter(b => clearedIds.includes(b.id)).reduce((s, b) => s + parseFloat(b.total || 0), 0);
      const stillUnpaid = unpaid.filter(b => !clearedIds.includes(b.id));
      const stillTotal = stillUnpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);

      let msg = `✅ รับชำระ ฿${fmt(amount)}\n━━━━━━━━━━━━━━\n📋 ตัด ${clearedIds.length} ใบ (฿${fmt(clearedTotal)})\n`;
      if (exactIdx) msg += `🎯 ตรงยอดพอดี!\n`;
      if (stillUnpaid.length > 0) msg += `⏳ ยังค้าง ${stillUnpaid.length} ใบ (฿${fmt(stillTotal)})`;
      else msg += `🎉 หมดยอดค้างแล้ว!`;
      await lineReply(rt, msg);
      continue;
    }

    // ─── ค่า [รายการ] [จำนวน] [หมวด?] ───
    const expRx = txt.match(/^ค่า\s+(.+?)\s+([\d.]+)(?:\s+(.+))?$/);
    if (expRx) {
      const [, note, amount, category] = expRx;
      await sbPost('bkp_expenses', {
        expense_date: today(), amount: parseFloat(amount), note, category: category || null
      });
      await lineReply(rt, `✅ บันทึกค่าใช้จ่าย\n📝 ${note}\n💸 ฿${fmt(amount)}${category ? `\n🏷️ ${category}` : ''}`);
      continue;
    }

    // ─── ยอดวันนี้ / ยอดเดือน / รายงาน [date] ───
    if (/^ยอดวันนี้$/.test(txt)) { await lineReply(rt, await dailyReport(today())); continue; }
    if (/^ยอดเดือน$/.test(txt)) { await lineReply(rt, await monthReport()); continue; }
    const reportRx = txt.match(/^รายงาน\s+(\d{4}-\d{2}-\d{2})$/);
    if (reportRx) { await lineReply(rt, await dailyReport(reportRx[1])); continue; }

    // ─── ลูกค้า [ชื่อ] ───
    const custRx = txt.match(/^ลูกค้า\s+(.+)$/);
    if (custRx) { await lineReply(rt, await customerReport(custRx[1])); continue; }

    // ─── ยอดค้าง ───
    if (/^(ยอดค้าง|ค้าง|outstanding)$/i.test(txt)) {
      const unpaid = await sbGet('bkp_sales', '?paid=eq.false&order=sale_date.asc&limit=15');
      if (!unpaid.length) { await lineReply(rt, '✅ ไม่มียอดค้าง 🎉'); }
      else {
        const total = unpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
        let msg = `📋 ยอดค้าง ${unpaid.length} รายการ\n💰 รวม ฿${fmt(total)}\n━━━━━━━━━━━━━━\n`;
        msg += unpaid.map(b => `• ${b.customer || 'ไม่ระบุ'}  ฿${fmt(b.total)}  (${b.sale_date || '-'})`).join('\n');
        await lineReply(rt, msg);
      }
      continue;
    }

    // ─── ใบสั่งซื้อ ───
    if (/^(ใบสั่ง|คำสั่งซื้อ|po|สั่งซื้อ)$/i.test(txt)) {
      const orders = await sbGet('bkp_purchase_orders', "?status=eq.pending&order=ordered_at.desc&limit=10");
      if (!orders.length) { await lineReply(rt, '📦 ไม่มีใบสั่งซื้อค้างอยู่'); }
      else {
        const total = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
        let msg = `📦 ใบสั่งซื้อรอรับ ${orders.length} รายการ\n💰 รวม ฿${fmt(total)}\n━━━━━━━━━━━━━━\n`;
        msg += orders.map(o => `• ${o.item} ${o.quantity} ${o.unit || ''} = ฿${fmt(o.total_price)}`).join('\n');
        await lineReply(rt, msg);
      }
      continue;
    }

    // ─── Help ───
    await lineReply(rt,
      `📱 BKP Kitchen Bot\n━━━━━━━━━━━━━━\n` +
      `📦 บันทึก:\n` +
      `• สั่ง [ของ] [qty] [หน่วย] [ราคา]\n• รับของ [ของ] [qty]\n• ขาย [ลูกค้า] [ยอด]\n• ขาย [ลูกค้า] [ของ] [qty] [หน่วย] [ราคา]\n• รับ [ยอด]  หรือ  รับ [ลูกค้า] [ยอด]\n• ค่า [รายการ] [ยอด] [หมวด]\n\n` +
      `📊 รายงาน:\n` +
      `• ยอดวันนี้ | ยอดเดือน | รายงาน YYYY-MM-DD\n• ยอดค้าง | ใบสั่ง | ลูกค้า [ชื่อ]`
    );
  }

  res.status(200).end();
}
