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
            "achievements": true,  // Default: true
            "phone": true          // Default: false (Adds mobile icon)
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

#### **Simple Leaderboard**
Default configuration in `data.json`:
```json
"settings": { "leaderboard": true }
```

#### **Flexible Leaderboard (Custom Title/Board)**
To use a custom title or separate board (e.g., "Best Streak"):
```json
"settings": {
    "leaderboard": {
        "key": "streak_mode",
        "title": "Best Streak"
    }
}
```

#### **Submit a Score**
*   **Via API**: `POST /api/score`
*   **Via Game (Iframe)**:
    ```javascript
    window.parent.postMessage({
        type: 'SUBMIT_SCORE',
        username: 'PlayerName',
        score: 1500,
        board_id: 'streak_mode' // Optional: defaults to 'main'
    }, '*');
    ```

### 💾 Save System (New!)

MintDEV now supports a generic Save/Load system for Story Games, Visual Novels, etc.

#### **Save Game**
Send a message to save specific data (JSON object):
```javascript
window.parent.postMessage({
    type: 'SAVE_GAME',
    slot_id: 'slot_1',          // Unique slot ID (e.g., 'auto', 'slot_1')
    label: 'Chapter 1: The End', // User-friendly label
    payload: {                  // Any JSON data
        chapter: 1,
        health: 100,
        inventory: ['sword', 'potion']
    }
}, '*');
```
*   **Note**: `SAVE_COMPLETE` message will be sent back on success.

#### **Load Saves**
Request all saves for the current user/game:
```javascript
window.parent.postMessage({ type: 'LOAD_SAVES' }, '*');
```
*   **Response**: The Hub will reply with:
    ```javascript
    {
        type: 'LOAD_SAVES_COMPLETE',
        saves: [
            { save_id: '...', slot_id: 'slot_1', label: '...', data: {...}, updated_at: '...' }
        ]
    }
    ```

#### **Delete Save**
```javascript
window.parent.postMessage({
    type: 'DELETE_SAVE',
    slot_id: 'slot_1'
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
*   **Get Full Profile**: `GET /api/user/:username/full-profile`
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

## 🎮 Multiplayer API

MintDEV provides a Multiplayer API for turn-based games, card games, quizzes, and more.

### Session Management

#### **Create a Session**
```javascript
// POST /api/multiplayer/session
const response = await fetch('/api/multiplayer/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        game_id: 'my_card_game',
        host_username: 'PlayerOne',
        mode: 'against',        // 'against', 'party', or 'coop'
        max_players: 2
    })
});
const { session_id } = await response.json();
```

#### **Get Session Details**
```javascript
// GET /api/multiplayer/session/:sessionId
const session = await fetch(`/api/multiplayer/session/${sessionId}`).then(r => r.json());
// Returns: { session_id, game_id, host_username, mode, status, players: [...] }
```

### Game Invites

#### **Send Game Invite**
```javascript
// POST /api/multiplayer/invite
await fetch('/api/multiplayer/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        session_id: 'session_123',
        from_username: 'PlayerOne',
        to_username: 'PlayerTwo'
    })
});
```

#### **Get Pending Invites**
```javascript
// GET /api/multiplayer/invites/:username
const invites = await fetch(`/api/multiplayer/invites/${username}`).then(r => r.json());
// Returns: [{ id, session_id, from_username, game_id, mode, created_at }]
```

#### **Respond to Invite**
```javascript
// POST /api/multiplayer/invite/respond
await fetch('/api/multiplayer/invite/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        invite_id: 123,
        session_id: 'session_123',
        username: 'PlayerTwo',
        accept: true  // or false to decline
    })
});
```

### Game Actions (Turn-Based)

#### **Send Game Action**
Use this for turn-based games to send moves, choices, etc:
```javascript
// POST /api/multiplayer/session/:sessionId/action
await fetch(`/api/multiplayer/session/${sessionId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        username: 'PlayerOne',
        action_type: 'play_card',
        action_data: { card_id: 'ace_spades', position: 2 }
    })
});
// Returns: { success: true, current_data: { actions: [...], last_action: {...} } }
```

### Session Lifecycle

#### **Start Session**
```javascript
// POST /api/multiplayer/session/:sessionId/start
await fetch(`/api/multiplayer/session/${sessionId}/start`, { method: 'POST' });
```

#### **End Session**
```javascript
// POST /api/multiplayer/session/:sessionId/end
await fetch(`/api/multiplayer/session/${sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        winner: 'PlayerOne',
        final_data: { scores: { PlayerOne: 100, PlayerTwo: 80 } }
    })
});
```

### Game Modes

| Mode | Description |
|------|-------------|
| `against` | Competitive 1v1 or team vs team |
| `party` | Multiple players in a party game |
| `coop` | Cooperative multiplayer |

### Polling for Updates

For real-time updates, poll the session endpoint:
```javascript
setInterval(async () => {
    const session = await fetch(`/api/multiplayer/session/${sessionId}`).then(r => r.json());
    // Check session.current_data.last_action for new moves
}, 2000);
```

---

## 🛑 Rules & Best Practices
*   **No Profanity**: The server filters bad words in usernames and posts.
*   **Images**: Keep game logos/screenshots optimized to avoid slow loading.
*   **Pixel Art**: The site uses `image-rendering: pixelated` keying off class names, so your pixel art will look crisp!
*   **Multiplayer**: Use polling intervals of 2-5 seconds to balance responsiveness and server load.

