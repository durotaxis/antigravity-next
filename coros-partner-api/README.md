# COROS Partner API 接続準備

確認日: 2026-09-08

通常の COROS Partner API を直接呼び出すための準備資料です。現時点では API クライアントや OAuth コールバックサーバーは未実装で、直接取得は未検証です。

## 現在わかっていること

- 既存の `tools/coros_sync_runner.js` は、エージェントが MCP を呼び出し、その結果をローカルへ保存する構成です。
- 既存の `coros_mcp_server.js` はローカル FIT データの読み出し用で、Partner API の認証クライアントではありません。
- 確認したプロセス環境変数とワークスペース直下 `.env` に COROS 名の設定キーはありませんでした。別の場所での発行・保管の有無は未確認です。
- このフォルダーは既存サーバー、DB、FIT 自動取り込み、MCP 同期から独立しています。

## 発行済みの場合

1. `config.example.json` を同じフォルダーの `config.local.json` にコピーします。
2. 発行された Client ID、Client Secret、COROS に登録した正確なリダイレクト URI を記入します。
3. COROS から受領した最新 API リファレンスを `private` フォルダーに置き、`apiReferencePath` にそのファイルパスを記入します。
4. 次の確認コマンドを実行します。通信せず、設定値や秘密情報を表示せず、入力の有無と参照ファイルの存在を確認します。

```powershell
node C:\Users\yuji_\Downloads\coros-partner-api\check-config.cjs
```

`config.local.json`、`private`、`output` はこのフォルダーの `.gitignore` で除外しています。これは暗号化ではありません。Client Secret やトークンはチャットや申請メールに貼らないでください。

## 未発行の場合

公式案内では、既存ユーザーベースを持つプラットフォーム、登録企業、技術担当者等が要件です。個人用途での直接 API 検証を受け付けるかは確認が必要です。

`inquiry-draft.txt` に用途確認メールの下書きを用意しました。未確認の所属・利用者数を埋めたことにせず、実際の状況に合わせて編集してください。送信・申請はしていません。

正式申請には会社・プラットフォーム情報、技術連絡先、OAuth リダイレクト URI が必要です。ローカルの HTTP / loopback URI が認められるかは確認できていないため、仮の URI は登録していません。

## 認証情報と詳細資料がそろった後の作業

1. 公式資料の認可 URL、トークン交換・更新方法、必要パラメーター、レスポンス形式を確認して OAuth 接続を実装する。
2. ユーザー本人がブラウザーで認可する。
3. `getUserInfo`、短い日付範囲の `getWorkoutRecords` と `getDailyData`、運動1件の `getWorkoutDetailFit` を読み取りテストする。
4. JSON / FIT の実データと取得項目を確認し、必要な検証出力はこのフォルダー内の `output` に保存する。

公開概要では運動一覧は最大30日分・過去3か月までです。日次データにも同じ制約があるとは仮定せず、詳細資料で確認します。API の機能名だけから URL・認証ヘッダー・単位を推測して実装しません。

既存アプリへの取り込みや `daily_summary` 更新は今回の準備に含めません。その変更を行う場合は、ワークスペースの AGENTS.md に従って仕様を確認します。

## 公式資料

- [Partner API の要件・機能](https://support.coros.com/hc/en-us/articles/53181766856724-Partner-API-Access)
- [申請案内とフォームへのリンク](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application)
- 申請・問い合わせ先: api@coros.com
