# Engineering-HUB

Google スプレッドシートをデータベース、Google Apps Script をアプリケーション、GitHub をソースコードの履歴管理に使用する、エンジニアリング向けのプロジェクト管理システムです。

[English](README.md) · [設計](ARCHITECTURE.md) · [データ構造](DATA_SCHEMA.md) · [デプロイ](DEPLOYMENT.md) · [バックアップと復元](BACKUP_RESTORE.md)

## 最初に確認すること

- 開発用と本番用は、Apps Script プロジェクトもスプレッドシートも分離してください。
- コードの push はデータ移行ではありません。Git ではセルの内容、Drive ファイル、Script Properties、トリガーを復元できません。
- 初期化は、明示的に指定した空のブックに限ります。既存データには、レビュー済みで明示的に承認したマイグレーションを使用します。
- 初期状態ではメール・Calendar 連携は無効、dry-run は有効です。
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

## 機能と制約

プロジェクト、メンバー、スキル、タスク、担当割当、スケジュールと管理ビューを扱います。通知などの外部連携は明示的に有効化するまで動作させないでください。

Google Sheets のネイティブ Timeline は Workspace の契約・権限に依存します。利用できる場合は手動で作成し、利用できない場合は通常のタスク・スケジュールシートを使用してください。

このリポジトリは新規実装です。旧プロトタイプは含まれていません。ローカルのモックテストは、本番環境の認可、共有権限、クォータ、トリガー実行、メール配信を保証しません。実測の本番性能、完全なリソース制約付きクリティカルパス計算、外部送信の exactly-once は保証していません。

## 基本操作

開発環境で `createMember(data)` → `createProject(data)` → `createTask(data)` の順に作成し、戻り値の安定 ID を更新 API に渡します。日程・見積・担当者を確認して `approveTaskAssignment(taskId)` を実行します。メール送信には、別途通知の有効化・承認・ドメイン制限などの条件が必要です。

`updateTask(id, {Status: 'Done', Progress_Percent: 100})` で完了を記録します。メンバーを無効化する前に未完了タスクを再割当し、プロジェクトは削除せず `archiveProject(id)` で保管します。

`refreshDashboard()`、`refreshWorkload()` で管理ビューを更新できます。`PHASE_TEMPLATES` と `HOLIDAYS` を設定して `reversePlan(projectId, deadline)` を実行すると逆算計画を作成します。不明な所要期間は `DRAFT` として確認してください。生成シートは更新で置き換わるため、手書きメモを保存しないでください。実行可能な開発用サンプルは [English README](README.md#typical-development-workflow) を参照してください。

## 本番運用

開発環境で検証 → コードと移行のレビュー → 制限された Drive バックアップの確認 → 本番へのコード反映 → 承認済み移行の実行 → データ確認、の順で進めます。通知と定期実行の有効化は、[本番チェックリスト](DEPLOYMENT.md) を完了してから行ってください。

変更時の必須ルールは [AGENTS.md](AGENTS.md)、リリース履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。
