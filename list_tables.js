const db = require('./db');
db.all("SELECT name FROM sqlite_master WHERE type='table'", (e, r) => console.log(r));
