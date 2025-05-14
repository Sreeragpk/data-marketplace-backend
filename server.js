require("dotenv").config();
const paymentRoutes = require("./routes/paymentRoutes");
const purchases = require("./routes/purchases");
const datasets = require("./routes/datasets");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const datasetRoutes = require("./routes/datasetRoutes");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const path = require("path");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const csv = require("csv-parser");
const app = express();
const Razorpay = require("razorpay");
const router = express.Router();
const PORT = process.env.PORT || 5000;
const saltRounds = 10;

// CORS setup
app.use(cors());
app.use(express.json());

// Supabase client setup (use environment variables for credentials)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
// File upload setup
const storage = multer.memoryStorage();
const upload = multer({ storage }).array("files");

// ---------------- Setup Nodemailer ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASS, // Your email password or app password
  },
});

// ---------------- Forgot Password ----------------
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user exists
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Email not found" });
    }

    const user = userResult.rows[0];

    // Generate a password reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetTokenExpiration = Date.now() + 3600000; // Token valid for 1 hour

    // Store the reset token and expiration in the database
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expiration = $2 WHERE email = $3",
      [resetToken, resetTokenExpiration, email]
    );

    // Create a reset password URL
    const resetUrl = `https://factyesdatamarketplacetesting.netlify.app/reset-password?token=${resetToken}&email=${email}`;

    // Send reset email
    await transporter.sendMail({
      to: email,
      subject: "Password Reset Request",
      html: `
  <html>
    <body style="font-family: 'Arial', sans-serif; background-color: #f7f8fa; margin: 0; padding: 0; color: #333;">
      <table role="presentation" style="width: 100%; background-color: #f7f8fa; padding: 50px 0;">
        <tr>
          <td align="center">
            <table role="presentation" style="width: 100%; max-width: 600px; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="text-align: center;">
                  <h1 style="color: #4C6EB1; font-size: 30px; font-weight: bold; margin-bottom: 20px;">Password Reset Request</h1>
                  <p style="font-size: 16px; color: #666666; margin-bottom: 30px;">We received a request to reset your password. If you made this request, click the button below to reset your password.</p>
                  <p style="text-align: center;">
                    <a href="${resetUrl}" style="display: inline-block; background-color: #4C6EB1; color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-size: 18px; font-weight: bold; text-transform: uppercase; transition: background-color 0.3s ease-in-out;">Reset Your Password</a>
                  </p>
                  <p style="font-size: 14px; color: #888888; margin-top: 20px;">If you did not request a password reset, please ignore this email. Your password will not be changed.</p>
                </td>
              </tr>
              <tr>
                <td style="text-align: center; padding-top: 30px; font-size: 14px; color: #888888;">
                  <p>Best regards,<br>Micrologic Data Marketplace</p>
                </td>
              </tr>
              <tr>
                <td style="text-align: center; padding-top: 20px; font-size: 12px; color: #bbbbbb;">
                  <p>If you need any help, contact our support team at <a href="mailto:support@yourdomain.com" style="color: #4C6EB1; text-decoration: none;">support@yourdomain.com</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`,
    });

    res.status(200).json({ message: "Password reset link sent to your email" });
  } catch (err) {
    console.error("Forgot Password Error:", err.message);
    res
      .status(500)
      .json({ error: "Server error during password reset request" });
  }
});

// ---------------- Reset Password ----------------
app.post("/api/reset-password", async (req, res) => {
  const { token, email, newPassword } = req.body;

  try {
    // Find user with reset token
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND reset_token = $2 AND reset_token_expiration > $3",
      [email, token, Date.now()]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const user = userResult.rows[0];

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update the user's password
    await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expiration = NULL WHERE email = $2",
      [hashedPassword, email]
    );

    res.status(200).json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err.message);
    res.status(500).json({ error: "Server error during password reset" });
  }
});

