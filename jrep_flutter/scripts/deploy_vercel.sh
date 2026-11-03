#!/usr/bin/env bash
# Flutter Web をビルドして Vercel（プロジェクト jrep-app）にデプロイする。
# Vercel 上には Flutter SDK が無いため、ローカルでビルドした build/web をそのままアップロードする。
# 初回のみ事前に `npx vercel@62.0.0 login` を実行しておくこと。
set -euo pipefail
cd "$(dirname "$0")/.."

VERCEL="npx --yes vercel@62.0.0"
PROJECT="jrep-app"

flutter build web --release --base-href /

cd build/web
$VERCEL link --yes --project "$PROJECT"
$VERCEL deploy --prod --yes
