/* =====================================================================
   オンライン全国ランキング設定（Supabase）
   - anonKey は Supabase の「Publishable key」（sb_publishable_…）。
     ブラウザ公開OK・RLS（行レベルセキュリティ）で保護される安全なキーです。
     ※ Secret key（sb_secret_… / service_role）は絶対にここに置かない／公開しない。
   - 取得手順は SETUP_RANKING.md を参照。
   ===================================================================== */
window.RANKING = {
  url: 'https://rxrvjvuuzngabpmqpghk.supabase.co',
  anonKey: 'sb_publishable_-PO8g7oCbK7fztNLcca37A_LRfP2OGl',
  table: 'scores',
  topN: 100,   // 上位100位まで取得（ランキング画面はスクロールで全件見られる）
};
