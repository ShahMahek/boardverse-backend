import { Response } from "express";
import { poolPromise } from "../config/database";
import sql from "mssql";
import { AuthRequest } from "../middleware/auth.middleware";

export const getSessions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT *
        FROM ChatSessions
        WHERE UserId = @userId
        ORDER BY CreatedAt DESC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
};

export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = Number(req.params.id);
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("sessionId", sql.Int, sessionId)
      .query(`
        SELECT *
        FROM ChatMessages
        WHERE SessionId = @sessionId
        ORDER BY CreatedAt ASC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};