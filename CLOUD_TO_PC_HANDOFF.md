# Cloud → PC Codex 引き継ぎ（COROS通知・強制再取り込み）

作成日: 2026-10-31（日本時間）

## PC側Codexへの依頼

この文書とCloud側のコード差分を確認し、PCの既存変更を保持して反映してください。
依存関係を更新し、APIサーバーとNext.jsを再起動した後、携帯の実機確認を進めてください。
実装・テスト・仕様書・このMDは `codex/coros-push-force-reimport` にコミットし、GitHubへpush済みです。
PC上のチェックアウト更新、依存更新、サーバー再起動、実機確認は未実施です。

- 引き継ぎMD: https://github.com/durotaxis/antigravity-next/blob/codex/coros-push-force-reimport/CLOUD_TO_PC_HANDOFF.md
- コミット履歴: https://github.com/durotaxis/antigravity-next/commits/codex/coros-push-force-reimport
- Cloudの当初基点: `42c500281f2e7d04cc0f3b10475e9529c3749665`
- 統合元のPCブランチ: `codex/coros-manual-receive-text`
- 保持したPC修正: `08fc3e72e0d9115d5c86a37078ef6eb52fdd9edd`（FIT保存ファイル名が活動IDと異なる場合の受理条件）
- 最新PCブランチを基点に、Cloud当初基点側の履歴・TODO・検証文書をmergeしてから今回の実装を収録。
- 共有ブランチの強制pushやmainへの直接pushは実施していません。

PCの既存変更を確認してから `git fetch origin` を実行し、公開ブランチを取り込んでください。
PCの同名ローカルブランチがなければ `git switch -c codex/coros-push-force-reimport --track origin/codex/coros-push-force-reimport` で確認できます。
既存ブランチへ統合する場合も、PC側の変更を破棄しないでください。
以前の `/workspace/cloud-coros-changes.patch` は公開前の古いスナップショットです。最新実装はGitHubの公開ブランチを使用してください。

## Gemini最新化との区別

今回Cloudで実装したのは通知機能とデバッグ用強制再取り込みです。Gemini SDK・モデル選択・呼び出し経路の最新化は今回実装していません。
既存の `gemini_service.js` と `@google/generative-ai` の依存をそのまま継承しています。
TODOの「Gemini APIの最新化」は未完了のままです。PC側の別作業で最新化した変更がある場合、このブランチに含まれるとはみなさず、その差分を別途確認して保持してください。

## ユーザーが確認済みの仕様

1. TODOの `.JIT` はCOROS `.FIT` を指す。
2. 「指定日のランを受信」を押した後、画面を閉じても操作した携帯へ結果を通知する。
3. デバッグ用の強制再取り込みは、指定日のFITをCOROSから再取得し、グラフ・集計・コメントを再生成して上書きする。完了時の携帯通知も送る。
4. 上記に合わせて仕様文書を更新する。

この範囲はユーザー確認済みです。同じ仕様の承認をもう一度取り直す必要はありません。

## 実装したこと

### 手動受信のWeb Push

- 手動受信欄に「受信通知を有効にする」「受信のテスト通知」を追加。
- 通知許可とPush購読を取得し、操作端末の通知IDを受信リクエストに付与。
- APIはサーバーで受信処理を続け、ページ切断後もWeb Pushを送信。
- FITだけのダウンロード完了ではなく、既存のRUN集計・コメント・ルート反映処理の結果を通知する。
- 正常終了、一部失敗、対象なし、受信処理全体の失敗を通知。結果には反映・取得済み・失敗件数を含める。
- 自動反映欄の従来通知は画面表示中の通知のまま。今回の手動受信通知は独立した設定。
- Service Workerにpushイベント処理を追加。通知タップでアプリを開く／フォーカスする。
- サーバー通知失敗で取り込み成功を取り消さない。画面の受信結果に通知送信エラーを表示。
- 404/410の期限切れ登録を削除。再有効化で登録し直せる。

通知API: `GET /api/coros-push`（公開鍵のみ）、JSON POSTの
`/api/coros-push/subscribe`、`/unsubscribe`、`/test`。
更新系はOriginのホスト名を検査。Push endpointはGoogle/Mozilla/Apple/Windowsに限定。

新規依存: `web-push`。VAPID鍵と端末購読情報は初回に生成し、
`data/coros/push/state.json` に保存。Git管理対象外に設定済み。
このファイルは秘密情報を含むため公開・コミットしないでください。再起動時は保持してください。
任意の `WEB_PUSH_SUBJECT` で連絡先URIを指定可能（例: `mailto:you@example.com`）。
`HTTPS_PROXY` があれば通知送信にも使用する。

