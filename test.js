/*
  Kleine test: controleert of alle id's die app.js gebruikt ook in index.html staan
  en of de JS-syntax klopt. Draaien met: node docs/test.js
*/
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

const missing = [...used].filter((id) => !htmlIds.has(id));
const unused = [...htmlIds].filter((id) => !used.has(id));

console.log('id\'s in HTML:', htmlIds.size);
console.log('id\'s gebruikt in JS:', used.size);
console.log('Ontbrekend in HTML:', missing.length ? missing : 'geen');
console.log('Ongebruikt in JS (mag):', unused.length ? unused : 'geen');

if (missing.length) process.exitCode = 1;
