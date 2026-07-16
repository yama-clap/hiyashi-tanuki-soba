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
  hard        boolean not null default false,   -- 「これはキツイ」モードの記録か（ランキングで★＋赤帯で区別）
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
    char_length(btrim(name)) between 1 and 6    -- 空白だけ/長すぎる名前を弾く（表示・入力とも6文字）
    and name !~ '[[:cntrl:]]'                    -- 改行・制御文字を禁止（表示崩れ/荒らし対策）
    and score between 0 and 100
    and combo between 0 and 300
  );

-- 【重要】匿名・認証ユーザーから update/delete/truncate を剥奪（select+insert のみに限定＝
-- 公開キーでの改ざん・全削除を防ぐ）。「Automatically expose new tables」でこれらの権限が
-- 付くことがあるため、明示的に revoke しておく。
revoke update, delete, truncate on public.scores from anon, authenticated;

-- 【既存DBに後から hard 列を足す場合のマイグレーション】
-- すでに scores テーブルを作成済みなら、以下を1回だけ実行（後方互換・安全。既存行は false 扱い）。
-- insert ポリシーは name/score/combo しか見ないため hard 追加で変更不要。boolean なので CHECK も不要。
alter table public.scores add column if not exists hard boolean not null default false;

-- 【バージョン別ランキング（通常/天国 など）を分ける場合のマイグレーション】
-- version 列で「通常版(normal)」と「冷やしたぬき天国版(tengoku)」の記録を分離する。
-- 既存行は自動で 'normal' 扱い。送信時に version を付け、取得時に version=eq.<v> で絞る（コード対応済み）。
-- insert ポリシーは version を見ないため変更不要（text なので CHECK も任意）。
alter table public.scores add column if not exists version text not null default 'normal';

-- （任意・さらに堅くするなら）created_at をクライアントから指定させない。
-- 直POSTで created_at を操作され同点の並び順を弄られるのを防ぐトリガー：
-- create function public.scores_force_now() returns trigger language plpgsql as $$
-- begin new.created_at := now(); return new; end $$;
-- create trigger scores_set_now before insert on public.scores
--   for each row execute function public.scores_force_now();
```

> `score between 0 and 100` の上限は調整可。極端な値（9999等）の登録を弾くための上限です。

### キープアライブ用テーブル（無料プランの自動停止対策・**必須**）

無料プランは **7日間 DBアクティビティが無いと自動で一時停止**される。停止タイマーは
「実際にPostgresに届くクエリ」でしかリセットされず、**単なる GET はAPIゲートウェイに
キャッシュされて届かないためリセットされない**（実測で確認済み）。そこで GitHub Actions
（`.github/workflows/supabase-keepalive.yml`）が2日ごとに、下記の専用テーブルへ **UPDATE(書き込み)**
を行ってDBを起こし続ける。ランキングの `scores` は汚さない。以下を **SQL Editor で1回だけ実行**：

```sql
-- キープアライブ用の1行だけのテーブル
create table if not exists public.keep_alive (
  id       int primary key,
  beat_at  timestamptz not null default now(),
  nonce    uuid        not null default gen_random_uuid()
);

-- id=1 の初期行を必ず1つ作る（ワークフローはこの行を UPDATE する）
insert into public.keep_alive (id, beat_at) values (1, now())
  on conflict (id) do nothing;

alter table public.keep_alive enable row level security;

-- 匿名(publishable key)から id=1 の行の UPDATE のみ許可（=書き込みでDBを起こす）
drop policy if exists "anon update keep_alive" on public.keep_alive;
create policy "anon update keep_alive" on public.keep_alive
  for update to anon using (id = 1) with check (id = 1);

-- （任意）読み取りも許可
drop policy if exists "anon read keep_alive" on public.keep_alive;
create policy "anon read keep_alive" on public.keep_alive
  for select to anon using (true);

-- 必要な権限だけ付与。insert/delete/truncate は匿名から剥奪（1行を更新できるだけにする）
grant select, update on public.keep_alive to anon;
revoke insert, delete, truncate on public.keep_alive from anon, authenticated;
```

> 動作確認：GitHub の **Actions → Supabase keep-alive → Run workflow** を実行し、緑（HTTP 200・
> `"beat_at"` が更新された行が返る）になればOK。プロジェクトが停止中／このテーブル未作成だと失敗する。

## 3. 接続情報を config.js に書く
新しいSupabaseのキー画面に合わせた手順：
- **Project URL**：左メニュー **Settings → Data API**（または General）→ `https://◯◯◯.supabase.co`
- **Publishable key**：左メニュー **Settings → API Keys** → **Publishable key**（`sb_publishable_…` で始まる。ブラウザ公開OK＝旧「anon public」に相当）

を控え、リポジトリの `config.js` を編集：

```js
window.RANKING = {
  url: 'https://abcdefgh.supabase.co',        // ← あなたの Project URL
  anonKey: 'sb_publishable_xxxxxxxxxxxx...',   // ← Publishable key（公開OK）
  table: 'scores',
  topN: 100,
};
```

> ⚠️ `Publishable key`（`sb_publishable_…`）は **公開して問題ない**キーです（RLS が守ります）。
> **Secret key（`sb_secret_…` / `service_role`）は絶対に config.js に書かない／公開しない**でください。
> （※ 旧UIでは「anon public」「service_role」という名称でした）

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
