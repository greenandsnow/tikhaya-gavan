module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || supabaseKey;

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { book_id, rating_plot, rating_style } = body;

    // Insert rating
    await fetch(`${supabaseUrl}/rest/v1/ratings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ book_id, rating_plot, rating_style, reader_email: 'anonymous' })
    });

    // Update book average ratings
    const ratingsRes = await fetch(`${supabaseUrl}/rest/v1/ratings?book_id=eq.${book_id}&select=rating_plot,rating_style`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const ratings = await ratingsRes.json();
    if (ratings && ratings.length > 0) {
      const avgPlot = ratings.reduce((s,r) => s + r.rating_plot, 0) / ratings.length;
      const avgStyle = ratings.reduce((s,r) => s + r.rating_style, 0) / ratings.length;
      const patchRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${book_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ rating_plot: parseFloat(avgPlot.toFixed(2)), rating_style: parseFloat(avgStyle.toFixed(2)), votes_count: ratings.length })
      });
      const patchText = await patchRes.text();
      console.log('PATCH status:', patchRes.status, 'body:', patchText);
    }

    return res.status(200).json({ ok: true });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
