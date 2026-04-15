const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

if (process.env.HIPPO_SKIP_POSTINSTALL === '1') {
  process.exit(0);
}

const distPostinstall = path.join(__dirname, '..', 'dist', 'postinstall.js');
if (!fs.existsSync(distPostinstall)) {
  process.exit(0);
}

import(pathToFileURL(distPostinstall).href).catch(() => {
  process.exit(0);
});
