module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { book_id, author_email } = body;

    if (!book_id || !author_email) return res.status(400).json({ error: 'Missing fields' });

    // Verify book belongs to this author
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${book_id}&select=id,authors(email)`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const books = await checkRes.json();
    if (!books || books.length === 0) return res.status(404).json({ error: 'Book not found' });
    if (books[0].authors?.email !== author_email) return res.status(403).json({ error: 'Not authorized' });

    // Soft delete
    await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${book_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ deleted_at: new Date().toISOString() })
    });

    return res.status(200).json({ ok: true });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
