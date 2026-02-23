module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const { title, author_name, author_email, genre, type, ai_summary } = body;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    // Upsert author
    const authorRes = await fetch(`${supabaseUrl}/rest/v1/authors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({ name: author_name, email: author_email })
    });
    const authors = await authorRes.json();
    const author = Array.isArray(authors) ? authors[0] : authors;

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
        ai_summary,
        ai_approved: true,
        status: 'approved',
        published_at: new Date().toISOString()
      })
    });
    const books = await bookRes.json();
    const book = Array.isArray(books) ? books[0] : books;

    return res.status(200).json({ id: book.id, title: book.title });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
