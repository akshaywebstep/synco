const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // ✅ Add path module
const { sequelize, connectWithRetry } = require("./config/db");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ Middleware
// app.use(cors());
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://grabbite.com"
    // "https://api.grabbite.com/"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// app.options("/*", cors());

// ⚙️ Practically remove payload limit (1GB+)
app.use(bodyParser.json({ limit: "1000mb" }));
app.use(
  bodyParser.urlencoded({
    limit: "1000mb",
    extended: true,
    parameterLimit: 1000000,
  })
);

// ✅ Serve static files from /uploads
app.use("/uploads", express.static("uploads"));

app.use("/api/open", require("./routes/open")); // Public routes

app.use("/api/parent", require("./routes/parentWebsite/"));

// ✅ Auth & Profile
app.use("/api/admin/auth", require("./routes/admin/authRoutes")); // Login, Logout, etc.
app.use("/api/admin/profile", require("./routes/admin/profileRoutes")); // Admin profile CRUD

// ✅ Member Management

app.use("/api/admin", require("./routes/admin")); // Manage Admins
app.use("/api/location", require("./routes/location")); // Manage members
// app.use("/api/location", require("./routes/location")); // Manage members

app.use("/api/test", require("./routes/test")); // Test

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start server only after DB is connected
connectWithRetry().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
