import {createRequire} from "node:module";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV==="production")
  throw new Error("Development workspace only.");
const require=createRequire(new URL("../lib/db/package.json",import.meta.url));
const {Pool}=require("pg");
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
  await pool.query("ALTER TABLE notification_devices ADD COLUMN IF NOT EXISTS apns_environment text");
  console.log("Development device environment column ready; no sends or secret changes.");
} finally {await pool.end();}
