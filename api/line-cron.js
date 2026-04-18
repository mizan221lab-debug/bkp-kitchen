// Called by Vercel Cron: POST /api/line-cron?job=daily|weekly|monthly
const SUPABASE_URL = 'https://suatxkfygvlrlsscvmoo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1YXR4a2Z5Z3Zscmxzc2N2bW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzM5MjIsImV4cCI6MjA4OTc0OTkyMn0.5yBBvcYRGbrcnAftTuT08_Os3ouwSmnPiixCuOxRODA';
const LINE_TOKEN = 'qs64c7efuccICIPZGwLmq2Xh1eipJuFry4hXBsacnbS/jNp+40bbSgiyF01t9qCsEFYkJm6qsd677rbh+xetUrEFsYS79OPoy5EasGTFAmwiG4TaP8KGEJ/oamnup7gyvll4xjMW65u8ap+rASDMPQdB04t89/1O/w1cDnyilFU=';
const USER_ID = 'U04074f63f0c9d1bd0ce20f67c59e23fe';

const SB_HDR = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const sbGet = async (t, q = '') => (await fetch(`${SUPABASE_URL}/rest/v1/${t}${q}`, { headers: SB_HDR })).json();
const fmt = n => parseFloat(n || 0).toLocaleString('th-TH');
const today = () => new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Bangkok' })).toISOString().split('T')[0];

async function push(text) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: USER_ID, messages: [{ type: 'text', text }] })
  });
}

export default async function handler(req, res) {
  const job = (req.query?.job || 'daily').toLowerCase();
  const d = today();
  if (job === 'daily') {
    const [s, p, e] = await Promise.all([
      sbGet('bkp_sales', `?sale_date=eq.${d}`),
      sbGet('bkp_payments', `?payment_date=eq.${d}`),
      sbGet('bkp_expenses', `?expense_date=eq.${d}`),
    ]);
    const st = s.reduce((a, x) => a + parseFloat(x.total || 0), 0);
    const pt = p.reduce((a, x) => a + parseFloat(x.amount || 0), 0);
    const et = e.reduce((a, x) => a + parseFloat(x.amount || 0), 0);
    await push(`🌙 สรุปปิดวัน ${d}\n━━━━━━━━━━━━━━\n💰 ขาย ${s.length} ใบ: ฿${fmt(st)}\n💵 รับ: ฿${fmt(pt)}\n💸 จ่าย: ฿${fmt(et)}\n📈 สุทธิ: ฿${fmt(pt - et)}`);
  } else if (job === 'weekly') {
    const unpaid = await sbGet('bkp_sales', '?paid=eq.false&order=sale_date.asc');
    const top = unpaid.reduce((map, b) => { map[b.customer || 'ไม่ระบุ'] = (map[b.customer || 'ไม่ระบุ'] || 0) + parseFloat(b.total || 0); return map; }, {});
    const sorted = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = unpaid.reduce((s, b) => s + parseFloat(b.total || 0), 0);
    await push(`📅 Top 5 ลูกค้าค้างชำระ\n━━━━━━━━━━━━━━\n` + sorted.map((x, i) => `${i + 1}. ${x[0]}: ฿${fmt(x[1])}`).join('\n') + `\n━━━━━━━━━━━━━━\nรวมค้าง: ฿${fmt(total)}`);
  }
  res.status(200).json({ ok: true, job });
}
