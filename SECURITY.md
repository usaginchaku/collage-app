# セキュリティ

このアプリは静的な画像編集ツールです。ログイン、サーバー側の画像保管、投稿API、APIキーはありません。画像はブラウザ内で処理し、編集途中はIndexedDBに保存します。GitHubへのページ取得通信と、利用者が明示的に操作したダウンロード・OS共有は発生します。

## 実装した対策

- **入力画像**: 拡張子やMIME申告を信用せず、PNG・JPEG・WebP・GIF・AVIF・HEIFのヘッダーと寸法を確認。ファイル50MB、元画像6000万画素・一辺32768pxを上限に、境界外読み取りや複雑すぎるボックス構造を拒否します。画像としてデコードした後も寸法を確認し、4096px・800万画素以内へ再描画・再エンコードします。SVG・HTMLは取り込みません。背景画像も同じ経路です。形式のシグネチャだけで安全と判定しているわけではありません。
- **保存データ**: 数値の型・有限値・範囲、列挙値、文字数、ID重複、画像参照、枠の重なりを検証し、既知のフィールドだけ復元。保存画像も再検証します。不正・破損した下書きは上書きせず自動保存を停止し、明示的な「新しく作る」まで元データを保持します。編集と完成画像のダウンロードは続けられます。
- **スクリプトと通信**: CSPは既定で全リソースを拒否し、自身のスクリプト・CSS・画像とローカルBlob画像だけを許可。インラインスクリプト、イベント属性、eval、外部画像・スクリプト、fetch等の接続、フレーム、Worker、フォーム送信を拒否します。ユーザーの名前・文字列はHTMLとして評価しません。外部CDN・解析・広告は使いません。
- **埋め込み**: iframe内ではエディターを読み込まず、下書きを開きません。新規ウィンドウのopenerを切り離します。これはアプリレベルの追加対策であり、HTTPヘッダーによるフレーム拒否と同等ではありません。
- **公開物**: 許可リストの11ファイルだけを配信。シンボリックリンクや想定外の出力ファイルはビルドで拒否します。秘密情報の典型的なパターンとローカルパスも検査します。この検査は既存パターンへの一致検査であり、あらゆる秘密情報を検出する保証ではありません。
- **公開処理**: 構文、セキュリティ設定、単体・ブラウザテスト、依存関係監査を通過してから配信。公式ActionsをコミットSHAで固定し、チェックアウト時の認証情報を保存しません。検証ジョブは読み取りのみ、配信ジョブだけPagesとOIDCの権限を持ちます。外部PRからは配信しません。Dependabotの週次更新と脆弱性修正PRを利用し、自動マージはしません。
- **開発用サーバー**: 127.0.0.1でのみ待ち受け、Hostを検証。GET/HEADと許可されたパスのみを受付け、プライベートファイル・書き込み・パストラバーサルを拒否します。CSP、frame-ancestors、X-Frame-Options、nosniff、権限制限などのHTTPヘッダーを付けます。

## 配信環境と残る境界

- 本番はGitHub PagesのHTTPS強制を利用。Pagesの現在の配信ではアプリ側から任意のHTTPレスポンスヘッダーを設定できないため、CSPとReferrer-PolicyはHTMLのmetaで適用します。開発用サーバーのヘッダーが本番にも存在すると解釈しないでください。特に `frame-ancestors` はmetaでは有効になりません。
- **同じ `https://usaginchaku.github.io` 上の別アプリとは、IndexedDB等のブラウザ保存領域のオリジンを共有します。** URLのパスやデータベース名ではアクセスを分離できません。他のアプリまで含めた完全な分離には、専用ドメイン／サブドメイン等の別オリジンへの移転が必要です。移転ではURLと下書きの扱いが変わるため、今回の更新では実施していません。
- GitHubアカウント自体、管理権限、端末や拡張機能が侵害された場合までは、アプリのCSPでは保護できません。GitHubの2要素認証・パスキーの設定状況は取得したAPIからは確認できていません。アカウント設定や認証情報は変更していません。
- 画像デコーダー・ブラウザ・配信基盤の未知の脆弱性、全ての負荷攻撃を防ぐ保証ではありません。ブラウザの更新は必要です。下書きはブラウザの保存領域にあり、アプリ独自の暗号化・端末間同期・バックアップはありません。

## 検証・報告

検証記録は [docs/VERIFICATION.md](docs/VERIFICATION.md)。安全性は検証した範囲の結果であり、第三者による侵入テストやiPhone実機の確認を受けたものではありません。

問題を報告するときは、再現手順・ブラウザ・影響範囲を添えてください。公開Issueには秘密情報・個人の写真・下書きの実データを添付しないでください。

参照: [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)、[OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)、[MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)、[MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)、[GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。確認日: 2026-10-17。
