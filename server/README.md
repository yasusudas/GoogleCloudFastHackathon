# レシート読み取りAPI

Node.js 22以上の組み込みモジュールだけで起動できる、ローカル開発用APIです。フロントエンドとは別プロセスです。

```sh
GEMINI_ENV_FILE=/absolute/path/to/private/gemini.env node server/index.mjs
```

秘密ファイルはリポジトリ外に置き、`GEMINI_API_KEY`を設定します。ブラウザ向けの`VITE_`環境変数には入れません。キー・画像・レシート本文をログに出しません。画像はメモリ内で処理し、サーバーには保存しません。

`GET /api/health`は設定有無だけを返します。

`POST /api/receipts/extract`は`application/json`の`{ mimeType, imageBase64 }`を受け取ります。JPEG/PNG/WebP、最大6MBです。`imageBase64`にdata URLの接頭辞を含めません。標準モデルは`gemini-3.8-flash`、`GEMINI_MODEL`で変更できます。

成功時は`{ receipt, warnings, computedSubtotal, computedTotal, requiresConfirmation: true, source: 'gemini', model }`です。`receipt`は`receipt.mjs`の`receiptSchema`に基づきます。店名や日付の空文字、金額のnullは不明を表し、利用者が確認・修正するまで確定しません。レシート合計と明細計算が一致しない場合は両方を維持し、警告します。

値引きは商品ごとの`discount`と未配賦の`receiptDiscount`を分けます。`additionalTax`は合計に加算すべき外税だけ、`taxAmount`はレシートに印字された税額です。内税の二重加算を避けます。

エラーは`{ error: { code, message } }`です。APIキーやGoogleの生エラーは返しません。CORSは開放せず、Viteなどの開発サーバーから`/api`を`http://127.0.0.1:8787`へプロキシしてください。外部公開用の認証・永続DBは含みません。

公式仕様：[GenerateContent API](https://ai.google.dev/api/generate-content)、[構造化出力](https://ai.google.dev/gemini-api/docs/structured-output)、[画像入力](https://ai.google.dev/gemini-api/docs/image-understanding)。
