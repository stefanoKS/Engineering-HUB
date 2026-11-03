# Engineering-HUB（設計・開発課 管理）

**設計・開発課の案件管理システム** — プロジェクト、サブプロジェクト、タスク、期限、完了承認、
バックアップを、社内 LAN の PostgreSQL 上で運用します。

現在のプラットフォームは **V2**（TypeScript の API・バックグラウンドワーカー・React 画面）です。
旧 V1 の Google Apps Script 版（`src/`、`dashboard-app/`、`shared/`）は履歴と移行元として
リポジトリに残してあり、この文書の対象ではありません。V1 のリリース記録（V1.2 の共有
ダッシュボード、V1.3 以降の計画・申請機能、V1.4〜V1.7）は [CHANGELOG.md](CHANGELOG.md) に、
V1 の設計メモは [ARCHITECTURE.md](ARCHITECTURE.md) と
[docs/TASK_DURATION_POLICY.md](docs/TASK_DURATION_POLICY.md) にあります。

> 状態: ローカルで実装・検証済み。実ホストでの確認が記録されるまで、本番運用は
> **承認されていません**（[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)）。

---

## 1. できること

**管理者・マネージャー**

* 担当領域 → プロジェクト → サブプロジェクト（最大 4 階層）→ タスク（最大 3 階層）で整理する。
* プロジェクト、サブプロジェクト、タスク、メンバー、スキル、担当領域を作成・編集する。
* 期限と必要期間から日程を決める。休業日の期限は警告を出し、自動では動かさない。
* 従業員からの申請（完了報告・納期変更）を確認し、承認・却下・差し戻しする。
* 件数と進捗でタスクを二重に数えない（親タスクは整理用で、作業単位ではない）。
* 自動化（メール・カレンダー・公開・バックアップ）を設定する。外向けの機能は既定で停止。

**メンバー**

* 自分の担当タスク: 自分のタスクだけを表示し、進捗と実績工数を更新する。
* 有効なプロジェクトの下に、自分のタスクを自分で登録する。
* 完了報告を提出し、状態（承認待ち / 承認済 / 却下 / 差戻し / 再確認が必要）を確認する。

**全員**

* 既定は日本語。日本語 | English を切り替えられる。保存された文字列・ID・列挙値は翻訳しない。
* プロジェクトごとに安定した色で表示し、画面を移動しても見分けられる。

---

## 2. 前提条件

| 項目 | 内容 |
| --- | --- |
| ホスト | LAN 設置用の常時稼働 Windows PC（Linux・コンテナは別途ドキュメント） |
| Node.js | 22.13 以上（検証済みは Node 24） |
| PostgreSQL | 18。Windows サービスとして稼働、localhost のみ待受、scram-sha-256 認証 |
| PostgreSQL ツール | `pg_dump` と `pg_restore`（パスを明示設定） |
| ネットワーク | アプリ用に LAN アドレスを 1 つ確保。承認された LAN からポート 8050 のみ到達可能 |
| Google（任意） | 暗号化バックアップを Google Drive に複製する場合のみサービスアカウント |

PostgreSQL の 5432 番ポートやアプリのポートをインターネットへ公開しないでください。

---

## 3. Windows LAN へのインストール

```powershell
cd C:\path\to\Engineering-HUB
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:v2
npm.cmd run validate
npm.cmd run build
```

次に環境ファイルをテンプレートから作成し、編集します。

```powershell
New-Item -ItemType Directory -Force data/lan
Copy-Item deploy/windows/api.env.example data/lan/api.env
Copy-Item deploy/windows/worker.env.example data/lan/worker.env
```

| 変数 | ファイル | 値 |
| --- | --- | --- |
| `DATABASE_URL` | api.env, worker.env | 専用データベースの接続先 |
| `PUBLIC_ORIGIN` | api.env | 利用者が開く正確な URL（例 `http://10.1.6.253:8050`） |
| `HOST` / `PORT` | api.env | LAN 公開は `0.0.0.0` / `8050` |
| `AUTH_MODE` | api.env | `local`（社員番号＋パスワード） |
| `DEV_AUTH_ENABLED` | api.env | `false` |
| `BACKUP_DIRECTORY` | worker.env | 永続フォルダ（例 `data/backups`） |
| `BACKUP_INSTANCE_ID` | worker.env | 設置ごとに一意で固定した名前 |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | worker.env | インストール済みの実行ファイル |
| `BACKUP_ENCRYPTION_KEY` | worker.env | 32 バイトのランダム値を Base64 化したもの |
| `BACKUP_ONLY` | worker.env | メール・カレンダー・公開を有効にするまで `true` |

