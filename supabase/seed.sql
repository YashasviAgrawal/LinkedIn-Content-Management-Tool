-- ============================================================================
-- Cadence webapp — default weekly slot grid
-- Run after schema.sql. Edit freely afterwards on the /slots page.
--
-- These times come from drafts/CONTENT_CALENDAR.md:
--   morning 08:45–09:00  → India desk-start (carousels, data, how-to)
--   evening 19:30        → India evening scroll + 10:00 EST / 15:00 CET
--   Sunday 11:00 / 18:30 → weekend pattern differs; Sunday mornings are dead
-- All times are wall-clock in APP_TIMEZONE (default Asia/Kolkata).
-- ============================================================================

insert into slots (day_of_week, time_local, label, preferred) values
  (0, '11:00', 'Sun late-morning',   'humor, light POV'),
  (0, '18:30', 'Sun evening',        'flagship carousel'),
  (1, '09:00', 'Mon morning',        'best practice, how-to'),
  (1, '19:30', 'Mon evening',        'story'),
  (2, '08:45', 'Tue morning',        'tools list, carousel'),
  (2, '19:30', 'Tue evening',        'information, diagram'),
  (3, '08:45', 'Wed morning',        'poll / engagement bait'),
  (3, '19:30', 'Wed evening',        'lead magnet — conversion day'),
  (4, '08:45', 'Thu morning',        'information, data-backed'),
  (4, '19:30', 'Thu evening',        'story'),
  (5, '08:45', 'Fri morning',        'contrarian POV'),
  (5, '19:30', 'Fri evening',        'building solo, personal'),
  (6, '11:00', 'Sat late-morning',   'reflection, one-person business')
on conflict (day_of_week, time_local) do nothing;
