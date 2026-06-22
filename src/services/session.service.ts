import sql from "mssql";
import { poolPromise } from "../config/database";

export const getOrCreateSession = async (userId: number): Promise<number> => {
  const pool = await poolPromise;

  const existingSession = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT TOP 1 *
      FROM ChatSessions
      WHERE UserId = @userId
      AND ExpiresAt > GETDATE()
      ORDER BY CreatedAt DESC
    `);

  if (existingSession.recordset.length > 0) {
    return existingSession.recordset[0].Id;
  }

  const newSession = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query(`
      INSERT INTO ChatSessions (UserId, ExpiresAt)
      OUTPUT INSERTED.Id
      VALUES (@userId, DATEADD(HOUR, 24, GETDATE()))
    `);

  return newSession.recordset[0].Id;
};

export const updateSessionTitle = async (sessionId: number, title: string) => {
  const pool = await poolPromise;
  await pool
    .request()
    .input("title", sql.NVarChar(100), title.slice(0, 100))
    .input("sessionId", sql.Int, sessionId)
    .query(`
      UPDATE ChatSessions 
      SET Title = @title 
      WHERE Id = @sessionId AND Title IS NULL
    `);
};

export const createNewSession = async (userId: number): Promise<number> => {
  const pool = await poolPromise;
  const newSession = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query(`
      INSERT INTO ChatSessions (UserId, ExpiresAt)
      OUTPUT INSERTED.Id
      VALUES (@userId, DATEADD(HOUR, 24, GETDATE()))
    `);
  return newSession.recordset[0].Id;
};