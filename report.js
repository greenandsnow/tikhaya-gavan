module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { book_id, type, text, email } = body;

    // Save report to Supabase
    await fetch(`${supabaseUrl}/rest/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ book_id, violation_type: type, description: text, reporter_email: email || null, status: 'pending' })
    });

    // Notify admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Тихая гавань <noreply@greenandsnowstudio.com>',
        to: 'support@greenandsnowstudio.com',
        subject: '⚠️ Новая жалоба на книгу',
        html: `<p>Поступила жалоба на книгу ID: <strong>${book_id}</strong></p><p>Тип нарушения: <strong>${type}</strong></p><p>Описание: ${text || 'не указано'}</p><p>Email жалующегося: ${email || 'не указан'}</p>`
      })
    });

    return res.status(200).json({ ok: true });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
