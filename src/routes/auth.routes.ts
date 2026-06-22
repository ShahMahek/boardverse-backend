import { Router } from "express";
import {register,login, logout} from "../controllers/auth.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
router.post("/register", register);
router.post("/login", login);
router.post("/logout", authenticateToken, logout);
export default router;