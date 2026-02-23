const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse multipart form data
    const fields = {};
    let fileBuffer = null;
    let fileName = null;
    let fileType = null;

    // Vercel automatically parses multipart - body contains fields
    // For file upload we need to handle the raw body
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Use formidable for multipart parsing
      const formidable = require('formidable');
      const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
      
      await new Promise((resolve, reject) => {
        form.parse(req, async (err, formFields, files) => {
          if (err) { reject(err); return; }
          Object.keys(formFields).forEach(k => { fields[k] = Array.isArray(formFields[k]) ? formFields[k][0] : formFields[k]; });
          if (files.file) {
            const f = Array.isArray(files.file) ? files.file[0] : files.file;
            const fs = require('fs');
            fileBuffer = fs.readFileSync(f.filepath);
            fileName = f.originalFilename;
            fileType = f.mimetype;
          }
          resolve();
        });
      });
    } else {
      // JSON fallback
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      Object.assign(fields, body);
    }

    const { title, author_name, author_email, annotation, genre, type, ai_summary } = fields;

    // Upsert author
    const { data: authorData, error: authorError } = await supabase
      .from('authors')
      .upsert({ name: author_name, email: author_email }, { onConflict: 'email' })
      .select()
      .single();
    if (authorError) throw new Error('Author error: ' + authorError.message);

    // Upload file to Storage
    let filePath = null;
    if (fileBuffer && fileName) {
      const ext = fileName.split('.').pop();
      filePath = `${authorData.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('books')
        .upload(filePath, fileBuffer, { contentType: fileType, upsert: false });
      if (uploadError) throw new Error('Upload error: ' + uploadError.message);
    }

    // Insert book
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .insert({
        author_id: authorData.id,
        title,
        genre,
        type,
        description: annotation,
        ai_summary,
        file_path: filePath,
        ai_approved: true,
        status: 'approved',
        published_at: new Date().toISOString()
      })
      .select()
      .single();
    if (bookError) throw new Error('Book error: ' + bookError.message);

    const bookUrl = `https://www.greenandsnowstudio.com/book/${bookData.id}`;
    const publishedAt = new Date().toLocaleString('ru-RU', { timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short' });

    // Send confirmation email
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Тихая гавань <onboarding@resend.dev>',
        to: author_email,
        subject: `«${title}» — подтверждение публикации`,
        html: `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/></head><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem"><div style="max-width:600px;margin:0 auto;background:#fdfcfa;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)"><div style="background:linear-gradient(135deg,#6b3010,#8b4e2a);padding:2.5rem 2rem;text-align:center"><div style="font-family:Georgia,serif;font-size:1.6rem;font-weight:700;color:white;letter-spacing:.05em">Тихая гавань</div><div style="font-size:.75rem;color:rgba(255,255,255,0.7);letter-spacing:.15em;text-transform:uppercase;margin-top:.3rem">Издательство</div></div><div style="padding:2rem 2.5rem"><p style="font-size:1rem;color:#3a3530;margin-bottom:1.5rem">Уважаемый(ая) <strong>${author_name}</strong>,</p><p style="color:#6b6560;line-height:1.7;margin-bottom:1.5rem">Ваше произведение успешно прошло модерацию и опубликовано в библиотеке «Тихой гавани».</p><div style="background:#f5f0e8;border-left:3px solid #8b4e2a;border-radius:4px;padding:1.25rem 1.5rem;margin-bottom:1.75rem"><div style="font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#8a8278;margin-bottom:.5rem">Данные публикации</div><div style="color:#3a3530;line-height:1.9;font-size:.9rem"><strong>Название:</strong> ${title}<br/><strong>Автор:</strong> ${author_name}<br/><strong>Жанр:</strong> ${genre}<br/><strong>Тип:</strong> ${type === 'prose' ? 'Проза' : 'Поэзия'}<br/><strong>Дата публикации:</strong> ${publishedAt} UTC<br/><strong>ID произведения:</strong> ${bookData.id}</div></div><div style="margin-bottom:1.75rem"><a href="${bookUrl}" style="display:block;background:#6b3010;color:white;text-decoration:none;padding:.85rem 1.5rem;border-radius:8px;text-align:center;font-size:.9rem;font-weight:600">${bookUrl}</a></div><div style="border:1px solid #e8e0d0;border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1.5rem"><div style="font-size:.8rem;font-weight:600;color:#3a3530;margin-bottom:.75rem">Краткое изложение правил публикации</div><ul style="font-size:.78rem;color:#6b6560;line-height:1.8;padding-left:1.25rem;margin:0"><li>Все авторские права на произведение принадлежат вам</li><li>Платформа показывает книгу читателям в некоммерческих целях</li><li>Дата первой загрузки зафиксирована в нашей базе данных</li><li>Читатели могут оценивать произведение и сообщать о нарушениях</li><li>Для удаления книги напишите на support@greenandsnowstudio.com</li></ul></div><p style="font-size:.78rem;color:#8a8278;line-height:1.7">ID произведения <strong>${bookData.id}</strong> однозначно идентифицирует вашу книгу в нашей системе.</p></div><div style="background:#f5f0e8;padding:1.25rem 2rem;text-align:center;border-top:1px solid #e8e0d0"><div style="font-size:.75rem;color:#8a8278">© 2025 Тихая гавань · <a href="https://www.greenandsnowstudio.com" style="color:#4a7c8e;text-decoration:none">greenandsnowstudio.com</a></div></div></div></body></html>`
      })
    });

    return res.status(200).json({ id: bookData.id, title: bookData.title });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