// ---------------- Signup ----------------
app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, hashedPassword, "user"]
    );
    // Send a welcome email after successful signup
    await sendWelcomeEmail(email, name, password);
    res
      .status(201)
      .json({ message: "Signup successful", user: result.rows[0] });
  } catch (err) {
    console.error("Signup Error:", err.message);
    res.status(500).json({ error: "Server error during signup" });
  }
});

// Function to send the beautified welcome email
const sendWelcomeEmail = async (email, name, password) => {
  const mailOptions = {
    from: "your-email@gmail.com", // Replace with your email
    to: email,
    subject: "Welcome to Micrologic Data Marketplace!",
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <table style="max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 8px;">
            <tr>
              <td>
                <h1 style="text-align: center; color: #4C6EB1;">Welcome, ${name}!</h1>
                <p style="font-size: 16px;">🎉 Thank you for signing up for <strong>Micrologic Data Marketplace</strong> 🚀</p>
                <p style="font-size: 16px;">You are now part of an exclusive community where you can unlock datasets, collaborate, and explore a decentralized data ecosystem.</p>
                <p style="font-size: 16px;">To get started, use the following login details:</p>
                
                <table style="margin: 20px auto; font-size: 16px; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px; font-weight: bold;">Email:</td>
                    <td style="padding: 10px;">${email}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; font-weight: bold;">Password:</td>
                    <td style="padding: 10px;">${password}</td>
                  </tr>
                </table>

                <p style="font-size: 16px;">You can now log in and start exploring the marketplace by clicking the button below:</p>

                <p style="text-align: center; margin-top: 30px;">
                  <a href="https://factyesdatamarketplacetesting.netlify.app/login" style="background-color: #4C6EB1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Login</a>
                </p>

                <p style="font-size: 12px; text-align: center; margin-top: 20px;">If you did not sign up, please ignore this email.</p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Welcome email sent successfully");
  } catch (error) {
    console.error("Error sending welcome email:", error);
  }
};

// ---------------- Login ----------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name }, // include role!
      process.env.JWT_SECRET,
      { expiresIn: "10h" }
    );

    res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error("Login Error:", err.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Middleware for authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access Denied: No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

// ---------------- Optional: Admin Middleware ----------------
const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
};

// Get all datasets
app.get("/api/admin/datasets", authenticateToken, isAdmin, async (req, res) => {
  const result = await pool.query("SELECT * FROM datasets ORDER BY id DESC");
  res.json(result.rows);
});

// Delete a dataset Admin

app.delete(
  "/api/admin/datasets/:id",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      // Get file paths from DB
      const dataset = await pool.query(
        "SELECT file_path FROM datasets WHERE id = $1",
        [id]
      );

      if (dataset.rows.length === 0) {
        return res.status(404).json({ error: "Dataset not found" });
      }

      let filePaths = dataset.rows[0].file_path;

      // Handle comma-separated paths (if stored like that)
      const filesToDelete = filePaths
        .split(",")
        .map((path) => path.trim())
        .filter((path) => path); // Remove empty strings

      if (filesToDelete.length > 0) {
        const { error: deleteError } = await supabase.storage
          .from("datasets") // Your Supabase bucket name
          .remove(filesToDelete);

        if (deleteError) {
          console.error(
            "Error deleting files from Supabase:",
            deleteError.message
          );
          return res
            .status(500)
            .json({ error: "Failed to delete dataset files from storage" });
        }

        console.log("Deleted files from Supabase:", filesToDelete);
      }

      // Delete dataset record from DB
      await pool.query("DELETE FROM datasets WHERE id = $1", [id]);

      res.json({
        message: "Dataset and associated files deleted successfully",
      });
    } catch (err) {
      console.error("Admin Delete Error:", err.message);
      res.status(500).json({ error: "Failed to delete dataset" });
    }
  }
);


// ---------------- Get All Purchases (Admin) ----------------
app.get("/api/admin/purchases", authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.user_id, u.email, d.title AS dataset_title, p.dataset_id, p.purchased_at
      FROM purchases p
      JOIN users u ON u.id = p.user_id
      JOIN datasets d ON d.id = p.dataset_id
      ORDER BY p.purchased_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching purchases:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});




