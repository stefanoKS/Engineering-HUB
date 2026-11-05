# Engineering-HUB — 設計・開発課 管理

[English](README.md)

設計・開発課のプロジェクト、タスク階層、期限、進捗、完了承認を管理するアプリです。
V2 は React 画面、TypeScript API、バックグラウンドワーカーを社内 LAN で動かし、
PostgreSQL にデータを保存します。社員 ID とパスワードでログインでき、Google アカウントや
メールは不要です。既定は日本語で、English に切り替えられます。

管理者は担当領域、プロジェクト、サブプロジェクト（最大4階層）、タスク（最大3階層）を整理し、
申請を審査します。親タスクを二重集計せず進捗を確認できます。プロジェクト画面は1つの展開できる階層表示で、
各サブプロジェクトの見出しの直下にそのタスクが並び、その下に入れ子のサブプロジェクト、サブプロジェクトに
属さないタスクは「プロジェクト直下のタスク」にまとまります。名前や表示順からの推測はせず、保存された
所属関係だけでタスクを表示します。親タスク横の矢印で直下の子タスクを開き、もう一度押すと閉じられます。
誤って作成した空のタスクやサブプロジェクトを完全削除できるのは管理者だけです。削除ボタンは必ず事前確認
（削除可否の検査）を通し、作業・履歴・公開が残っている記録は削除できません。メンバーは自分の仕事を登録して
完了報告を提出し、管理者はその報告を承認するか、権限のある作業を直接完了にできます。タスクの状態は期限と
完了状況から自動で決まり（進行中・期限超過・完了）、技能は A〜D のグレード、担当者は検索できる1つの選択画面で
複数人を割り当てます。バックアップは暗号化してローカルに保存し、任意で Google Drive にも複製します。
メール、Calendar、公開機能は任意で、既定では停止しています。

閲覧専用のタイムラインは、選択した期間全体を画面幅に合わせて表示します。7日間、2週間、
1か月、カスタムから選択でき、表示期間のリセットは絞り込みを変えずに東京の今月へ戻します。
1か月の終了日は翌月の同じ日の前日とし、同じ日がない場合は翌月末です。表示操作では予定を変更しません。
展開したプロジェクト内では、サブプロジェクトの矢印でそのタスク階層を個別に開閉できます。

プロジェクトの表示ステータスは選択ではなく自動計算です。開始日・終了日・東京の今日の日付から
「開始前」「進行中」「遅延」「日程未設定」などを表示します。保存される状態が変わるのは明示的な
「完了」「中止」「アーカイブ」だけで、夜間の一括更新は行わず、保存済みの「保留」が表示を上書きする
こともありません。タスクが完了・取消のときは期限を過ぎていても「期限超過」と表示せず、期限後に
完了した場合は「期限後に完了」として区別します。タイムラインの棒は1行につき1本・高さ12ピクセルで、
期限のみ・同日の記録は3ピクセル幅の点としてその日の中央に描きます。V2 の新規プロジェクトは既定で
`INTERNAL` となり、`RESTRICTED` を明示して作成することもできます。既存の公開範囲は変更せず、
変更は次回の公開処理から反映されます。

## Windows LAN にインストール

常時稼働の Windows PC、Node.js 22.13 以上（検証環境は Node 24）、サービス稼働する
PostgreSQL 18、対応する pg_dump / pg_restore を用意します。LAN アドレスを固定し、
PostgreSQL は localhost のみ・scram-sha-256 認証にします。8050 番ポートへの接続は承認した LAN 範囲に限定します。

リポジトリのルートで実行します。

~~~powershell
npm.cmd ci
npm.cmd run build
New-Item -ItemType Directory -Force data/lan
Copy-Item deploy/windows/api.env.example data/lan/api.env
Copy-Item deploy/windows/worker.env.example data/lan/worker.env
~~~

[Windows LAN ガイド](docs/v2/LOCAL_LAN.md)に従ってコピーしたファイルを編集します。

| 設定 | 設定先・用途 |
| --- | --- |
| DATABASE_URL | 両ファイル。専用 PostgreSQL データベース |
| AUTH_MODE=local, DEV_AUTH_ENABLED=false | API。社員 ID・パスワード認証 |
| HOST=0.0.0.0, PORT=8050, PUBLIC_ORIGIN | API。社員が開く正確なアドレス |
| BACKUP_ONLY=true | ワーカー。メール・Calendar・公開を動かさずバックアップを運用 |
| BACKUP_DIRECTORY, BACKUP_INSTANCE_ID | ワーカー。保護された永続フォルダーと設置環境固有の固定名 |
| PG_DUMP_PATH, PG_RESTORE_PATH | ワーカー。インストール済み実行ファイルのパス |
| BACKUP_ENCRYPTION_KEY | ワーカー。ランダム32バイトの base64。別の保護された復旧場所にも保管 |

暗号鍵をローカルで生成します。

~~~powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
~~~

認証情報や環境ファイルはコミットしないでください。data/lan とバックアップフォルダーのアクセスは
運用担当者・管理者に制限します。HTTP では LAN 内のパスワード通信が暗号化されません。
承認された信頼できる LAN に限定するか、TLS プロキシと HTTPS の PUBLIC_ORIGIN を設定します。
どちらのポートもインターネットに公開しないでください。

