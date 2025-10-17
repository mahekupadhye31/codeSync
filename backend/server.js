const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Document Schema
const documentSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled' },
  language: { type: String, default: 'javascript' },
  content: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Document = mongoose.model('Document', documentSchema);

// Store active users per document
const activeUsers = new Map(); // documentId -> Set of socket IDs
const userInfo = new Map(); // socket ID -> user info

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);

  // Join a document room
  socket.on('join-document', async ({ documentId, username, color }) => {
    socket.join(documentId);
    
    // Store user info
    userInfo.set(socket.id, {
      id: socket.id,
      username: username || `User-${socket.id.substring(0, 4)}`,
      color: color || `#${Math.floor(Math.random()*16777215).toString(16)}`,
      documentId
    });

    // Add to active users
    if (!activeUsers.has(documentId)) {
      activeUsers.set(documentId, new Set());
    }
    activeUsers.get(documentId).add(socket.id);

    // Send current users to the newly joined user
    const users = Array.from(activeUsers.get(documentId))
      .map(id => userInfo.get(id))
      .filter(Boolean);
    
    socket.emit('users-update', users);
    
    // Notify others about new user
    socket.to(documentId).emit('user-joined', userInfo.get(socket.id));

    console.log(`👤 ${userInfo.get(socket.id).username} joined document ${documentId}`);
  });

  // Handle code changes
  socket.on('code-change', ({ documentId, content, cursorPosition }) => {
    const user = userInfo.get(socket.id);
    if (!user) return;

    // Broadcast to all other users in the same document
    socket.to(documentId).emit('code-update', {
      content,
      cursorPosition,
      user: {
        id: user.id,
        username: user.username,
        color: user.color
      }
    });
  });

  // Handle cursor movement
  socket.on('cursor-move', ({ documentId, position, selection }) => {
    const user = userInfo.get(socket.id);
    if (!user) return;

    socket.to(documentId).emit('cursor-update', {
      user: {
        id: user.id,
        username: user.username,
        color: user.color
      },
      position,
      selection
    });
  });

  // Handle language change
  socket.on('language-change', ({ documentId, language }) => {
    const user = userInfo.get(socket.id);
    if (!user) return;

    socket.to(documentId).emit('language-update', {
      language,
      user: {
        id: user.id,
        username: user.username
      }
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = userInfo.get(socket.id);
    if (user) {
      const { documentId, username } = user;
      
      // Remove from active users
      if (activeUsers.has(documentId)) {
        activeUsers.get(documentId).delete(socket.id);
        if (activeUsers.get(documentId).size === 0) {
          activeUsers.delete(documentId);
        }
      }

      // Notify others
      socket.to(documentId).emit('user-left', {
        id: socket.id,
        username
      });

      console.log(`👤 ${username} left document ${documentId}`);
    }

    userInfo.delete(socket.id);
    console.log('👋 User disconnected:', socket.id);
  });
});

// REST API Routes (keep existing ones)

// Get all documents
app.get('/api/documents', async (req, res) => {
  try {
    const documents = await Document.find().sort({ updatedAt: -1 });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single document
app.get('/api/documents/:id', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new document
app.post('/api/documents', async (req, res) => {
  try {
    const document = new Document({
      title: req.body.title || 'Untitled',
      language: req.body.language || 'javascript',
      content: req.body.content || ''
    });
    await document.save();
    res.status(201).json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update document
app.put('/api/documents/:id', async (req, res) => {
  try {
    const document = await Document.findByIdAndUpdate(
      req.params.id,
      {
        title: req.body.title,
        language: req.body.language,
        content: req.body.content,
        updatedAt: Date.now()
      },
      { new: true }
    );
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const document = await Document.findByIdAndDelete(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'CodeSync API is running!',
    activeDocuments: activeUsers.size,
    totalUsers: userInfo.size
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server ready`);
});