# オンライン全国ランキング セットアップ手順

ランキングは **Supabase**（無料）に保存します。外部ライブラリは使わず、ブラウザの `fetch` だけで送受信します。
手順は **約10分**。`config.js` を埋めるとランキングが有効になり、未設定のままでもゲームは普通に動きます（ランキング画面が「未設定」表示になるだけ）。

---

## 1. Supabase プロジェクトを作る
1. https://supabase.com にサインアップ → **New project** を作成（リージョンは日本に近い `Northeast Asia (Tokyo)` 推奨）。
2. データベースのパスワードを設定（控えておく）。プロジェクト作成完了まで1〜2分待つ。

## 2. テーブルとセキュリティ(RLS)を作る
左メニュー **SQL Editor** → 新規クエリに以下を貼り付けて **Run**。

```sql
-- スコア保存テーブル
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  name        text   not null,
  score       int    not null,
  combo       int    not null default 0,
  created_at  timestamptz not null default now()
);

-- 並べ替え用インデックス（score降順）
create index if not exists scores_rank_idx on public.scores (score desc, created_at);

-- 行レベルセキュリティを有効化
alter table public.scores enable row level security;

-- 匿名で「読み取り（ランキング表示）」を許可
create policy "anon read scores" on public.scores
  for select to anon using (true);

-- 匿名で「登録のみ」許可。CHECKで値域・名前を制限＝簡易チート/荒らし対策。
-- ※ update / delete のポリシーは作らない＝匿名は変更・削除できない。
create policy "anon insert scores" on public.scores
  for insert to anon
  with check (
    char_length(btrim(name)) between 1 and 12   -- 空白だけ/長すぎる名前を弾く
    and name !~ '[[:cntrl:]]'                    -- 改行・制御文字を禁止（表示崩れ/荒らし対策）
    and score between 0 and 100
    and combo between 0 and 300
  );

-- 【重要】匿名・認証ユーザーから update/delete/truncate を剥奪（select+insert のみに限定＝
-- 公開キーでの改ざん・全削除を防ぐ）。「Automatically expose new tables」でこれらの権限が
-- 付くことがあるため、明示的に revoke しておく。
revoke update, delete, truncate on public.scores from anon, authenticated;

-- （任意・さらに堅くするなら）created_at をクライアントから指定させない。
-- 直POSTで created_at を操作され同点の並び順を弄られるのを防ぐトリガー：
-- create function public.scores_force_now() returns trigger language plpgsql as $$
-- begin new.created_at := now(); return new; end $$;
-- create trigger scores_set_now before insert on public.scores
--   for each row execute function public.scores_force_now();
```

> `score between 0 and 100` の上限は調整可。極端な値（9999等）の登録を弾くための上限です。

## 3. 接続情報を config.js に書く
左メニュー **Project Settings → API** を開き、
- **Project URL**（例 `https://abcdefgh.supabase.co`）
- **Project API keys → `anon` `public`** のキー（`eyJ...` で始まる長い文字列）

を控え、リポジトリの `config.js` を編集：

```js
window.RANKING = {
  url: 'https://abcdefgh.supabase.co',   // ← あなたの Project URL
  anonKey: 'eyJhbGciOiJIUzI1NiI...',     // ← anon public キー
  table: 'scores',
  topN: 100,
};
```

> ⚠️ `anon public` キーは **公開して問題ない**キーです（RLS が守ります）。
> **`service_role` キーは絶対に config.js に書かない／公開しない**でください。

## 4. 静的ホスティングに公開（GitHub Pages 例）
オンラインランキングは `https` 配信で使うのが安全です（`file://` 直開きは API 呼び出しで失敗しやすい）。

1. GitHub に新規リポジトリを作成し、このフォルダ一式を push
   （`index.html / game.js / style.css / config.js / howto.html / howto.css / assets/` を含める）。
2. リポジトリの **Settings → Pages → Build and deployment → Source: Deploy from a branch**、
   Branch を `main` / `(root)` にして **Save**。
3. 1〜2分で `https://<ユーザー名>.github.io/<リポジトリ名>/` が発行される。そのURLを開く。
4. Supabase の REST は任意オリジンからの取得/登録を許可（CORS対応）しているので、そのまま動きます。

> 開発中は `http://localhost:8000`（同梱の `serve_nocache.py`）でも動作確認できます。

## 5. 動作確認
1. 公開URL（またはローカル）を開く → プレイ → タイムアップ → **「ランキングに登録」** → 名前を入力 → **登録する**。
2. 上位（取得した topN 件内）に入れば、ランキングに自分の行が **金色ハイライト** で出る。圏外でも下部に「あなた ○位 〜杯」（順位が分かる範囲で）が表示される。
3. Supabase の **Table Editor → scores** に行が増えているのを確認。
4. 別の端末/ブラウザから開いても同じランキングが見える。

---

## 注意・既知の限界
- **スコアはクライアントから送信**するため、技術的には改ざんが可能です。RLSのCHECK（上限クランプ）＋登録のみ許可で軽減していますが、完全防止はできません。厳密にするなら Supabase **Edge Function** でサーバー側検証・レート制限を追加してください（将来拡張）。
- **名前は公開情報**になります（誰でも一覧で見える）。個人情報は入れないよう案内すると良いです。
- 無料枠の範囲（行数・帯域）に収まる規模を想定。大量アクセスが見込まれる場合はプラン/対策を検討。
