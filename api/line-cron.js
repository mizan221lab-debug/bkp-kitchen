// ════════════════════════════════════════════════════════════════
//  BKP Kitchen — Daily Cron (runs at 20:00 Bangkok time)
//  Sends daily summary to all LINE users with notify_daily=true
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://suatxkfygvlrlsscvmoo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1YXR4a2Z5Z3Zscmxzc2N2bW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzM5MjIsImV4cCI6MjA4OTc0OTkyMn0.5yBBvcYRGbrcnAftTuT08_Os3ouwSmnPiixCuOxRODA';
const LINE_TOKEN   = 'qs64c7efuccICIPZGwLmq2Xh1eipJuFry4hXBsacnbS/jNp+40bbSgiyF01t9qCsEFYkJm6qsd677rbh+xetUrEFsYS79OPoy5EasGTFAmwiG4TaP8KGEJ/oamnup7gyvll4xjMW65u8ap+rASDMPQdB04t89/1O/w1cDnyilFU=';

const SB_HDR = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const fmt    = n => parseFloat(n || 0).toLocaleString('th-TH');

function today() {
  return new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' })).toISOString().split('T')[0];
}

async function sbGet(table, q = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${q}`, { headers: SB_HDR });
  return r.json();
}

async function linePush(userId, text) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
}

async function buildDailyReport(date) {
  const [sales, payments, expenses, unpaidAll] = await Promise.all([
    sbGet('bkp_sales', `?sale_date=eq.${date}`),
    sbGet('bkp_payments', `?payment_date=eq.${date}`),
    sbGet('bkp_expenses', `?expense_date=eq.${date}`),
    sbGet('bkp_sales', '?paid=eq.false'),
  ]);
  const salesTotal   = sales.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const paidTotal    = payments.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const expTotal     = expenses.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const unpaidTotal  = unpaidAll.reduce((s, b) => s + parseFloat(b.total || 0), 0);
  const profit       = paidTotal - expTotal;

  return (
    `🍳 BKP Kitchen — สรุปวันที่ ${date}\n━━━━━━━━━━━━━━\n` +
    `💰 ขายวันนี้: ฿${fmt(salesTotal)} (${sales.length} ใบ)\n` +
    `💵 รับเงิน: ฿${fmt(paidTotal)}\n` +
    `💸 ค่าใช้จ่าย: ฿${fmt(expTotal)}\n` +
    `━━━━━━━━━━━━━━\n` +
    `📈 กำไรสุทธิ์: ฿${fmt(profit)}\n` +
    `⏳ ยอดค้างทั้งหมด: ฿${fmt(unpaidTotal)} (${unpaidAll.length} ใบ)`
  );
}

async function cleanupExpiredState() {
  await fetch(`${SUPABASE_URL}/rest/v1/line_state?expires_at=lt.${new Date().toISOString()}`, {
    method: 'DELETE', headers: SB_HDR,
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'BKP Kitchen Cron' });

  const date = today();
  const report = await buildDailyReport(date);
  const users = await sbGet('line_users', '?notify_daily=eq.true');

  let sent = 0;
  for (const u of users) {
    try { await linePush(u.user_id, report); sent++; } catch {}
  }

  await cleanupExpiredState();

  console.log(`Daily cron: sent to ${sent}/${users.length} users, date=${date}`);
  return res.status(200).json({ ok: true, date, sent, total: users.length });
}
