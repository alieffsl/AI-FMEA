const { Client } = require('pg');
require('dotenv').config({path: 'c:/AI FMEA/migration/.env'});
const client = new Client({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: false
});
client.connect()
  .then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fmea_knowledge_base'"))
  .then(res => console.log(res.rows.map(r => r.column_name)))
  .finally(() => client.end());
