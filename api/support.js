module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { name, email, subject, message } = body;

    // Валидация
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    const subjectLabels = {
      general: 'Общий вопрос',
      bug: 'Ошибка на сайте',
      idea: 'Предложение / идея',
      books: 'Вопрос по книгам',
      other: 'Другое'
    };

    // 1. Сохраняем в Supabase
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/support_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        name,
        email,
        subject: subject || 'general',
        message,
        status: 'new'
      })
    });

    if (!dbRes.ok) {
      const err = await dbRes.text();
      console.error('Supabase error:', err);
    }

    // 2. Отправляем email уведомление
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Тихая гавань <noreply@greenandsnowstudio.com>',
        to: 'support@greenandsnowstudio.com',
        subject: `💬 Новое обращение — ${subjectLabels[subject] || subject}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem">
            <h2 style="color:#3a3530;margin-bottom:1.5rem">Новое обращение с сайта</h2>
            <table style="width:100%;border-collapse:collapse;margin:1rem 0">
              <tr>
                <td style="padding:.6rem;color:#6b6560;width:130px;vertical-align:top">Имя</td>
                <td style="padding:.6rem;font-weight:600">${name}</td>
              </tr>
              <tr style="background:#f5f0e8">
                <td style="padding:.6rem;color:#6b6560;vertical-align:top">Email</td>
                <td style="padding:.6rem"><a href="mailto:${email}" style="color:#4a7c8e">${email}</a></td>
              </tr>
              <tr>
                <td style="padding:.6rem;color:#6b6560;vertical-align:top">Тема</td>
                <td style="padding:.6rem">${subjectLabels[subject] || subject}</td>
              </tr>
              <tr style="background:#f5f0e8">
                <td style="padding:.6rem;color:#6b6560;vertical-align:top">Сообщение</td>
                <td style="padding:.6rem;line-height:1.6">${message.replace(/\n/g, '<br>')}</td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e8e0d0;margin:1.5rem 0">
            <p style="font-size:.8rem;color:#8a8278">Ответить: <a href="mailto:${email}" style="color:#4a7c8e">${email}</a></p>
          </div>
        `
      })
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Support API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
