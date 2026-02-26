import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://nclltofdkjiuneqzemhd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jbGx0b2Zka2ppdW5lcXplbWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3OTg5OTksImV4cCI6MjA4NzM3NDk5OX0.FPwKW_8M33M32OWhzhcfF_yftinL7ZlfiEBiZQ4vIG4'
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Start date: Friday Feb 27, 2026 (first crossword week)
    const startDate = new Date('2026-02-27T00:00:00Z');
    const now = new Date();

    // Calculate weeks since start
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceStart = Math.floor((now - startDate) / msPerWeek);

    // Cycle through 50 puzzles (week_number 1-50)
    const weekNumber = (weeksSinceStart % 50) + 1;

    // Allow override via query param for testing: /api/crossword?week=5
    const testWeek = parseInt(req.query?.week);
    const targetWeek = (testWeek >= 1 && testWeek <= 50) ? testWeek : weekNumber;

    const { data, error } = await supabase
      .from('crosswords')
      .select('id, week_number, puzzle_data')
      .eq('week_number', targetWeek)
      .single();

    if (error || !data) {
      // Fallback to week 1
      const { data: fallback } = await supabase
        .from('crosswords')
        .select('id, week_number, puzzle_data')
        .eq('week_number', 1)
        .single();

      return res.status(200).json({
        week: 1,
        total: 50,
        puzzle: fallback?.puzzle_data || null
      });
    }

    return res.status(200).json({
      week: targetWeek,
      total: 50,
      puzzle: data.puzzle_data
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
