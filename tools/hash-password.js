// Prints a bcrypt hash for ADMIN_PASS_HASH: node tools/hash-password.js 'my-password'
const bcrypt = require('bcryptjs');

const pass = process.argv[2];
if (!pass || pass.length < 8) {
  console.error('Usage: node tools/hash-password.js <password of 8+ characters>');
  process.exit(1);
}
console.log(`ADMIN_PASS_HASH='${bcrypt.hashSync(pass, 12)}'`);
