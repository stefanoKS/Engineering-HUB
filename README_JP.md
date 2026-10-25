# Engineering-HUB

Google スプレッドシートをデータベース、Google Apps Script をアプリケーション、GitHub をソースコードの履歴管理に使用する、エンジニアリング向けのプロジェクト管理システムです。

[English](README.md) · [設計](ARCHITECTURE.md) · [データ構造](DATA_SCHEMA.md) · [デプロイ](DEPLOYMENT.md) · [バックアップと復元](BACKUP_RESTORE.md) · [管理者向け手順](docs/MANAGER_WORKFLOW.md) · [自動化設定](docs/AUTOMATION_SETTINGS.md) · [共有ダッシュボード](docs/dashboard/ARCHITECTURE.md) · [公開データ契約](docs/dashboard/DATA_CONTRACT.md) · [Workspace実機確認](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) · [セキュリティモデル](docs/SECURITY_MODEL.md) · [運用ランブック](docs/OPERATIONS_RUNBOOK.md)

## リリース状況 — 本番承認前

| 項目 | 内容 |
| --- | --- |
| リリース | V1.2（全社員向け・閲覧専用の共有ダッシュボード）／V1.1（管理の使いやすさ・信頼性・自動化制御）＋本番向け堅牢化 |
| バージョン | `1.2.0` |
| ローカルテスト | **148件すべて成功**（`npm test`）。`npm run lint` と `npm run validate` も成功 |
| スキーマバージョン | **4**（`004_shared_dashboard`。追加のみ・承認と検証済みバックアップが必要） |
| ローカルで確認済み | 未見積とゼロの区別、期限のみの割当、割当承認と日程確定の分離、対象判定、工数加重の進捗、決定的な健全性判定、ダッシュボード・Gantt・作業負荷、ロール制御（ADMIN/MANAGER/MEMBER/VIEWER）、安全なDOM描画、初回管理者ブートストラップ、OFF/PREVIEW/LIVE の全組み合わせ、期限前通知の日数設定とキャッチアップ、週次レポート、トリガー設定の再作成、通知台帳の状態、移行時のデータ保持、公開項目の許可リスト、`INTERNAL` のみの公開、A/Bスナップショットの確定と失敗時の保持、閲覧専用API、Asia/Tokyo の期限表記 |
| 本番の阻害要因 | Google Workspace での実機確認が未実施、開発/本番プロジェクトが未作成、移行後のロールが空欄で初期管理者の設定が必要、実シートでのクォータ・性能が未測定、リポジトリ公開範囲が未決定、ダッシュボードの公開設定・Drive ACL・定期公開が未検証 |
| Google Workspace 検証 | **未検証**。本リポジトリは実環境で実行していません |

正式なリリース判定は [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) に記録します。実機の証跡が揃うまで
**本番承認前**のままとし、CIの成功だけでは状態を変更しません。

## 2つのアプリケーション

| アプリケーション | ソース | 役割 |
| --- | --- | --- |
| 管理アプリ（コンテナバインド） | `src/` | 業務データ、サイドバー、自動化、公開処理 |
| 共有ダッシュボード（スタンドアロンWebアプリ） | `dashboard-app/` | 全社員向けの**閲覧専用**ポートフォリオ。公開スナップショットのみ読み取り |

共有ダッシュボードは業務データベース（管理用スプレッドシート）へアクセスせず、書き込み・メール送信・
カレンダー・トリガーの機能を持ちません。公開対象は `Dashboard_Visibility = INTERNAL` と明示された
プロジェクトだけです。詳細は [docs/dashboard/ARCHITECTURE.md](docs/dashboard/ARCHITECTURE.md) と
[docs/dashboard/ACCESS_AND_SHARING.md](docs/dashboard/ACCESS_AND_SHARING.md) を参照してください。


## 最初に確認すること

- 開発用と本番用は、Apps Script プロジェクトもスプレッドシートも分離してください。
- コードの push はデータ移行ではありません。Git ではセルの内容、Drive ファイル、Script Properties、トリガーを復元できません。
- 初期化は、明示的に指定した空のブックに限ります。既存データには、レビュー済みで明示的に承認したマイグレーションを使用します。
- 初期状態ではメール・Calendar 連携は無効、dry-run は有効です。
- 管理UI（V1.1）は**コンテナバインド**の Apps Script プロジェクトが必要です。スタンドアロンではサイドバーを表示できません。
- 管理者設定はブック内の `AUTOMATION_SETTINGS` テーブルに保存され、デプロイで消えません。認証情報は Script Properties に分離します。
- バックアップ先には共有範囲を制限した Drive フォルダが必要です。自動削除は行いません。

