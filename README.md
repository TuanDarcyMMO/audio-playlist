# Audio Playlist Server

Một web app đơn giản để upload, nghe, và quản lý danh sách audio từ Facebook Messenger.

## Features

- 📁 Upload audio drag-drop
- ✅ Track "đã nghe" cho từng file
- 🏷️ Đặt tên group voice cho từng file
- 🎵 Player HTML5 responsive
- 📱 Mobile-friendly interface
- 💾 Metadata lưu trên server (JSON)

## Local Development

### Cài đặt

```bash
cd audio-playlist-server
npm install
npm run dev
```

Server sẽ chạy tại `http://localhost:3000`

### Cấu trúc folder

```
audio-playlist-server/
├── server.js          # Express server
├── package.json
├── public/
│   └── index.html    # Frontend
├── uploads/          # Audio files (tạo tự động)
└── metadata.json     # Metadata listened/groups
```

## Deploy lên Render

### 1. Push code lên GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/audio-playlist-server.git
git push -u origin main
```

### 2. Deploy trên Render

1. Vào https://render.com
2. Click "New +" → "Web Service"
3. Connect GitHub repo
4. Settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Free tier hoặc Starter** (Upload file có kích thước giới hạn)
5. Click "Deploy"

### 3. Alternative: Railway.app

1. Vào https://railway.app
2. Nếu lần đầu, connect GitHub
3. Import repo
4. Railway tự detect Node.js
5. Add "Port" to variables nếu cần
6. Deploy

## API Endpoints

### Upload
```
POST /api/upload
Content-Type: multipart/form-data
Body: audio (file)
```

### List files
```
GET /api/files
Response: { files: [...] }
```

### Mark listened
```
POST /api/listen/:id
```

### Unmark listened
```
POST /api/unlisten/:id
```

### Set group
```
POST /api/group/:id
Content-Type: application/json
Body: { "group": "Tên group" }
```

### Delete file
```
DELETE /api/files/:id
```

## Limits

- **Max file size**: 50MB
- **Supported formats**: MP3, WAV, M4A, AAC, OGG
- **Free tier Render**: ~500MB disk (có thể upgrade)

## Notes

- Metadata (listened status, groups) lưu trong `metadata.json` trên server
- Upload files lưu trong folder `uploads/`
- Trên Render free tier, disk sẽ reset mỗi khi deploy (nên upgrade lên paid hoặc dùng external storage)

## Improvements (optional future)

- [ ] Database thay cho JSON (MongoDB)
- [ ] Authentication
- [ ] Download playlist
- [ ] Share list công khai
- [ ] Multiple playlists

Enjoy! 🎵