### デバッグ用の強制再取り込み

- 手動受信欄の折りたたみ「デバッグ」に「指定日のランを強制再取り込み」を追加。
- POST `/api/coros-mcp/receive` のboolean `force: true` で実行。省略時は従来の通常受信。
- 指定日のRUNを再取得し、保存済み・同一FITでも既存apply処理を再実行する。
- 日別集計は既存のexact再計算、コメントは同じ活動IDへの上書き。数式・TCX処理は変更していない。
- COROS取得枠とコメント生成APIを消費することを画面に表示。既存の1回50件制限を継続。
- ダウンロード／FIT検証失敗時は古いFITとmetadataを保持し、他のRUNの処理を続ける。
- 取得・検証成功後のコメント生成失敗まで一括ロールバックする機能は追加していない。既存の部分保存・再試行の動作を引き継ぐ。
- 同じ携帯通知経路を使用する。処理中・未接続・日付なしではボタン無効。

## 主な変更ファイル

- `coros_push_notifications.js` / `.test.js`: Push購読・鍵の永続化、通知API、送信、結合テスト（新規）。
- `coros_direct_mcp.js` / `.test.js`: 手動受信結果のPushとforce再取得、通常受信の回帰テスト。
- `index.js`: Pushサービスとルーターを登録。
- `client/app/components/CorosReceiveNotifications.tsx`: 手動受信の通知設定UI（新規）。
- `client/app/components/CorosDirectReceive.tsx`: 通知ID・force送信、デバッグボタン。
- `client/public/coros-import-notifications-sw.js`: バックグラウンドpush受信。
- `client/tests/corosPushWorker.test.cjs`: ウィンドウなしの通知表示検証（新規）。
- `package.json` / `package-lock.json` / `.gitignore`: 依存と秘密情報の除外。
- `NEW_SCREEN_SPEC.md` / `COROS_DIRECT_MCP.md` / `TODO.md`: 仕様・操作手順・完了状況。

## Cloudでの検証結果

- 関連サーバーテスト6スイート・57件すべて成功。
- 通知のクライアントテスト2ファイル成功（既存の通知カーソル処理と新規push受信）。
- 変更した2つの画面コンポーネントの単独TypeScriptチェックとESLint成功。
- サーバーJSの構文検査と `git diff --check` 成功。
- プロジェクト全体のTypeScriptチェックは既存の `client/app/EfficiencyChart.tsx` の2件で失敗。
  209行のLegend `payload`、234行のReferenceDot `isFront` が型定義に存在しない。今回このファイルは変更していない。
- 実COROSへの再取得、実Geminiでのコメント再生成、実際の携帯へのPush到達はCloudでは未確認。
  テストではCOROS・Push送信先を代替し、ページのHTTP接続切断後も処理・送信が続くことを検証済み。

再実行コマンド（リポジトリルート。WindowsではNODE_OPTIONSの設定方法をシェルに合わせる）:

```sh
NODE_OPTIONS=--experimental-vm-modules npm test -- --runInBand coros_push_notifications.test.js coros_direct_mcp.test.js coros_import_completions.test.js coros_auto_import.test.js coros_fit_importer.test.js coros_fit_sync_store.test.js
node --test client/tests/corosImportNotifications.test.cjs client/tests/corosPushWorker.test.cjs
```

## PC側で残る確認

1. 上記GitHubブランチをPCへ取り込み、`npm ci` と `npm ci --prefix client` で依存を揃える。
2. 既存の起動方法でAPIサーバーとNext.jsを再起動する。
3. 携帯からページとAPIに信頼されたHTTPSでアクセスできることを確認する。
4. PCから携帯のPushサービスへHTTPS送信できることを確認する。Cloudの通信許可設定はPCへ引き継がれない。
5. 携帯の手動受信欄で通知を有効化し、テスト通知の実到達を確認する。
   iPhone/iPadはiOS/iPadOS 16.4以降でホーム画面へ追加したアプリを使う。
6. 通常受信を開始して画面を閉じ、完了通知と結果を確認する。サーバーは起動したままにする。
7. ユーザーが指定した日付で強制再取り込みを1回実行し、再取得・グラフ・集計・コメント・通知を確認する。
   この操作はデータを上書きしAPI枠を消費するので、無関係な日付で試さない。
8. 続けて通常受信し、取り込み済みがスキップされることを確認する。

PushはOSの制限・ブラウザー強制終了・回線状態で遅延し得る。サーバー停止をまたぐ受信ジョブの再開や、送信失敗通知の永続リトライキューは今回の実装範囲外。
