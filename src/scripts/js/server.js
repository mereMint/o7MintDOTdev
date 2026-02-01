const express = require('express');
const mariadb = require('mariadb');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.')); // Serve static files from root (process.cwd)

// Database Connection Pool
const pool = mariadb.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'mintdev_db',
    connectionLimit: 5
});

// State
let useInMemory = false;
let memoryPosts = [];

// Initialize Connection
pool.getConnection()
    .then(conn => {
        console.log("✅ Database connected successfully.");
        conn.release();
    })
    .catch(err => {
        console.warn("⚠️  Database Connection Failed. Switching to IN-MEMORY mode.");
        console.warn("   Posts will be saved to RAM and lost on restart.");
        useInMemory = true;
        // Add some dummy data for testing
        memoryPosts.push(
            { id: 1, username: "System", content: "Welcome to Dev Mode (In-Memory)", created_at: new Date() },
            { id: 2, username: "Tester", content: "This post is running from RAM!", created_at: new Date() }
        );
    });

// Load Bad Words
let badWords = [];
// Adjusted path: Go up two levels from src/scripts/js/ to src/ then to conigs/
const nonowordsPath = path.join(__dirname, '../../conigs/nonowords.json');
try {
    if (fs.existsSync(nonowordsPath)) {
        const data = fs.readFileSync(nonowordsPath, 'utf8');
        const json = JSON.parse(data);
        badWords = json.nonowords || [];
        console.log(`Loaded ${badWords.length} bad words from config.`);
    } else {
        console.warn("Config file not found:", nonowordsPath);
    }
} catch (err) {
    console.error("Error loading nonowords:", err);
}

// Default Bad Words (Generic fallback)
const defaultBadWords = ["badword1", "badword2", "spam"];

// Filter Function
function containsBadWord(text) {
    const lowerText = text.toLowerCase();
    const allBadWords = [...badWords, ...defaultBadWords];
    return allBadWords.some(word => lowerText.includes(word.toLowerCase()));
}

// --- API Routes ---

// GET /api/posts
app.get('/api/posts', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    if (useInMemory) {
        // Serve from RAM
        const sorted = [...memoryPosts].sort((a, b) => b.created_at - a.created_at);
        const slice = sorted.slice(offset, offset + limit);
        return res.json(slice);
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/post
app.post('/api/post', async (req, res) => {
    try {
        const { username, content } = req.body;

        // Basic Validation
        if (!content || content.length > 255) {
            return res.status(400).json({ error: "Invalid content" });
        }

        // Profanity Check
        if (containsBadWord(content) || (username && containsBadWord(username))) {
            return res.status(400).json({ error: "Profanity detected" });
        }

        const user = username || "Anonymous";

        if (useInMemory) {
            // Save to RAM
            const newPost = {
                id: memoryPosts.length + 1,
                username: user,
                content: content,
                created_at: new Date()
            };
            memoryPosts.push(newPost);
            return res.json({ success: true });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query("INSERT INTO posts (username, content) VALUES (?, ?)", [user, content]);
            res.json({ success: true });
        } finally {
            if (conn) conn.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
