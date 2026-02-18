# 画像から数値を抽出してCSVに出力するツール

このツールは、画像ファイルから数値を抽出し、CSVファイルとして出力します。

## 必要なソフトウェア

### 1. Python 3.7以上

Pythonがインストールされているか確認：
```bash
python --version
```

インストールされていない場合は、[公式サイト](https://www.python.org/downloads/)からダウンロードしてください。

### 2. Tesseract OCR

#### Windows
1. [Tesseract-OCR Windows installer](https://github.com/UB-Mannheim/tesseract/wiki)から最新版をダウンロード
2. インストーラーを実行（推奨インストールパス: `C:\Program Files\Tesseract-OCR`）
3. **重要**: インストール時に「Additional language data」で日本語（Japanese）を選択
4. 環境変数にTesseractのパスを追加：
   - システム環境変数の編集を開く
   - `Path`に `C:\Program Files\Tesseract-OCR` を追加
   - または、Pythonコードで直接指定：
     ```python
     pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
     ```

#### macOS
```bash
brew install tesseract
brew install tesseract-lang  # 日本語含む追加言語
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install tesseract-ocr tesseract-ocr-jpn
```

確認：
```bash
tesseract --version
```

## セットアップ

1. このディレクトリに移動：
```bash
cd tools/image_to_csv
```

2. Pythonパッケージをインストール：
```bash
pip install -r requirements.txt
```

## 使い方

### 基本的な使い方

```bash
# 単一の画像から数値を抽出
python extract_numbers.py image.png -o output.csv

# 複数の画像から数値を抽出
python extract_numbers.py image1.png image2.jpg image3.bmp -o output.csv

# ディレクトリ内の全ての画像から数値を抽出
python extract_numbers.py ./images/ -o output.csv

# 複数のディレクトリと画像を組み合わせ
python extract_numbers.py ./images/ single_image.png -o output.csv
```

### オプション

- `-o, --output`: 出力CSVファイル名（デフォルト: `numbers.csv`）
- `-l, --language`: OCRの言語設定（デフォルト: `jpn+eng`）
  - 日本語のみ: `jpn`
  - 英語のみ: `eng`
  - 日本語+英語: `jpn+eng`
  - その他の言語: Tesseractでインストールした言語コード

### 例

```bash
# 日本語+英語で処理（デフォルト）
python extract_numbers.py invoice.png -o invoice_numbers.csv

# 英語のみで処理
python extract_numbers.py report.jpg -o report.csv -l eng

# ディレクトリ内の全画像を処理
python extract_numbers.py ./screenshots/ -o all_numbers.csv
```

## 出力形式

CSVファイルには以下の列が含まれます：

| 列名 | 説明 |
|------|------|
| ファイル名 | 元の画像ファイル名 |
| 元のテキスト | OCRで抽出されたテキスト行 |
| 抽出した数値 | テキストから抽出された数値（カンマ除去済み） |

### 出力例

```csv
ファイル名,元のテキスト,抽出した数値
receipt.png,合計金額: 1,234円,1234
receipt.png,税額: 123円,123
report.jpg,売上: 5,678,901円,5678901
report.jpg,利益率: 12.5%,12.5
```

## サポートしている画像形式

- PNG (.png)
- JPEG (.jpg, .jpeg)
- BMP (.bmp)
- TIFF (.tiff)
- GIF (.gif)

## トラブルシューティング

### Tesseractが見つからない

**Windows**:
```python
# extract_numbers.pyの先頭に以下を追加
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
```

### 日本語が認識されない

1. Tesseractの日本語言語データがインストールされているか確認：
```bash
tesseract --list-langs
```

2. 日本語（`jpn`）がリストにない場合は、言語データをインストール：
   - Windows: Tesseractを再インストールし、日本語を選択
   - macOS: `brew install tesseract-lang`
   - Linux: `sudo apt install tesseract-ocr-jpn`

### 認識精度が低い

- 画像の解像度を上げる（300 DPI以上推奨）
- 画像のコントラストを調整
- テキスト部分を拡大してからOCRを実行
- 画像の傾きを補正

## ライセンス

MIT License

## API Compatibility Notes

`extract_numbers.py` now outputs both legacy columns and API-compatible columns.

- Legacy columns:
  - `file_name`, `run_date`, `run_time_range`, `steps`, `active_time`, `distance_km`, `heart_rate_bpm`, `pace_per_km`
- API-compatible columns:
  - `date`, `step_count`, `total_distance_km`, `total_time`
  - `avg_heart_rate`, `max_heart_rate`
  - `avg_speed`, `max_speed`
  - `avg_stride_cm`, `max_stride_cm`
  - `avg_cadence`, `max_cadence`

Notes:
- `max_*` fields may be blank when screenshots do not expose reliable maxima.
- `avg_speed` is derived from `pace_per_km` when available.
- `avg_stride_cm` and `avg_cadence` are derived from distance/steps/time when possible.

## Module Structure

OCR batch logic has been split into reusable modules.

- `extract_numbers.py`
  - CLI entrypoint and orchestration only.
- `ocr_adapter.py`
  - Tesseract call, image preprocess, OCR text normalization.
- `parser.py`
  - Extracts raw fields from OCR text (date, steps, distance, pace, etc.).
- `metrics_builder.py`
  - Converts parsed fields into API-compatible metrics (`avg_stride_cm`, `avg_cadence`, etc.).
- `io_utils.py`
  - Image collection and CSV writing.
- `models.py`
  - `RunMetrics` dataclass and CSV schema.
