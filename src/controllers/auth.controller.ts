import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { executeQuery } from "../services/database.service";
import sql from "mssql";
import { poolPromise } from "../config/database";
import { AuthRequest } from "../middleware/auth.middleware";

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await executeQuery(
      `SELECT * FROM Users WHERE Email=@email`,
      [{ name: "email", value: email }]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await executeQuery(
      `INSERT INTO Users (Username, Email, PasswordHash) VALUES (@username, @email, @password)`,
      [
        { name: "username", value: username },
        { name: "email", value: email },
        { name: "password", value: hashedPassword },
      ]
    );

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Registration failed" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const users = await executeQuery(
      `SELECT * FROM Users WHERE Email=@email`,
      [{ name: "email", value: email }]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = users[0];

    const isValid = await bcrypt.compare(password, user.PasswordHash);

    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.Id, email: user.Email },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );

    res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed" });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const pool = await poolPromise;

    await pool
      .request()
      .input("userId", sql.Int, userId)
      .query(`UPDATE ChatSessions SET ExpiresAt = GETDATE() WHERE UserId = @userId`);

    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
};