## ローカル確認

Node.js 22（22.13.0 以上）と PowerShell を使用します。

```powershell
npm ci
npm run lint
npm test
npm run validate
```

続いて [デプロイ手順](DEPLOYMENT.md) に従い、開発専用プロジェクトを作成し、Script Properties を設定してください。Google の認可は Apps Script エディタから手動で実行します。`config.example.json` は設定例であり、自動で読み込まれるファイルでも認証情報でもありません。

## V1.1 — 管理の使いやすさ・信頼性・自動化制御

スキーマはバージョン3です。追加のみの移行 `003_management_reliability` を使用し、既存の値が変わっていないことを確認してから成功として記録します。

- **未見積は未見積のまま。** `Estimated_Hours` の既定値は空欄で、`0` は意図的なゼロです。未見積タスクは作業負荷・ダッシュボード・週次レポートで別集計します。
- **割当承認と日程確定を分離。** 期限のみの割当が可能です。割当承認は有効な担当者と検証済みアカウントを要求し、日程確定は期限と見積を要求します。進捗更新では承認を取り消さず、担当者・期限などの重要変更では取り消します。
- **共通の対象判定** (`Eligibility.gs`) により、アーカイブ・中止の案件を稼働中の作業負荷・通知・レポートから除外し、記録自体は保持します。
- **工数加重の進捗と決定的な健全性判定。** 進捗は計算列のみを更新します。健全性は文書化されたヒューリスティックで、しきい値は設定可能です（`GREEN`/`YELLOW`/`RED` と `UNKNOWN`/`PLANNED`/`ON_HOLD`/`COMPLETED`/`CANCELLED`/`ARCHIVED`）。
- **日本語の管理UI**（コンテナバインド）。メニュー、タスク割当、進捗、メンバー、スキル、課題、マイルストーン、自動化設定、システム状態。書き込みはすべて検証済みのドメインサービス経由です。
- **自動化設定センター。** OFF/PREVIEW/LIVE の配信モード、機能別スイッチ、プロジェクト別・タスク別スイッチ、期限前通知日数と限定的なキャッチアップ、週次管理レポート、カレンダー・バックアップ・ダッシュボード自動更新の切替、状態の永続化と監査記録。[自動化設定](docs/AUTOMATION_SETTINGS.md) を参照してください。
- **ロール:** `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`。検証済みの Google アカウントから判定し、サーバー側で強制します。
  移行直後の空欄ロールは `VIEWER` として扱うため、管理者が明示的に設定してください。サイドバーは既定で管理者専用で、
  `ALLOW_MEMBER_SELF_SERVICE=true` の場合のみ MEMBER が自分の範囲で利用できます（機密性の境界にはなりません）。
  詳細は [セキュリティモデル](docs/SECURITY_MODEL.md) を参照してください。
- **逆算計画** はプロジェクト単位で `PROJECT_PHASES` に版管理して保存します。あるプロジェクトの再計画が他プロジェクトの計画を置き換えることはありません。
- **信頼性:** 送信前に `PENDING` を記録し、配信不確定の通知を自動再送しません。管理作業で `DELIVERY_UNCERTAIN` に整理でき、プレビューは本番の重複防止キーを消費しません。

ゲートごとの証跡は [docs/checkgates](docs/checkgates/GATE_1.md)、Google Workspace 実機確認の手順は
[docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) にあります。実機確認は本リポジトリでは実施していません。

### 本番向け堅牢化（マージ後監査）

初回V1.1マージ後に確認された5件の不具合を修正し、それぞれ回帰テストを追加しました。

1. **権限昇格** — MANAGER が `ADMIN` を付与でき、ブラウザのペイロードでロールを変更できました。現在はサーバー側
   （`Members.guardRoleChange` と `Access`）で制御し、自分のロール変更を禁止し、最後の有効な管理者を降格・無効化
   できません。
2. **タスク所有権** — 進捗更新がブラウザから渡されたタスクIDを信頼していました。MEMBER は自分のタスクのみ、
   MANAGER は自分が責任者または担当のプロジェクト/サブプロジェクトのみ、ADMIN は全件、VIEWER は不可としました。
