# bvcxdrtvgf.github.io

## Firebaseオンライン対戦の有効化

オンライン対戦はFirebase Authenticationの匿名ログインとRealtime Databaseを使います。

1. Firebase ConsoleでAuthenticationの「匿名」ログインを有効にします。
2. Realtime Databaseを作成します。
3. Realtime Databaseの「ルール」に[`database.rules.json`](./database.rules.json)の内容を設定して公開します。未認証アクセスを許可するルールには変更しないでください。
4. Authenticationの設定で、GitHub Pagesのドメインを承認済みドメインに追加します。

対戦は6桁の部屋コードを共有して参加します。ホストと参加者は同じ配札を別々にプレイし、先にクリアした側を勝者として表示します。これはクライアント間のカジュアル対戦であり、不正な勝利報告を完全に防ぐサーバー検証はありません。