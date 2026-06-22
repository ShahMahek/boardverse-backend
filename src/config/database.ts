import * as sql from "mssql";

const dbConfig = {
  server: process.env.DB_SERVER!,
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  port: Number(process.env.DB_PORT),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

export const poolPromise = sql.connect(dbConfig);

export const connectDB = async () => {
  try {
    await sql.connect(dbConfig);
    console.log("✅ SQL Database Connected");
  } catch (error) {
    console.error("❌ Database Connection Failed");
    console.error(error);
  }
};

export default sql;