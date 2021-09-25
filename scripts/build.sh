#!/usr/bin/env sh

rm -rf .build-temp/
rm -rf dist/ 
mkdir -p dist/
npx rollup -c vv.rollup.config.js
cat .build-temp/vv.bundle.bang.js src/bang.js > src/cat.bang.js
rm .build-temp/vv.bundle.bang.js
npx webpack -c webpack.config.js
rm src/cat.bang.js
cp .build-temp/bang.js docs/bang.js
cp .build-temp/bang.js 7guis/bang.js


