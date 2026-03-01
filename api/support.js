var fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var resendKey = process.env.RESEND_API_KEY;

  try {
    var body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    var name = body.name;
    var email = body.email;
    var topic = body.topic;
    var message = body.message;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    var topicLabels = {
      question: 'Общий вопрос',
      bug: 'Ошибка на сайте',
      book: 'Публикация / удаление книги',
      idea: 'Идея или пожелание',
      other: 'Другое'
    };
    var topicText = topicLabels[topic] || topic;

    var safeMessage = message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g, '<br/>');
    var safeName = name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    var response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + resendKey
      },
      body: JSON.stringify({
        from: 'Тихая гавань <noreply@greenandsnowstudio.com>',
        to: 'support@greenandsnowstudio.com',
        reply_to: email,
        subject: 'Поддержка: ' + topicText + ' — от ' + name,
        html: '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:2rem"><h2 style="color:#3a3530;margin-bottom:1rem">Новое обращение в поддержку</h2><table style="width:100%;border-collapse:collapse;margin:1rem 0"><tr><td style="padding:.5rem;color:#6b6560;width:120px">Имя</td><td style="padding:.5rem;font-weight:600">' + safeName + '</td></tr><tr style="background:#f5f0e8"><td style="padding:.5rem;color:#6b6560">Email</td><td style="padding:.5rem"><a href="mailto:' + email + '" style="color:#4a7c8e">' + email + '</a></td></tr><tr><td style="padding:.5rem;color:#6b6560">Тема</td><td style="padding:.5rem">' + topicText + '</td></tr><tr style="background:#f5f0e8"><td style="padding:.5rem;color:#6b6560;vertical-align:top">Сообщение</td><td style="padding:.5rem;line-height:1.6">' + safeMessage + '</td></tr></table><p style="font-size:.8rem;color:#8a8278;margin-top:1.5rem">Ответить можно прямо на это письмо</p></div>'
      })
    });

    if (!response.ok) {
      var errBody = await response.text();
      return res.status(500).json({ error: 'Resend error: ' + errBody });
    }

    return res.status(200).json({ ok: true });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