## データベースとアカウントの初期設定

PostgreSQL の管理ツールで専用ロールとデータベースを作ります。

~~~sql
CREATE ROLE ehub LOGIN PASSWORD 'REPLACE_WITH_A_GENERATED_PASSWORD';
CREATE DATABASE engineering_hub OWNER ehub;
~~~

DATABASE_URL を設定し、次を実行します。

~~~powershell
./deploy/windows/Migrate-Lan.cmd
./deploy/windows/Bootstrap-Admin.ps1
./deploy/windows/Start-Lan.cmd
~~~

マイグレーションには APPLY MIGRATIONS の入力が必要です。既存環境では、先にバックアップを
作成・検証します。サービス起動時に自動マイグレーションは行いません。初期管理者作成では社員 ID、
名前、非表示の仮パスワードを入力します。アカウントが存在する環境への再初期化は拒否されます。

PUBLIC_ORIGIN を開き、仮パスワードを変更して「アカウント」で社員を登録します。復旧用に2人目の
管理者も登録してください。新規・リセット後のアカウントは、業務データにアクセスする前に仮パスワードを
変更します。Start-Lan は API とワーカーを監視するため、ウィンドウを開いたままにします。
社員を招待する前に別の PC からログインを確認してください。

## 日常の使い方

| 権限 | できること |
| --- | --- |
| ADMIN | マネージャーの全操作に加え、アカウント・権限・自動化を管理 |
| MANAGER | すべての担当領域・プロジェクト・サブプロジェクト・タスクを管理、複数担当者の割当、完了報告の承認・却下・差戻し、権限のある作業の直接完了、自分の担当一覧の閲覧 |
| MEMBER | 許可された作業の閲覧、有効なプロジェクト配下での自分のタスク作成、自分の担当作業の完了報告。既存タスクの編集、担当者・期限の変更、承認はできません |
| VIEWER | 許可された作業と自分の担当の閲覧のみ。作成・編集・削除・承認・申請はできません |

* **自分の担当タスク:** すべての権限に用意されます。本人確認済みのセッションから解決するため、
  マネージャーは部門全体の一覧とは別に自分の一覧を持ち、他人の個人一覧は見えません。
* **すべてのタスク:** 全員が同じサーバー側ページング・絞り込み・階層表示を使います。
  MEMBER と VIEWER は閲覧のみで、許可されたタスクとそのプロジェクトを開くことができ、プロジェクト選択も利用できます。
  編集・承認・完了・削除の操作は ADMIN と MANAGER だけに表示され、サーバー側でも他の権限からの呼び出しを拒否します。
  既定の一覧には完了・取消・アーカイブ済みは表示されません。完了した作業は状態フィルターで「完了」を選ぶと確認でき、
  マネージャーは取消・アーカイブ済みも含めて表示できます。
* **作成:** MEMBER は有効なプロジェクトと任意のサブプロジェクトを選び、タスク名・説明・期限・優先度を
  入力すると本人が担当者になります。所要期間や工数の入力は不要で、土日・祝日の期限も警告なしで受け付けます。
  作成に承認は不要です。
* **割当:** ADMIN と MANAGER は「選択可能なメンバー / 選択済みの担当者」の2段階の選択画面で、
  氏名または社員番号から検索して複数人を割り当てます。現在の主担当が選択に残っていれば維持し、
  外れた場合は選択中の最小メンバーIDを主担当にするため、操作順で担当が変わりません。
  有効な担当者は全員が自分の担当タスクに表示されます。
* **完了:** MEMBER はメモ付きの完了報告を提出します。承認待ちでは完了になりません。MANAGER または ADMIN が
  承認・却下・差戻しを行い、権限のある作業は確認のうえ直接完了にできます。直接完了時は承認待ちの報告を
  取り下げるため、誤解を招く申請が残りません。親タスク（コンテナ）は完了できず、進捗を二重計上しません。
* 申請には「自動化」の REQUEST_SUBMISSION_ENABLED を管理者が有効にする必要があります（既定 false）。
  非公開プロジェクトの担当タスクも申請できます。BACKUP_ONLY でも申請・承認は動作し、Google メールは不要です。

## 旧形式の値を残す理由

表示は簡素化しましたが、保存済みの履歴は書き換えません。

* 技能レベルは整数（0=未評価、1〜4）のまま保持し、画面には A/B/C/D と「未評価」だけを表示します。
* タスク状態は従来の語彙（Not Started、Assigned、In Progress、Blocked、On Hold、Done、Cancelled）を
  保持します。進行中・期限超過・完了は Asia/Tokyo の日付で読み取り時に算出するため、定期処理は不要です。
* 計画期間、見積工数、実績工数、進捗率は旧データのために残します。通常の入力画面には表示せず、
  部分更新で空に上書きすることもありません。
* 主担当の列は引き続き正とし、追加担当は割当テーブルに保存します。読み取り時に重複を除いた
  1つの担当者一覧へ統合します。

## バックアップの設定と検証

