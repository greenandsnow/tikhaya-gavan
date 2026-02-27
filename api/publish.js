module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    // Parse body - handle both JSON and FormData (without file)
    let fields = {};
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      fields = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } else {
      // FormData - Vercel parses fields automatically into req.body for non-file fields
      fields = req.body || {};
      // Flatten arrays from FormData parsing
      Object.keys(fields).forEach(k => {
        if (Array.isArray(fields[k])) fields[k] = fields[k][0];
      });
    }

    const { title, author_name, author_email, annotation, genre, type, ai_summary, cover_base64, cover_name, file_base64, file_name } = fields;

    if (!title || !author_name || !author_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Try to find existing author first
    let author;
    const findRes = await fetch(`${supabaseUrl}/rest/v1/authors?email=eq.${encodeURIComponent(author_email)}&select=id,name,email`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const existing = await findRes.json();
    if (existing && existing.length > 0) {
      author = existing[0];
    } else {
      const authorRes = await fetch(`${supabaseUrl}/rest/v1/authors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ name: author_name, email: author_email })
      });
      const authors = await authorRes.json();
      author = Array.isArray(authors) ? authors[0] : authors;
    }
    if (!author || !author.id) throw new Error('Failed to create author: ' + JSON.stringify(author));

    // Upload PDF if provided
    let filePath = null;
    if (file_base64 && file_name) {
      const matches = file_base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches) {
        const buffer = Buffer.from(matches[2], 'base64');
        filePath = `books/${author.id}/${Date.now()}.pdf`;
        await fetch(`${supabaseUrl}/storage/v1/object/books/${filePath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: buffer
        });
      }
    }

    // Upload cover if provided
    let coverPath = null;
    if (cover_base64 && cover_name) {
      const matches = cover_base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const ext = cover_name.split('.').pop();
        coverPath = `covers/${author.id}/${Date.now()}.${ext}`;
        await fetch(`${supabaseUrl}/storage/v1/object/books/${coverPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': mimeType,
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: buffer
        });
      }
    }

    // Insert book
    const bookRes = await fetch(`${supabaseUrl}/rest/v1/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        author_id: author.id,
        title,
        genre,
        type,
        description: annotation,
        ai_summary,
        ai_approved: true,
        status: 'approved',
        cover_path: coverPath,
        file_path: filePath,
        published_at: new Date().toISOString()
      })
    });
    const books = await bookRes.json();
    const book = Array.isArray(books) ? books[0] : books;
    if (!book || !book.id) throw new Error('Failed to create book: ' + JSON.stringify(books));

    const bookUrl = `https://www.greenandsnowstudio.com/book/${book.id}`;
    const publishedAt = new Date().toLocaleString('ru-RU', { timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short' });

    // Send confirmation email
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Тихая гавань <noreply@greenandsnowstudio.com>',
        to: author_email,
        subject: `«${title}» — подтверждение публикации`,
        html: `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/></head><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem"><div style="max-width:600px;margin:0 auto;background:#fdfcfa;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)"><div style="background:linear-gradient(135deg,#6b3010,#8b4e2a);padding:2.5rem 2rem;text-align:center"><div style="font-family:Georgia,serif;font-size:1.6rem;font-weight:700;color:white">Тихая гавань</div><div style="font-size:.75rem;color:rgba(255,255,255,0.7);letter-spacing:.15em;text-transform:uppercase;margin-top:.3rem">Издательство</div></div><div style="padding:2rem 2.5rem"><p style="font-size:1rem;color:#3a3530;margin-bottom:1.5rem">Уважаемый(ая) <strong>${author_name}</strong>,</p><p style="color:#6b6560;line-height:1.7;margin-bottom:1.5rem">Ваше произведение успешно прошло модерацию и опубликовано в библиотеке «Тихой гавани».</p><div style="background:#f5f0e8;border-left:3px solid #8b4e2a;border-radius:4px;padding:1.25rem 1.5rem;margin-bottom:1.75rem"><div style="font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#8a8278;margin-bottom:.5rem">Данные публикации</div><div style="color:#3a3530;line-height:1.9;font-size:.9rem"><strong>Название:</strong> ${title}<br/><strong>Автор:</strong> ${author_name}<br/><strong>Жанр:</strong> ${genre}<br/><strong>Тип:</strong> ${type === 'prose' ? 'Проза' : 'Поэзия'}<br/><strong>Дата публикации:</strong> ${publishedAt} UTC<br/><strong>ID произведения:</strong> ${book.id}</div></div><div style="margin-bottom:1.75rem"><a href="${bookUrl}" style="display:block;background:#6b3010;color:white;text-decoration:none;padding:.85rem 1.5rem;border-radius:8px;text-align:center;font-size:.9rem;font-weight:600">${bookUrl}</a></div><div style="border:1px solid #e8e0d0;border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1.5rem"><div style="font-size:.8rem;font-weight:600;color:#3a3530;margin-bottom:.75rem">Краткое изложение правил</div><ul style="font-size:.78rem;color:#6b6560;line-height:1.8;padding-left:1.25rem;margin:0"><li>Все авторские права принадлежат вам</li><li>Дата первой загрузки зафиксирована в базе данных</li><li>Читатели могут оценивать и сообщать о нарушениях</li><li>Для удаления книги: support@greenandsnowstudio.com</li></ul></div><p style="font-size:.78rem;color:#8a8278">ID произведения: <strong>${book.id}</strong></p></div><div style="background:#f5f0e8;padding:1.25rem 2rem;text-align:center;border-top:1px solid #e8e0d0"><div style="font-size:.75rem;color:#8a8278">© 2025 Тихая гавань · greenandsnowstudio.com</div></div></div></body></html>`
      })
    });

    return res.status(200).json({ id: book.id, title: book.title });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