//Delete a user dataset
app.delete(
  "/api/datasets/:id",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("DELETE FROM datasets WHERE uploaded_by = $1", [id]);
      res.json({ message: "User dataset deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete user dataset" });
    }
  }
);

// Get all users
app.get("/api/admin/users", authenticateToken, isAdmin, async (req, res) => {
  const result = await pool.query("SELECT id, name, email, role FROM users");
  res.json(result.rows);
});

// Delete a user
app.delete(
  "/api/admin/users/:id",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  }
);

app.delete("/api/datasets/user/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userEmail = req.user.email;

  try {
    const dataset = await pool.query(
      "SELECT * FROM datasets WHERE id = $1 AND uploaded_by = $2",
      [id, userEmail]
    );

    if (dataset.rows.length === 0) {
      return res.status(403).json({ error: "Not authorized to delete this dataset" });
    }

    const filePathString = dataset.rows[0].file_path || "";
    const filePaths = filePathString
      .split(",")
      .map(p => p.trim().split("/").pop())
      .filter(Boolean);

    console.log("Files to delete:", filePaths);

    for (const fileName of filePaths) {
      const { error: deleteError } = await supabase.storage
        .from("datasets")
        .remove([fileName]);

      if (deleteError) {
        console.error(`Error deleting file ${fileName}:`, deleteError.message);
        return res.status(500).json({ error: `Failed to delete file ${fileName}` });
      }

      console.log(`Deleted file: ${fileName}`);
    }

    await pool.query("DELETE FROM datasets WHERE id = $1", [id]);
    console.log(`Deleted dataset with ID: ${id}`);

    res.json({ message: "Dataset and associated files deleted successfully" });
  } catch (error) {
    console.error("Error deleting dataset:", error.message);
    res.status(500).json({ error: "Server error deleting dataset" });
  }
});

///purchase dataset

app.get("/api/purchases/user/:userId", authenticateToken, async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT d.id, d.title, d.description, d.file_path, p.purchased_at
      FROM purchases p
      JOIN datasets d ON p.dataset_id = d.id
      WHERE p.user_id = $1
      ORDER BY p.purchased_at DESC
      `,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching purchased datasets:", err);
    res.status(500).json({ error: "Failed to fetch purchased datasets" });
  }
});

// ---------------- Example Protected Routes ----------------

// Logged-in users only
app.get("/api/profile", authenticateToken, (req, res) => {
  res.json({ message: "Welcome to your profile", user: req.user });
});

// Admin-only route
app.get("/api/admin/dashboard", authenticateToken, isAdmin, (req, res) => {
  res.json({ message: "Welcome to the Admin Dashboard!" });
});

app.patch(
  "/api/admin/users/:id/role",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!["admin", "user"].includes(role)) {
      return res
        .status(400)
        .json({ error: 'Invalid role. Must be "admin" or "user".' });
    }

    try {
      const result = await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role",
        [role, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        message: `User role updated to ${role}`,
        user: result.rows[0],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update user role" });
    }
  }
);

// ---------------- Admin Stats ----------------
// Get statistics for admin dashboard

app.get("/api/admin/stats", authenticateToken, isAdmin, async (req, res) => {
  try {
    const totalDatasets = await pool.query("SELECT COUNT(*) FROM datasets");
    const totalUsers = await pool.query("SELECT COUNT(*) FROM users");

    const uploadsByDate = await pool.query(`
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COUNT(*) 
      FROM datasets 
      GROUP BY date 
      ORDER BY date ASC
    `);

    res.json({
      totalDatasets: parseInt(totalDatasets.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      uploadsByDate: uploadsByDate.rows, // { date, count }
    });
  } catch (err) {
    console.error("Failed to fetch stats:", err.message);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Get recent purchases (for admin notifications)
app.get("/api/admin/recent-purchases", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await pool.query(`
      SELECT 
        p.id, 
        p.purchased_at, 
        u.name as buyer_name,
        d.title as dataset_title
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN datasets d ON p.dataset_id = d.id
      ORDER BY p.purchased_at DESC
      LIMIT 5
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching recent purchases:", err.message);
    res.status(500).json({ error: "Failed to fetch recent purchases" });
  }
});

