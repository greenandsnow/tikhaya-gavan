// api/news-admin.js
// POST /api/news-admin
// Body: { action: "publish"|"delete", id: "uuid", password: "..." }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body;
    var password = process.env.ADMIN_PASSWORD;

    if (!password || body.password !== password) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    var supabaseUrl = process.env.SUPABASE_URL;
    var serviceKey = process.env.SUPABASE_SERVICE_KEY;
    var id = body.id;
    var action = body.action;

    if (!id) return res.status(400).json({ error: 'id required' });

    if (action === 'publish') {
      var r = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r.ok, action: 'published' });
    }

    if (action === 'delete') {
      var r2 = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        }
      });
      return res.status(200).json({ ok: r2.ok, action: 'deleted' });
    }

    if (action === 'publish_all') {
      var date = body.date || new Date().toISOString().split('T')[0];
      var r3 = await fetch(supabaseUrl + '/rest/v1/news?date=eq.' + date + '&status=eq.draft', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r3.ok, action: 'all_published' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
