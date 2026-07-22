# COROS to Run Comment

- `inbox/`: 新規または更新されたRUNの `run_<activityId>.json` を配置する取込フォルダ
- `state/coros-sync-state.json`: COROS同期タスクが処理済みアクティビティを判定するための状態ファイル
- `processed/`: Run Comment側で取込済みのJSONを保持するフォルダ

定期タスクはCOROSのRUNを確認し、新規または内容が変わったアクティビティのJSONを `inbox` に保存します。同じファイル名は上書きして構いません。

取込JSONには `date` と `activityId` が必要です。ファイル名は `run_<activityId>.json` とし、JSON内の `activityId` と一致させます。受信JSONに `message` が含まれていても使用しません。

サーバーは起動時と30秒ごとに `inbox` を確認します。アクティビティ情報からローカルのGemini呼び出しでRun Commentを生成し、同日の `run_messages` を上書きします。実際に使用したモデルはコンソールと処理済みJSONの `model` に記録します。

取込に成功したJSONには、生成した `message`、`generatedBy: "local_gemini"`、`model`、`generatedAt` を追加して `processed` へ移動します。生成または保存に失敗したJSONは再試行できるよう `inbox` に残します。

同日のランカードがまだ存在しない場合は、`inbox` のCOROS JSONを取り込む時に限り、距離、時間、カロリー、平均心拍、平均ピッチ、平均ストライドからカードを作成します。`processed` は取込済み原本の保管場所であり、削除済みカードの再作成には使用しません。
