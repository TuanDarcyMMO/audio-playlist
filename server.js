import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import supabase from "./supabase.js";

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
      JSON.stringify({ listened: {}, groups: {}, hashes: {} }),
    );
  }
};

const readMetadata = () => {
  try {
    const data = fs.readFileSync(metadataFile, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed.listened) parsed.listened = {};
    if (!parsed.groups) parsed.groups = {};
    if (!parsed.hashes) parsed.hashes = {};
    return parsed;
  } catch {
    return { listened: {}, groups: {}, hashes: {} };
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

const FILE_LIST_CACHE_TTL_MS = 3000;
const bucketListCache = new Map();

async function listAllBucketFiles(bucket) {
  const metadata = readMetadata();
  const files = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;

    const page = data || [];
    for (const file of page) {
      const { data: publicUrlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(file.name);
      files.push({
        id: file.name,
        url: publicUrlData.publicUrl,
        listened: metadata.listened[file.name] || false,
        group: metadata.groups[file.name] || "default",
        size: file.metadata && file.metadata.size ? file.metadata.size : 0,
        uploadedAt: file.updated_at || file.created_at || new Date(),
      });
    }

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return files;
}

async function getCachedBucketFiles(bucket, forceRefresh = false) {
  const now = Date.now();
  const cached = bucketListCache.get(bucket);

  if (cached && !forceRefresh && now - cached.fetchedAt < FILE_LIST_CACHE_TTL_MS) {
    return cached.files;
  }

  if (cached?.inFlight) {
    return cached.files;
  }

  const entry = {
    files: cached?.files || [],
    fetchedAt: cached?.fetchedAt || 0,
    inFlight: true,
  };
  bucketListCache.set(bucket, entry);

  try {
    const files = await listAllBucketFiles(bucket);
    bucketListCache.set(bucket, {
      files,
      fetchedAt: Date.now(),
      inFlight: false,
    });
    return files;
  } catch (error) {
    bucketListCache.set(bucket, {
      files: entry.files,
      fetchedAt: entry.fetchedAt,
      inFlight: false,
    });
    throw error;
  }
}

function invalidateBucketCache(bucket) {
  bucketListCache.delete(bucket);
}

// API Routes

// Upload audio to Supabase Storage
app.post("/api/upload", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  try {
    // Upload to Supabase Storage
    const bucket = process.env.SUPABASE_BUCKET || "audio";
    const fileBuffer = fs.readFileSync(req.file.path);
    const metadata = readMetadata();
    const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
    const duplicateByHash = Object.entries(metadata.hashes).find(
      ([, hash]) => hash === fileHash,
    );
    if (duplicateByHash) {
      fs.unlinkSync(req.file.path);
      const existingId = duplicateByHash[0];
      const { data: publicUrlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(existingId);
      return res.json({
        success: true,
        duplicate: true,
        reason: "hash",
        file: {
          id: existingId,
          originalName: req.file.originalname,
          size: req.file.size,
          url: publicUrlData.publicUrl,
        },
      });
    }

    const sanitizedOriginal = req.file.originalname.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );
    const existingFiles = await getCachedBucketFiles(bucket);
    const duplicateByName = existingFiles.find((item) =>
      item.id.endsWith(`_${sanitizedOriginal}`),
    );
    if (duplicateByName) {
      fs.unlinkSync(req.file.path);
      const { data: publicUrlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(duplicateByName.name);
      return res.json({
        success: true,
        duplicate: true,
        reason: "name",
        file: {
          id: duplicateByName.name,
          originalName: req.file.originalname,
          size: req.file.size,
          url: publicUrlData.publicUrl,
        },
      });
    }

    const supaPath = req.file.filename;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(supaPath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    // Remove local file after upload
    fs.unlinkSync(req.file.path);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    metadata.hashes[supaPath] = fileHash;
    writeMetadata(metadata);
    invalidateBucketCache(bucket);
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(supaPath);
    res.json({
      success: true,
      file: {
        id: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: publicUrlData.publicUrl,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all files
// List all files from Supabase Storage
app.get("/api/files", async (req, res) => {
  try {
    const bucket = process.env.SUPABASE_BUCKET || "audio";
    const fileList = await getCachedBucketFiles(bucket);
    res.set("Cache-Control", "no-store");
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
app.delete("/api/files/:id", async (req, res) => {
  const id = decodeURIComponent(req.params.id);

  try {
    const bucket = process.env.SUPABASE_BUCKET || "audio";
    const { error } = await supabase.storage.from(bucket).remove([id]);
    if (error) {
      return res.status(404).json({ error: error.message || "File not found" });
    }

    const metadata = readMetadata();
    delete metadata.listened[id];
    delete metadata.groups[id];
    delete metadata.hashes[id];
    writeMetadata(metadata);
    invalidateBucketCache(bucket);

    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename file
app.post("/api/rename/:id", (req, res) => {
  const { id } = req.params;
  const { newName } = req.body;

  if (!newName || typeof newName !== "string") {
    return res.status(400).json({ error: "Invalid new name" });
  }

  const oldPath = path.join(uploadsDir, id);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const timestamp = id.split("_")[0];
  const ext = path.extname(id);
  const sanitized = newName.trim().replace(/[^a-zA-Z0-9._-\s]/g, "_");
  const newId = `${timestamp}_${sanitized}${ext}`;
  const newPath = path.join(uploadsDir, newId);

  try {
    fs.renameSync(oldPath, newPath);
    const metadata = readMetadata();

    // Update metadata with new id
    if (metadata.listened[id]) {
      metadata.listened[newId] = metadata.listened[id];
      delete metadata.listened[id];
    }
    if (metadata.groups[id]) {
      metadata.groups[newId] = metadata.groups[id];
      delete metadata.groups[id];
    }
    if (metadata.hashes[id]) {
      metadata.hashes[newId] = metadata.hashes[id];
      delete metadata.hashes[id];
    }

    writeMetadata(metadata);
    invalidateBucketCache(process.env.SUPABASE_BUCKET || "audio");
    res.json({ success: true, id: newId, oldId: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Audio playlist server running at http://localhost:${PORT}`);
});
