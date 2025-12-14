const express = require("express");
const cors = require("cors");
const multer = require("multer"); // 1. Import Multer
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// 2. Configure Multer to handle file uploads
// Note: This simple configuration saves the file directly to memory (not recommended for production)
// For development, we'll keep it simple for now, but usually you'd configure disk storage.
const upload = multer({ dest: 'uploads/' }); 
// If you don't want to actually save the file yet:
// const upload = multer({ storage: multer.memoryStorage() });


app.get("/", (req, res) => {
  res.send("Server is running 👍");
});

// 3. ADD THE POST /upload ROUTE
// 'file' must match the name used in formData.append("file", selectedFile) in your React code
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }
  
  // In a real application, you would process or save req.file here.
  // req.file contains information about the uploaded file.
  
  console.log(`Received file: ${req.file.originalname}`); // Check your server terminal!

  // Send a success response back to the frontend
  res.status(200).json({ 
    message: "File uploaded successfully!", 
    id: Date.now(), // Use a temporary ID for testing
    name: req.file.originalname // Send back the filename for your frontend to display
  });
});

// 4. ADD THE DELETE ROUTE (for testing the frontend logic)
app.delete("/delete/:id", (req, res) => {
    const fileId = req.params.id;
    // In a real app, you would delete the file from your database/storage here
    console.log(`Deleted file with ID: ${fileId}`);
    res.status(200).send({ message: "File deleted." });
});

app.get("/files", (req, res) => {
    // Returns an empty array because the server doesn't remember files
    res.json([]);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
