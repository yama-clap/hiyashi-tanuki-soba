/* =====================================================================
   Cloudflare Pages Function: 全国ランキング API（D1バックエンド）
   - GET  /api/scores?version=normal&limit=500  → 上位リスト
   - POST /api/scores  {name,score,combo,hard,version} → 登録し、作成行を返す

   旧Supabase構成との違い：
   - ブラウザにAPIキーを一切出さない（同一オリジンの自前API）。
   - 旧RLSのCHECK制約に相当する検証をサーバ側で行う（改ざん・荒らし対策）。
   - レスポンス形状は旧Supabase RESTと同じ「行の配列」に揃えてあるため、
     game.js の描画側は変更不要。
   ===================================================================== */

const VERSIONS = new Set(['normal', 'tengoku']); // 想定外のversionでDBを汚さない
const MAX_LIMIT = 500;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // ランキングは常に最新を出す（CDN/ブラウザキャッシュで古い順位を見せない）
      'Cache-Control': 'no-store',
    },
  });

const bad = (message, status = 400) => json({ error: message }, status);

// SQLiteの0/1を、旧Supabaseと同じ boolean に戻して返す
const toRow = (r) => ({ ...r, hard: !!r.hard });

/* ---------- GET: 上位スコア取得 ---------- */
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const version = url.searchParams.get('version') || 'normal';
    if (!VERSIONS.has(version)) return bad('invalid version');

    const limitRaw = parseInt(url.searchParams.get('limit') || '500', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 1), MAX_LIMIT);

    // 同点は先に登録した人が上（created_at昇順）＝旧Supabaseの並びと同じ
    const { results } = await env.DB.prepare(
      `SELECT id, name, score, combo, hard, version, created_at
         FROM scores
        WHERE version = ?
        ORDER BY score DESC, created_at ASC
        LIMIT ?`
    ).bind(version, limit).all();

    return json((results || []).map(toRow));
  } catch (e) {
    return bad('failed to fetch scores: ' + (e && e.message), 500);
  }
}

/* ---------- POST: スコア登録 ---------- */
export async function onRequestPost({ request, env }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return bad('invalid JSON');
    }

    // --- 検証（旧RLSのwith checkに相当）---
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 6) return bad('name must be 1-6 characters');
    // 改行・制御文字は表示崩れ/荒らしのもとなので拒否
    if (/[\u0000-\u001f\u007f]/.test(name)) return bad('name contains control characters');

    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) return bad('score out of range');

    const combo = Number(body.combo ?? 0);
    if (!Number.isInteger(combo) || combo < 0 || combo > 300) return bad('combo out of range');

    const version = body.version || 'normal';
    if (!VERSIONS.has(version)) return bad('invalid version');

    const hard = body.hard ? 1 : 0;

    // --- 登録して作成行をそのまま返す（game.js が id を myEntryId に使う）---
    const row = await env.DB.prepare(
      `INSERT INTO scores (name, score, combo, hard, version)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, name, score, combo, hard, version, created_at`
    ).bind(name, score, combo, hard, version).first();

    // 旧Supabase(Prefer: return=representation)と同じく「配列」で返す
    return json([toRow(row)], 201);
  } catch (e) {
    return bad('failed to submit score: ' + (e && e.message), 500);
  }
}
