module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'Ты — дружелюбный помощник на сайте "Тихая гавань" — платформе досуга для пожилых людей. Отвечай по-русски, тепло и понятно. Избегай сложных терминов. Если нужны технические объяснения — давай их простыми словами с примерами. Будь кратким, но содержательным. Не используй markdown-разметку — только обычный текст.',
        messages: messages
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