環境ファイルはコミットしないでください。`data/lan` と `data/backups` の Windows ACL は、
運用担当者と管理者だけに制限します（`data/` は gitignore 済み）。

バックアップ鍵はホストで生成し、別の保護された復旧場所にも保管してください。

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

例の LAN 設定はプライベート IP での HTTP を前提とするため、パスワードはその LAN 内を
暗号化されずに流れます。信頼できる承認済みネットワークでのみ使用するか、承認された TLS
プロキシを前段に置き、`PUBLIC_ORIGIN` を HTTPS の URL に変更してください。

---

## 4. 初期データベースとアカウント

1. 専用のロールとデータベースを作成する（スーパーユーザーを流用しない）。

   ```sql
   CREATE ROLE ehub LOGIN PASSWORD 'REPLACE_WITH_A_GENERATED_PASSWORD';
   CREATE DATABASE engineering_hub OWNER ehub;
   ```

2. レビュー済みマイグレーションを**明示的に 1 回だけ**適用する（起動時に自動実行しない）。

   ```powershell
   ./deploy/windows/Migrate-Lan.cmd
   ```

   `APPLY MIGRATIONS` と入力します。既存データベースの場合は、先にバックアップを作成・検証します。

3. 最初の管理者を作成する。

   ```powershell
   ./deploy/windows/Bootstrap-Admin.ps1
   ```

   社員番号・氏名・仮パスワード（非表示入力）を求め、アカウントが既にある場合は拒否します。
   既定パスワードや公開登録はありません。

4. 以降の職員は「アカウント管理」で登録します（社員番号・氏名・権限・仮パスワード）。
   新規・再設定のアカウントは次回ログイン時にパスワード変更が必須で、再設定は既存セッションを
   終了します。復旧用に 2 人目の管理者を登録してください。

---

## 5. 起動と利用

```powershell
./deploy/windows/Start-Lan.cmd     # または npm.cmd run start:lan
```

監督プロセスが API とワーカーを起動し、どちらかが停止すると両方を止めます。ウィンドウは
開いたままにします。PostgreSQL はサービスとして独立して稼働します。別の PC から
`PUBLIC_ORIGIN` の URL を開き、社員番号と仮パスワードでログインしてパスワードを変更します。

IT 部門に、承認された LAN からの TCP 8050 のみを許可するファイアウォール規則を依頼し、
職員へ案内する前に別 PC から接続を確認してください。

---

## 6. 管理者とメンバーの作業

**管理者**

1. 担当領域を作成し、その下にプロジェクトを作成する（有効な担当領域が必須）。
2. サブプロジェクトとタスクを登録し、主担当と必要なら追加担当を割り当てる。
3. 職員アカウントを作成し、「メンバー」で権限を管理する。`ADMIN`/`MANAGER` を付与・取消
   できるのは ADMIN だけ、自分の権限は変更できず、最後の有効な管理者は降格できません。
4. 「申請一覧」で申請を処理する。判断は 1 回だけ適用され、タスクが変更された申請は
   上書きせず「再確認が必要」になります。
5. 「自動化設定」でメール・カレンダー・共有ダッシュボード公開を有効化する。既定はすべて停止です。

**マネージャー**

プロジェクトとタスクの作業は管理者と同じですが、権限変更・完全削除・メンバー管理の一部・
完了の上書きは ADMIN 専用です。

**メンバー**

1. 「自分の担当タスク」には自分のタスクだけが表示されます。
2. 自分のタスクを登録する: 有効なプロジェクト（必要ならサブプロジェクト）、タスク名、
   説明、期限、優先度を入力します。担当者は自分になり、状態は「未着手」、進捗は 0 で
   すぐに自分の一覧と管理者のタスク一覧に表示されます。
3. 自分の有効な末端タスクの進捗と実績工数を更新し、メモを添えて「完了報告」を提出します。
4. 自分の申請の状態を確認します。承認されるまで状態や期限は変わりません。自分で作成した
   タスクの完了は管理者（ADMIN）が承認します。
5. 完了と期限の変更は必ず確認を経由します。親タスクは子タスクの完了によって完了します。

申請の受付は自動化設定 `REQUEST_SUBMISSION_ENABLED` が `true` のときだけ有効です（既定は
`false`）。受付停止中は画面にその旨を表示し、申請操作を出しません。

---

## 7. バックアップ

バックアップは AES-256-GCM で暗号化した PostgreSQL アーカイブで、まずローカルに保存し、
必要に応じて Google Drive へ複製します。Drive の障害でローカルのバックアップが失われることは
ありません。

