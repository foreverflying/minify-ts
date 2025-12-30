#!/bin/sh

set -ex

rm -rf ./min/* ./lib/*
npx tsc --build tsconfig.json
node --import=bye-esm-ext src/cli.ts -o ./src ./min/src index.ts cli.ts
cp tsconfig.json ./min && npx tsc -p ./min

mkdir -p lib
npx rollup -c
sed -i '1i #!/usr/bin/env node' lib/cli.min.js
npx dts-bundle-generator ./min/src/index.ts -o lib/index.d.ts