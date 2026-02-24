module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { book_id, book_title, type, text, contact, page } = body;

    const violationTypes = {
      obscene: 'Нецензурная лексика',
      violence: 'Насилие и жестокость',
      adult: 'Порнографический контент',
      hate: 'Разжигание ненависти',
      copyright: 'Нарушение авторских прав',
      other: 'Другое'
    };

    // Save report to Supabase
    await fetch(`${supabaseUrl}/rest/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ book_id, violation_type: type, description: text, reporter_email: contact || null, page: page || null, status: 'pending' })
    });

    // Notify admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Тихая гавань <noreply@greenandsnowstudio.com>',
        to: 'support@greenandsnowstudio.com',
        subject: `✉️ Письмо о нарушении — «${book_title}»`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:2rem">
            <h2 style="color:#3a3530">Письмо о нарушении</h2>
            <table style="width:100%;border-collapse:collapse;margin:1rem 0">
              <tr><td style="padding:.5rem;color:#6b6560;width:140px">Книга</td><td style="padding:.5rem;font-weight:600">«${book_title}»</td></tr>
              <tr style="background:#f5f0e8"><td style="padding:.5rem;color:#6b6560">Тип нарушения</td><td style="padding:.5rem">${violationTypes[type] || type}</td></tr>
              <tr><td style="padding:.5rem;color:#6b6560">Страница</td><td style="padding:.5rem">${page || 'не указана'}</td></tr>
              <tr style="background:#f5f0e8"><td style="padding:.5rem;color:#6b6560">Описание</td><td style="padding:.5rem">${text || 'не указано'}</td></tr>
              <tr><td style="padding:.5rem;color:#6b6560">Контакт</td><td style="padding:.5rem">${contact || 'анонимно'}</td></tr>
            </table>
            <p style="font-size:.85rem;color:#8a8278">ID книги: ${book_id}</p>
          </div>
        `
      })
    });

    return res.status(200).json({ ok: true });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
