import express from "express";
import cors from "cors";
import chatRoutes from "./src/routes/chat.routes";
import userRoutes from "./src/routes/user.routes";
import authRoutes from "./src/routes/auth.routes";
import sessionRoutes from "./src/routes/session.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("BoardVerse Backend Running");
});
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);


export default app;