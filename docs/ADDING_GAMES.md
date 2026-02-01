# 🎮 Developer Guide: Adding Games & Using APIs

This guide explains how to add new games to the MintDEV Hub and how to integrate with the backend APIs for high scores and user profiles.

## 📂 Adding a New Game

The Hub automatically scans the `src/games/` directory. To add a game:

1.  **Create a Folder**:
    Create a new folder in `src/games/` with your game's unique ID (e.g., `src/games/my_cool_game`).

2.  **Add Metadata (`data.json`)**:
    Create a `data.json` file in that folder with the following structure:
    ```json
    {
        "name": "My Cool Game",
        "description": "A brief description of your game.",
        "genre": "Action",
        "images": [
            "logo.png",
            "screenshot1.png",
            "screenshot2.png"
        ]
    }
    ```
    *   The first image in `images` is used as the **Thumbnail** and **Hero Poster**.

4.  **Game Configuration (Optional)**:
    You can enable/disable features in `data.json`:
    ```json
    {
        "settings": {
            "leaderboard": true,   // Default: true
            "achievements": true   // Default: true
        },
        "achievements": [
            {
                "id": "first_win",          // Unique ID (optional, defaults to title)
                "title": "First Win",
                "description": "Win your first game.",
                "image": "ach_win.png"      // Image in game folder
            }
        ]
    }
    ```

5.  **Add Game Files**:
    *   Place your `index.html` (entry point) in the folder.
    *   Add your game assets (images, scripts, etc.).

6.  **Done!**
    Restart the server.

---

## 📡 API Reference

### 🏆 Leaderboards & Scores

#### **Submit a Score**
*   **Via API**: `POST /api/score`
*   **Via Game (Iframe)**:
    ```javascript
    window.parent.postMessage({
        type: 'SUBMIT_SCORE',
        username: 'PlayerName',
        score: 1500
    }, '*');
    ```

### 🏅 Achievements

#### **Define Achievements**
Add them to `data.json` (see above).

#### **Unlock Achievement**
Send a message from your game:
```javascript
window.parent.postMessage({
    type: 'UNLOCK_ACHIEVEMENT',
    achievement_id: 'first_win' // Must match ID or Title in data.json
}, '*');
```

#### **API Endpoints**
*   **Unlock**: `POST /api/achievements/unlock`
    *   Body: `{ "game_id": "...", "username": "...", "achievement_id": "..." }`
*   **Get Unlocks**: `GET /api/user/:username/achievements?game=...`

### 👤 User Stats & Auth
*   **Get Stats**: `GET /api/user/:username/stats`
*   **Login**: The Hub handles authentication.
    *   The current user is sent to the game iframe via `postMessage` on load:
        ```javascript
        window.addEventListener('message', (e) => {
            if (e.data.type === 'SET_USER') {
                console.log("Current User:", e.data.user); // { username: "...", discord_id: "..." }
            }
        });
        ```

---

## 🛑 Rules & Best Practices
*   **No Profanity**: The server filters bad words in usernames and posts.
*   **Images**: Keep game logos/screenshots optimized to avoid slow loading.
*   **Pixel Art**: The site uses `image-rendering: pixelated` keying off class names, so your pixel art will look crisp!

