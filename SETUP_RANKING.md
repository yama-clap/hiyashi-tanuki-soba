# オンライン全国ランキング 構成メモ（Cloudflare D1）

ランキングは **Cloudflare D1**（無料）に保存し、**Pages Functions** の自前API `/api/scores` 経由で読み書きします。
外部ライブラリは不使用（ブラウザの `fetch` のみ）。**APIキーの類はブラウザに一切出ません。**

> **なぜ Supabase をやめたか（2026-07）**
> Supabase無料プランは「7日間 *十分な* アクティビティが無い」とプロジェクトを自動停止します。
> 停止するとランキングが全断。キープアライブ（定期GET→定期書き込み）を2度試しましたが、
> 「読み取りはキャッシュされDBに届かない」「書き込みでも週数回では *sufficient activity* と見なされない」
> ため停止を防げませんでした。**Cloudflare D1 には無操作による自動停止が無い**ため移行しました。

---

## 全体構成

```
ブラウザ (game.js)
  │  fetch 同一オリジン（キー不要）
  ▼
/api/scores            ← functions/api/scores.js（Pages Functions）
  │  env.DB
  ▼
Cloudflare D1 「tanuki-ranking」   database_id: 8d236e09-2492-41a3-8ccf-355ea65c0cab（APAC）
```

| ファイル | 役割 |
|---|---|
| `functions/api/scores.js` | API本体。GET=一覧 / POST=登録。入力検証もここ |
| `db/schema.sql` | テーブル定義（`scores`）とインデックス |
| `db/seed.sql` | Supabaseから移行した既存165件 |
| `config.js` | `topN` のみ（旧 `url`/`anonKey` は不要になり削除） |

## API 仕様

- `GET /api/scores?version=<normal|tengoku>&limit=<1-500>`
  → `[{id,name,score,combo,hard,version,created_at}, ...]`（score降順・同点はcreated_at昇順）
- `POST /api/scores`  body: `{name,score,combo,hard,version}`
  → 作成行を **配列** で返す（201）。`game.js` はその `id` を自分の行の目印に使う。

### 入力検証（旧SupabaseのRLS CHECKに相当・サーバ側で実施）
名前は前後空白を除いて1〜6文字／制御文字禁止、`score` 0〜100、`combo` 0〜300、
`version` は `normal`/`tengoku` のみ。違反は 400 で拒否。`Cache-Control: no-store` で古い順位を出さない。

---

## 運用メモ

### バインディング
Pagesプロジェクト `hiyashi-tanuki` の設定に **D1バインディング `DB`** が登録済み（production/preview）。
`functions/api/scores.js` からは `env.DB` で参照する。

> ⚠️ **`wrangler.toml` をリポジトリ直下に置かないこと。**
> サイト本体がリポジトリ直下にある構成（`pages_build_output_dir = "."`）だと、
> **Gitビルド時に `functions/` がコンパイルされず `/api/scores` が404になる**現象を確認済み。
> バインディングはPagesプロジェクト設定側に保存されているので、`wrangler.toml` は不要。
> ローカル開発用の控えは `wrangler.toml.local`（gitignore済み）に置いてある。

### デプロイ
`main` に push すれば Cloudflare Pages が自動ビルド＆デプロイする（`functions/` も自動で取り込まれる）。

### DBを直接操作する
```bash
# 件数確認
npx wrangler d1 execute tanuki-ranking --remote --command "SELECT COUNT(*) FROM scores;"

# 上位10件
npx wrangler d1 execute tanuki-ranking --remote --command \
  "SELECT name,score,combo,hard FROM scores WHERE version='normal' ORDER BY score DESC LIMIT 10;"

# 荒らし行の削除（idを指定）
npx wrangler d1 execute tanuki-ranking --remote --command "DELETE FROM scores WHERE id=123;"
```

### ローカルで動かす
```bash
cp wrangler.toml.local wrangler.toml        # 一時的に戻す（コミットはしない）
npx wrangler d1 execute tanuki-ranking --local --file=db/schema.sql
npx wrangler d1 execute tanuki-ranking --local --file=db/seed.sql
npx wrangler pages dev .                    # http://localhost:8788
rm wrangler.toml                            # 終わったら消す（Gitビルドを壊さないため）
```

### 作り直す場合（新しいD1を用意するとき）
```bash
npx wrangler d1 create tanuki-ranking
npx wrangler d1 execute tanuki-ranking --remote --file=db/schema.sql
npx wrangler d1 execute tanuki-ranking --remote --file=db/seed.sql
```
そのうえで Pages の設定で D1 バインディング名 `DB` を新しいDBに向ける
👉 https://dash.cloudflare.com/?to=/:account/pages/view/hiyashi-tanuki/settings/functions

## 無料枠について
D1無料枠は 5GB / 読み取り500万行・書き込み10万行 per day。
このゲームの規模（165件・1日数十アクセス）では上限に触れません。**無操作による停止もありません。**
