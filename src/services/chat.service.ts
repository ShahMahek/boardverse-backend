import sql from "mssql";
import { poolPromise } from "../config/database";

export const saveMessage = async (
  sessionId: number,
  role: string,
  message: string,
  source: string | null = null
) => {
  const pool = await poolPromise;

  await pool
    .request()
    .input("sessionId", sql.Int, sessionId)
    .input("role", sql.NVarChar, role)
    .input("message", sql.NVarChar(sql.MAX), message)
    .input("source", sql.NVarChar, source)
    .query(`
      INSERT INTO ChatMessages (SessionId, Role, Message, ResponseSource)
      VALUES (@sessionId, @role, @message, @source)
    `);
};

export const getSessionMessages = async (sessionId: number) => {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("sessionId", sql.Int, sessionId)
    .query(`
      SELECT TOP 10 Role, Message
      FROM ChatMessages
      WHERE SessionId = @sessionId
      ORDER BY CreatedAt DESC
    `);

  return result.recordset.reverse();
};