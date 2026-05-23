import { chmodSync } from 'node:fs'
chmodSync('dist/bin/mav.js', 0o755)
