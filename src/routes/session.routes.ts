import { Router } from "express";
import { getSessions, getMessages } from "../controllers/session.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
router.get("/", authenticateToken, getSessions);
router.get("/:id/messages", authenticateToken, getMessages);
export default router;