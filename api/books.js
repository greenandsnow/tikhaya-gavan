module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    // Get books with author names via join
    const r = await fetch(`${supabaseUrl}/rest/v1/books?select=id,title,genre,type,description,ai_summary,rating_plot,rating_style,votes_count,published_at,status,authors(name)&status=eq.approved&order=rating_plot.desc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const books = await r.json();

    const STORAGE_URL = 'https://nclltofdkjiuneqzemhd.supabase.co/storage/v1/object/public/books/';

    // Flatten author name and add cover URL
    const result = books.map(function(b) {
      return Object.assign({}, b, {
        author_name: b.authors ? b.authors.name : '',
        cover_url: b.cover_path ? STORAGE_URL + b.cover_path : null
      });
    });

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(result);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
