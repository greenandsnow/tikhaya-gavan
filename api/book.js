module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${id}&select=*,authors(name)&status=eq.approved`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const data = await r.json();
    if (!data || data.length === 0) return res.status(404).json({ error: 'Not found' });
    const STORAGE_URL = 'https://nclltofdkjiuneqzemhd.supabase.co/storage/v1/object/public/books/';
    const book = Object.assign({}, data[0], {
      author_name: data[0].authors ? data[0].authors.name : '',
      cover_url: data[0].cover_path ? STORAGE_URL + data[0].cover_path : null
    });
    return res.status(200).json(book);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
