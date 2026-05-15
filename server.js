import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
const metadataFile = path.join(__dirname, "metadata.json");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize metadata file
const initMetadata = () => {
  if (!fs.existsSync(metadataFile)) {
    fs.writeFileSync(
      metadataFile,
      JSON.stringify({ listened: {}, groups: {} }),
    );
  }
};

const readMetadata = () => {
  try {
    const data = fs.readFileSync(metadataFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return { listened: {}, groups: {} };
  }
};

const writeMetadata = (data) => {
  fs.writeFileSync(metadataFile, JSON.stringify(data, null, 2));
};

initMetadata();

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${timestamp}_${sanitized}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [".mp3", ".m4a", ".wav", ".ogg", ".aac", ".mp4"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files allowed"));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// API Routes

// Upload audio
app.post("/api/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({
    success: true,
    file: {
      id: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
    },
  });
});

// List all files
app.get("/api/files", (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const metadata = readMetadata();

    const fileList = files.map((filename) => {
      const filePath = path.join(uploadsDir, filename);
      const stat = fs.statSync(filePath);
      return {
        id: filename,
        url: `/uploads/${filename}`,
        listened: metadata.listened[filename] || false,
        group: metadata.groups[filename] || "default",
        size: stat.size,
        uploadedAt: stat.mtime,
      };
    });

    // Sort by uploadedAt descending
    fileList.sort((a, b) => b.uploadedAt - a.uploadedAt);

    res.json({ files: fileList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark as listened
app.post("/api/listen/:id", (req, res) => {
  const { id } = req.params;
  const metadata = readMetadata();

  metadata.listened[id] = true;
  writeMetadata(metadata);

  res.json({ success: true, id, listened: true });
});

// Unmark as listened
app.post("/api/unlisten/:id", (req, res) => {
  const { id } = req.params;
  const metadata = readMetadata();

  metadata.listened[id] = false;
  writeMetadata(metadata);

  res.json({ success: true, id, listened: false });
});

// Set group name
app.post("/api/group/:id", (req, res) => {
  const { id } = req.params;
  const { group } = req.body;

  if (!group || typeof group !== "string") {
    return res.status(400).json({ error: "Invalid group name" });
  }

  const metadata = readMetadata();
  metadata.groups[id] = group.trim();
  writeMetadata(metadata);

  res.json({ success: true, id, group: metadata.groups[id] });
});

// Delete file
app.delete("/api/files/:id", (req, res) => {
  const { id } = req.params;
  const filePath = path.join(uploadsDir, id);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlinkSync(filePath);
  const metadata = readMetadata();
  delete metadata.listened[id];
  delete metadata.groups[id];
  writeMetadata(metadata);

  res.json({ success: true, id });
});

// Start server
app.listen(PORT, () => {
  console.log(`Audio playlist server running at http://localhost:${PORT}`);
});
