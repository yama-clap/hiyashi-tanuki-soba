-- =====================================================================
-- Cloudflare D1（SQLite）: 全国ランキング用スキーマ
-- Supabase から移行。D1 は無料枠でも「無操作による自動停止」が無いため、
-- キープアライブ不要で恒久的に動く。
--
-- 適用: npx wrangler d1 execute tanuki-ranking --remote --file=db/schema.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  combo      INTEGER NOT NULL DEFAULT 0,
  -- SQLite に真偽型は無いので 0/1。API 側で boolean に変換して返す。
  hard       INTEGER NOT NULL DEFAULT 0 CHECK (hard IN (0, 1)),
  -- 通常版('normal') と 冷やしたぬき天国版('tengoku') の記録を分離
  version    TEXT    NOT NULL DEFAULT 'normal',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- 旧SupabaseのRLS CHECKに相当する値域制限（API側の検証と二重の防御）
  CHECK (length(trim(name)) BETWEEN 1 AND 6),
  CHECK (score BETWEEN 0 AND 100),
  CHECK (combo BETWEEN 0 AND 300)
);

-- ランキング取得（version で絞り score降順・同点はcreated_at昇順）用の複合インデックス
CREATE INDEX IF NOT EXISTS scores_rank_idx
  ON scores (version, score DESC, created_at ASC);
