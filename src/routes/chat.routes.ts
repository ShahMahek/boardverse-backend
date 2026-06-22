import { Router } from "express";
import { chat } from "../controllers/chat.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
router.post("/", authenticateToken, chat);
export default router;