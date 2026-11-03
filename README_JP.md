# Engineering-HUB — 設計・開発課 管理

[English](README.md)

設計・開発課のプロジェクト、タスク階層、期限、進捗、完了承認を管理するアプリです。
V2 は React 画面、TypeScript API、バックグラウンドワーカーを社内 LAN で動かし、
PostgreSQL にデータを保存します。社員 ID とパスワードでログインでき、Google アカウントや
メールは不要です。既定は日本語で、English に切り替えられます。

管理者は担当領域、プロジェクト、サブプロジェクト（最大4階層）、タスク（最大3階層）を整理し、
申請を審査します。親タスクを二重集計せず進捗を確認できます。親タスク横の矢印で直下の子タスクを開き、
もう一度押すと閉じられます。メンバーは自分の仕事を登録し、
進捗更新と完了報告ができます。バックアップは暗号化してローカルに保存し、任意で Google Drive
にも複製します。メール、Calendar、公開機能は任意で、既定では停止しています。

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

* **ADMIN / MANAGER:** 担当領域と有効なプロジェクトを作成し、仕事を割り当て、完了・納期変更申請を
  審査します。アカウントと自動化は ADMIN が管理します。
* **MEMBER:** 「自分の担当タスク」で有効なプロジェクトと任意のサブプロジェクトを選び、タスク名、説明、
  期限、優先度を入力します。サーバーが本人を主担当に設定し、未着手・進捗0%で登録します。作成承認は不要です。
  部門共通のロールモデルにより、すべての有効なプロジェクトを選べます。公開設定は編集権限ではありません。
* 担当する末端タスクの進捗を更新し、メモ付きの完了報告を提出します。承認待ちでは完了になりません。
  メンバーが作成したタスクの完了承認は ADMIN のみです。既存タスクのマネージャー審査は維持されます。
  承認待ち・承認済・却下・差戻し・再確認が必要の状態を確認できます。
* 申請には「自動化」の REQUEST_SUBMISSION_ENABLED を管理者が有効にする必要があります（既定 false）。
  非公開プロジェクトの担当タスクも申請できます。BACKUP_ONLY でも申請・承認は動作し、Google メールは不要です。

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
| 別の PC から接続できない | PUBLIC_ORIGIN、HOST=0.0.0.0、TCP 8050 の承認済みファイアウォール規則 |
| 申請できない | REQUEST_SUBMISSION_ENABLED、本人の割当、未完了の末端タスク |
| マネージャーが完了承認できない | メンバー作成タスクには ADMIN が必要 |
| バックアップ失敗 | 状態画面のエラー、実行ファイルのパス、フォルダー権限、サービスアカウント設定 |
| 古い編集内容が拒否された | 最新のリビジョンを再読込し、新しい変更を上書きしない |

[LAN 設置](docs/v2/LOCAL_LAN.md) · [運用](docs/v2/OPERATIONS.md) ·
[構成](docs/v2/ARCHITECTURE.md) · [API](docs/v2/API.md) · [セキュリティ](docs/v2/SECURITY.md) ·
[移行](docs/v2/MIGRATION.md) · [コンテナ運用](docs/v2/SELF_HOSTING.md) ·
[リモート接続](docs/v2/REMOTE_ACCESS.md) · [Google 設定](docs/v2/GOOGLE_WORKSPACE.md) ·
[検証記録](docs/v2/ACCEPTANCE.md)

開発時の確認: npm run typecheck、npm run lint、npm test、npm run validate、
npm run build、npm run test:browser。変更時の規則は [AGENTS.md](AGENTS.md) を参照してください。

旧 V1 は別実装として保持しています。V1.2 / V1.3 以降の履歴は [CHANGELOG.md](CHANGELOG.md) に集約し、
旧版の[構成](ARCHITECTURE.md)と[期間計画方針](docs/TASK_DURATION_POLICY.md)は引き続き参照できます。