// // Set up storage for file uploads
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, 'uploads/'); // Directory where files are stored
//   },
//   filename: (req, file, cb) => {
//     const filename = Date.now() + path.extname(file.originalname);
//     cb(null, filename); // Use a unique name for the file
//   }
// });

// // Initialize multer with the storage configuration and a limit for file uploads
// const upload = multer({
//   storage,
//   limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
// }).array('files'); // `array` because we are allowing multiple files (folder upload)

// // Update your route to use the array method for multiple file uploads
// app.post('/api/datasets', authenticateToken, upload, async (req, res) => {
//   const { title, description, price } = req.body;
//   const uploadedBy = req.user.email; // Use logged-in user's email

//   // Ensure files were uploaded
//   if (!req.files || req.files.length === 0) {
//     return res.status(400).json({ error: 'No files uploaded' });
//   }

//   // Iterate over files and insert each one into the database
//   const filePaths = req.files.map(file => file.filename); // Save the filenames

//   // Now insert the data and file information into the database
//   try {
//     const result = await pool.query(
//       'INSERT INTO datasets (title, description, price, file_path, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
//       [title, description, price, filePaths.join(','), uploadedBy]
//     );
//     res.status(201).json(result.rows[0]);
//   } catch (err) {
//     console.error('Error uploading dataset:', err.message);
//     res.status(500).json({ error: 'Failed to upload dataset' });
//   }
// });

// Route to upload dataset
router.post("/api/datasets", authenticateToken, upload, async (req, res) => {
  const { title, description, price } = req.body;
  const uploadedBy = req.user.email;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  try {
    const uploadedFileUrls = [];

    for (const file of req.files) {
      const uniqueName = `${Date.now()}_${file.originalname}`;

      // Upload to Supabase Storage bucket
      const { data, error } = await supabase.storage
        .from("datasets") // Name of your bucket
        .upload(uniqueName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) throw error;

      // Get public URL of the uploaded file
      const { data: publicUrlData } = supabase.storage
        .from("datasets")
        .getPublicUrl(uniqueName);

      uploadedFileUrls.push(publicUrlData.publicUrl);
    }

    // Insert dataset metadata into your database (PostgreSQL)
    const result = await pool.query(
      "INSERT INTO datasets (title, description, price, file_path, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [title, description, price, uploadedFileUrls.join(","), uploadedBy]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error uploading to Supabase Storage:", err.message);
    res.status(500).json({ error: "Failed to upload dataset" });
  }
});

// Start the server
app.use(router);

// ---------------- Get Datasets ----------------
app.get("/api/datasets", async (req, res) => {
  const search = req.query.search || "";
  const result = await pool.query(
    "SELECT * FROM datasets WHERE title ILIKE $1",
    [`%${search}%`]
  );
  res.json(result.rows);
});

// ---------------- Get Dataset By ID ----------------
app.get("/api/datasets/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT * FROM datasets WHERE id = $1", [id]);
  res.json(result.rows[0]);
});

// ---------------- Download Dataset ----------------
app.get("/api/download/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT file_path FROM datasets WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Get file paths (comma-separated) and split into array
    const filePaths = result.rows[0].file_path.split(",");

    // If multiple files, send array of public URLs
    const downloadUrls = filePaths.map((path) => {
      return supabase.storage.from("datasets").getPublicUrl(path.trim()).data
        .publicUrl;
    });

    res.json({ downloadUrls });
  } catch (error) {
    console.error("Error retrieving dataset download URLs:", error.message);
    res.status(500).json({ error: "Failed to generate download link" });
  }
});

app.use("/api", datasetRoutes);

app.use("/api/purchases", purchases);
app.use("/api/datasets", datasets);

app.use("/api", paymentRoutes);
// ---------------- Razorpay Payment Integration ----------------

// ---------------- Start Server ----------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
