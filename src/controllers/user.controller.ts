import { Request, Response } from "express";
import { executeQuery } from "../services/database.service";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await executeQuery("SELECT * FROM Users");
    res.status(200).json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};