1. `./deploy/windows/Backup-Now.cmd` を 1 回実行し、ローカルファイルのパスを確認する。
2. 「自動化設定」で `DAILY_BACKUP_ENABLED` を有効にし、`BACKUP_INTERVAL_MINUTES`（毎時なら 60）を設定する。
3. 「状態・公開」で、最終ローカルバックアップ・最終 Drive アップロード・直近の失敗を確認する。
   ホストでは `npm.cmd run --workspace @eh/worker tsx src/cli.ts backup-status` でも確認できます。
4. 信頼する前にバックアップを検証する（現行データの論理チェック、またはダウンロードした
   ファイルを別のスクラッチデータベースへ復元）:

   ```powershell
   node --env-file=data/lan/worker.env apps/worker/dist/cli.js verify-restore "C:/approved-recovery/backup.dump.enc"
   ```

   スクラッチデータベースを作成して復元し、件数を表示して `PASS`/`FAIL` を報告し、最後に
   スクラッチデータベースだけを削除します。設定済みのデータベースへ復元することはありません。

暗号化鍵は、古いファイルのために旧鍵を保管したうえで計画的に更新してください。バックアップを
自動削除することはありません（保持期限は報告のみ）。

Google Drive（任意）: 会社の共有ドライブのフォルダをサービスアカウントに編集者として共有し、
サービスアカウント JSON（パスではなく内容）を `GOOGLE_SERVICE_ACCOUNT_JSON` に、フォルダ ID を
`DRIVE_BACKUP_FOLDER_ID` に設定します。大きいバックアップは再開可能なアップロードで送信し、
再試行で重複したコピーを作りません。環境を変更したらワーカーを再起動してください。

---

## 8. トラブルシューティング

| 症状 | 確認点 |
| --- | --- |
| 全員ログインできない | `DATABASE_URL`、`AUTH_MODE=local`、API と PostgreSQL の稼働 |
| ホストでは入れるが他の PC から入れない | `HOST=0.0.0.0`、`PUBLIC_ORIGIN` が LAN アドレス、TCP 8050 の許可 |
| 「仮パスワードを変更」から進めない | 「アカウント管理」で再設定する（既存セッションは終了されます） |
| 期限が受け付けられない | 過去日・休業日は明示的な確認が必要です。自動では動かしません |
| メンバーが完了報告できない | `REQUEST_SUBMISSION_ENABLED` が `true` か、そのタスクの担当者か |
| マネージャーがメンバー作成タスクの完了を承認できない | 仕様です。メンバーが作成したタスクの完了は ADMIN のみ承認できます |
| バックアップが失敗する（Drive） | ローカルファイルは保持されています。「状態・公開」の理由（共有・種類・認証情報）を確認 |
| `pg_dump` が見つからない | `PG_DUMP_PATH` を実ファイルに設定（空白を含むパスは引用符で囲む） |
| 編集後に古い値が表示される | 再読み込みしてください。古いリビジョンの保存は上書きせず拒否します |

---

## 9. ドキュメント

| 内容 | 文書 |
| --- | --- |
| Windows LAN の設置と運用 | [docs/v2/LOCAL_LAN.md](docs/v2/LOCAL_LAN.md) |
| 構成と設計判断 | [docs/v2/ARCHITECTURE.md](docs/v2/ARCHITECTURE.md) |
| HTTP API | [docs/v2/API.md](docs/v2/API.md) |
| セキュリティと制約 | [docs/v2/SECURITY.md](docs/v2/SECURITY.md) |
| バックアップと復元 | [docs/v2/BACKUP_RESTORE.md](docs/v2/BACKUP_RESTORE.md) |
| 日次運用 | [docs/v2/OPERATIONS.md](docs/v2/OPERATIONS.md) |
| V1 → V2 移行 | [docs/v2/MIGRATION.md](docs/v2/MIGRATION.md) |
| セルフホスト（Compose・Caddy） | [docs/v2/SELF_HOSTING.md](docs/v2/SELF_HOSTING.md) |
| 外部アクセス | [docs/v2/REMOTE_ACCESS.md](docs/v2/REMOTE_ACCESS.md) |
| Google Workspace 設定 | [docs/v2/GOOGLE_WORKSPACE.md](docs/v2/GOOGLE_WORKSPACE.md) |
| 性能測定 | [docs/v2/PERFORMANCE.md](docs/v2/PERFORMANCE.md) |
| 受入記録 | [docs/v2/ACCEPTANCE.md](docs/v2/ACCEPTANCE.md) |
| 本番準備状況 | [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) |
| リリース履歴 | [CHANGELOG.md](CHANGELOG.md) |

開発ルールは [AGENTS.md](AGENTS.md) にあります。