1. **deploy/windows/Backup-Now.cmd** を実行し、暗号化ファイルがローカルに保存されたことを確認します。
2. 「自動化」で DAILY_BACKUP_ENABLED を有効にし、BACKUP_INTERVAL_MINUTES を指定します（60で毎時）。
3. 「状態」で最終ローカル保存、最終 Drive アップロード、失敗を確認します。Drive 障害でもローカル保存は残ります。
   保管中のバックアップに対応する暗号鍵を必ず保持してください。
4. Drive は任意です。会社の共有ドライブのフォルダーをサービスアカウントに共有し、ワーカー環境に
   GOOGLE_SERVICE_ACCOUNT_JSON（JSON本文）と DRIVE_BACKUP_FOLDER_ID を設定して再起動します。
   アップロード進捗を保存し、再試行では同じファイル識別子を使います。
5. 暗号化バックアップをダウンロードし、復旧用環境ファイルと検証用 DB を作成できる PostgreSQL ロールで検証します。

~~~powershell
node --env-file=C:/approved-recovery/worker.env apps/worker/dist/cli.js verify-restore C:/approved-recovery/backup.dump.enc
~~~

新しい検証用 DB に復元し、件数を表示して、その検証用 DB のみを削除します。設定済み DB への上書き復元は
行いません。期待件数との比較を含めて[バックアップ・復旧手順](docs/v2/BACKUP_RESTORE.md)に従ってください。
バックアップは自動削除しません。実際の Drive と物理 LAN の確認は運用担当者による検証が必要で、
[本番承認は未取得](docs/PRODUCTION_READINESS.md)です。

## トラブルシューティングと詳細資料

| 症状 | 確認事項 |
| --- | --- |
| ログインできない | PostgreSQL/API の稼働、DATABASE_URL、AUTH_MODE=local、仮パスワード変更 |
| `/readyz` が DATABASE_MIGRATION_REQUIRED を返す | このビルドはスキーマ8が必要です。バックアップを作成・検証してから承認済みマイグレーションを実行します |
| 別の PC から接続できない | PUBLIC_ORIGIN、HOST=0.0.0.0、TCP 8050 の承認済みファイアウォール規則 |
| 申請できない | REQUEST_SUBMISSION_ENABLED、本人の割当、未完了の末端タスク、MEMBER 権限 |
| マネージャーが編集・承認できない | 権限が ADMIN または MANAGER であること。メンバーの申請はどちらでも承認できます |
| 担当タスクに表示されない | 有効な担当者であること。外された担当者には表示されません |
| バックアップ失敗 | 状態画面のエラー、実行ファイルのパス、フォルダー権限、サービスアカウント設定 |
| 古い編集内容が拒否された | 最新のリビジョンを再読込し、新しい変更を上書きしない |

## 既存スキーマ7環境の移行

承認済みの順序は「バックアップ → マイグレーション → 検証 → 新しい配備版の作成」です。
サービス起動時に自動移行は行わず、台帳がスキーマ8になるまで readiness は
DATABASE_MIGRATION_REQUIRED を返します。

~~~powershell
# 1. 暗号化バックアップの作成と検証（失敗時は絶対に進めない）
./deploy/windows/Backup-Now.cmd

# 2. 0008_member_created_work.sql を含む承認済みの追加マイグレーションを適用
./deploy/windows/Migrate-Lan.cmd

# 3. スキーマ版と既存行の保持を確認
Invoke-RestMethod http://localhost:8050/readyz
node --env-file=C:/approved-recovery/worker.env apps/worker/dist/cli.js verify-restore C:/approved-recovery/backup.dump.enc

# 4. 1〜3 が通った後にのみ新しいアプリ版を配備
~~~

ロールバックは逆マイグレーションではなく復元です。API とワーカーを停止し、検証済みバックアップを
新しいデータベースへ復元して DATABASE_URL を切り替え、再起動します。
[バックアップ・復旧](docs/v2/BACKUP_RESTORE.md)と[移行手順](docs/v2/MIGRATION.md)を参照してください。

[LAN 設置](docs/v2/LOCAL_LAN.md) · [運用](docs/v2/OPERATIONS.md) ·
[構成](docs/v2/ARCHITECTURE.md) · [API](docs/v2/API.md) · [セキュリティ](docs/v2/SECURITY.md) ·
[移行](docs/v2/MIGRATION.md) · [コンテナ運用](docs/v2/SELF_HOSTING.md) ·
[リモート接続](docs/v2/REMOTE_ACCESS.md) · [Google 設定](docs/v2/GOOGLE_WORKSPACE.md) ·
[検証記録](docs/v2/ACCEPTANCE.md)

開発時の確認: npm run typecheck、npm run lint、npm test、npm run validate、
npm run build、npm run test:browser。変更時の規則は [AGENTS.md](AGENTS.md) を参照してください。

旧 V1 は別実装として保持しています。V1.2 / V1.3 以降の履歴は [CHANGELOG.md](CHANGELOG.md) に集約し、
旧版の[構成](ARCHITECTURE.md)と[期間計画方針](docs/TASK_DURATION_POLICY.md)は引き続き参照できます。
