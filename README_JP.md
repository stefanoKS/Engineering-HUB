# Engineering-HUB

Google スプレッドシートをデータベース、Google Apps Script をアプリケーション、GitHub をソースコードの履歴管理に使用する、エンジニアリング向けのプロジェクト管理システムです。

[English](README.md) · [設計](ARCHITECTURE.md) · [データ構造](DATA_SCHEMA.md) · [デプロイ](DEPLOYMENT.md) · [バックアップと復元](BACKUP_RESTORE.md) · [管理者向け手順](docs/MANAGER_WORKFLOW.md) · [自動化設定](docs/AUTOMATION_SETTINGS.md) · [Workspace実機確認](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md)

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
- **ロール:** `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`。検証済みの Google アカウントから判定します。移行直後の空欄ロールは `VIEWER` として扱うため、管理者が明示的に設定してください。
- **逆算計画** はプロジェクト単位で `PROJECT_PHASES` に版管理して保存します。あるプロジェクトの再計画が他プロジェクトの計画を置き換えることはありません。
- **信頼性:** 送信前に `PENDING` を記録し、配信不確定の通知を自動再送しません。管理作業で `DELIVERY_UNCERTAIN` に整理でき、プレビューは本番の重複防止キーを消費しません。

ゲートごとの証跡は [docs/checkgates](docs/checkgates/GATE_1.md)、Google Workspace 実機確認の手順は
[docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) にあります。実機確認は本リポジトリでは実施していません。

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
