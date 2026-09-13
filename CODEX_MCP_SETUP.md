# CODEX × COROS MCP セットアップガイド

OpenAI API の制限回避のため、COROS ローカルデータを MCP 経由で直接アクセスするようにセットアップします。

## ステップ 1: MCP サーバーの確認

MCP サーバーファイル: [coros_mcp_server.js](./coros_mcp_server.js)

このファイルが `C:\Users\yuji_\Downloads\` にあることを確認してください。

## ステップ 2: CODEX の MCP 設定

CODEX の設定ファイルを開きます：

**場所**: `C:\Users\yuji_\.codex\mcp_config.json`

ファイルが既に生成されています。内容を確認してください：

```json
{
  "mcpServers": {
    "coros": {
      "command": "node",
      "args": [
        "C:\\Users\\yuji_\\Downloads\\coros_mcp_server.js",
        "C:\\Users\\yuji_\\Downloads\\data\\coros"
      ],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=512"
      }
    }
  }
}
```

**パスが正しいか確認してください。**

## ステップ 3: MCP サーバーを起動（テスト用）

ターミナルで以下を実行：

```bash
npm run mcp:coros
```

以下のようなログが出ればOK：

```
[COROS MCP] Server starting on stdio transport
[COROS MCP] Data directory: C:\Users\yuji_\Downloads\data\coros
```

**Ctrl+C で停止してください。**（CODEX が起動時に自動で起動します）

## ステップ 4: CODEX の自動化設定

CODEX の自動化エディタで、以下のように MCP を参照できるようになります：

### 使用可能な MCP ツール

#### 1. `get_todays_runs` - 今日のラン一覧取得

```javascript
// 今日のラン情報を取得
const runs = await mcp.call('coros', 'get_todays_runs');
console.log(`本日のラン数: ${runs.runCount}`);
console.log(runs.summary);
```

#### 2. `get_run_summary` - ラン詳細情報取得

```javascript
// 特定のランの詳細情報を取得
const summary = await mcp.call('coros', 'get_run_summary', {
  date: '2026-08-14',
  labelId: '12345'
});

console.log(`距離: ${summary.distance} km`);
console.log(`平均心拍: ${summary.averageHeartRate} bpm`);
console.log(`カロリー: ${summary.calories} kcal`);
```

#### 3. `get_run_intraday_data` - 分単位データ取得

```javascript
// 1分ごとの詳細データを取得（最大120分まで）
const intraday = await mcp.call('coros', 'get_run_intraday_data', {
  date: '2026-08-14',
  labelId: '12345'
});

console.log(`データポイント数: ${intraday.dataPointCount}`);
intraday.chartData.forEach((point, i) => {
  console.log(`${i+1}分: ${point.speed}km/h, HR ${point.heartRate}bpm`);
});
```

## ステップ 5: オートメーションの実装例

### 例：今日のラン実行直後に自動解析

CODEX の自動化ルール：

```yaml
trigger: 時刻 09:00
action: |
  const runs = await mcp.call('coros', 'get_todays_runs');
  
  if (runs.runCount > 0) {
    const latestRun = runs.runs[0];
    const summary = await mcp.call('coros', 'get_run_summary', {
      date: runs.date,
      labelId: latestRun.labelId
    });
    
    // Gemini で分析
    const analysis = await gemini.analyze(summary);
    
    // メモリに保存
    saveToMemory('latest-run-analysis', analysis);
  }
```

## 何が変わったのか？

| 項目 | OpenAI 依存時 | MCP 直結時（新） |
|------|-------------|-------------|
| ラン情報取得 | OpenAI API 経由 | ローカルファイル直接読み込み |
| OpenAI API 呼び出し | 毎回必要 | 不要 |
| レイテンシ | 1-3秒 | <100ms |
| 通信容量 | 多い | ほぼゼロ |
| 依存性 | OpenAI サーバー状態に左右 | ローカルなので独立 |

## トラブルシューティング

### MCP サーバーが起動しない

```bash
# デバッグモードで起動
node coros_mcp_server.js "C:\Users\yuji_\Downloads\data\coros"
```

エラーメッセージを確認してください。

### COROS データが見つからない

```bash
# データディレクトリが存在するか確認
dir C:\Users\yuji_\Downloads\data\coros
```

`metadata/`, `intraday/`, `route/` ディレクトリが必要です。

### CODEX が MCP に接続できない

1. パス区切り文字を `\\` で転義しているか確認
2. Node.js がインストール済みか確認：`node --version`
3. ファイアウォール設定を確認（stdio は localhost のみ）

## 次のステップ

- CODEX で自動化ルールを設定して、ラン後の自動分析を実装
- Gemini AI との連携で詳細な走行分析を追加