3. **安全でないHTML挿入** — サイドバーがシート由来の文字列を `innerHTML` に挿入していました。DOM生成と
   `textContent`（`src/UiSafe.html`）に統一し、`npm run validate` がテンプレート内の危険なAPIを拒否します。
4. **LIVE送信の再開** — `EMAIL_MODE=LIVE` のまま緊急停止を解除すると、管理者確認なしで送信が再開していました。
   現在は「有効状態が LIVE へ遷移する操作」に対して ADMIN・確認文字列・プリフライトを要求します。未移行のブックは
   `ALLOW_LEGACY_EMAIL_CONFIG=true` を明示しない限り送信しません（フェイルクローズ）。
5. **週次レポートのスケジュール** — トリガーが `WEEKLY_REPORT_TIME` と曜日変更を無視していました。現在は設定から
   スケジュールを導出し、署名の比較で差分を検出して、管理対象トリガーのみを安全に再作成します。

あわせて管理指標の誤りを2件修正しました。`Health.staleDays` がしきい値オブジェクトを返していた点と、ダッシュボードが
健全性の低いすべてのプロジェクトを「日程不明」と数えていた点です。詳細は
[SECURITY_HARDENING.md](docs/checkgates/SECURITY_HARDENING.md)、
[AUTOMATION_HARDENING.md](docs/checkgates/AUTOMATION_HARDENING.md)、
[CORRECTNESS_HARDENING.md](docs/checkgates/CORRECTNESS_HARDENING.md) を参照してください。

セキュリティ上の前提と残存リスクは [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)、日次運用は
[docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) にまとめています。

## 機能と制約

プロジェクト、メンバー、スキル、タスク、担当割当、スケジュール、進捗、健全性と管理ビューを扱います。通知などの外部連携は明示的に有効化するまで動作させないでください。ローカルのモックテストは、本番環境の認可、共有権限、クォータ、トリガー実行、メール配信を保証しません。

管理UIは Google スプレッドシートのメニューと日本語サイドバーです。スプレッドシートの編集権限は管理者境界ではないため、V1.1 は信頼できる管理者のみの利用を前提とします。

Google Sheets のネイティブ Timeline は Workspace の契約・権限に依存します。利用できる場合は手動で作成し、利用できない場合は生成シート `GANTT_OVERVIEW` と `TIMELINE_DATA` を使用してください。

このリポジトリは新規実装です。旧プロトタイプは含まれていません。実測の本番性能、完全なリソース制約付きクリティカルパス計算、外部送信の exactly-once は保証していません。規模テストはモック上でのみ実施しています。

## 基本操作

開発環境で `createMember(data)` → `createProject(data)` → `createTask(data)` の順に作成し、戻り値の安定 ID を更新 API に渡します。`activateNotifications(actorEmail, 'ACTIVATE NOTIFICATIONS')` の後に `approveTaskAssignment(taskId, actorEmail, 'APPROVE ASSIGNMENT')` で割当を承認し、必要に応じて `confirmTaskSchedule(taskId, actorEmail, 'CONFIRM SCHEDULE')` で日程を確定します。メール送信には、別途 OFF/PREVIEW/LIVE の配信モードと機能別スイッチが必要です。

`updateTask(id, {Status: 'Done', Progress_Percent: 100})` で完了を記録します。メンバーを無効化する前に未完了タスクを再割当し、プロジェクトは削除せず `archiveProject(id)` で保管します。期限のみの割当は有効であり、開始日や見積を捏造しないでください。

`refreshManagement()` で進捗・健全性・ダッシュボード・作業負荷・スキルを更新できます。`PHASE_TEMPLATES` と `HOLIDAYS` を設定して `reversePlan(projectId, deadline)` を実行するとプロジェクト単位の逆算計画を作成します。不明な所要期間は `DRAFT` として確認してください。生成シートは更新で置き換わるため、手書きメモを保存しないでください。

## 本番運用

開発環境で検証 → コードと移行のレビュー → 制限された Drive バックアップの確認 → 本番へのコード反映 → 承認済み移行の実行 → データ確認、の順で進めます。通知と定期実行の有効化は、[本番チェックリスト](DEPLOYMENT.md) を完了してから行ってください。

変更時の必須ルールは [AGENTS.md](AGENTS.md)、リリース履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。
