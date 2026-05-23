import { chmodSync, copyFileSync } from 'node:fs'
chmodSync('dist/bin/mav.js', 0o755)
// dist/bin/mav.js resolves package.json as ../package.json → dist/package.json
copyFileSync('package.json', 'dist/package.json')
