const urlParams = new URLSearchParams(window.location.search);
const gameId = urlParams.get('id');

document.addEventListener('DOMContentLoaded', () => {
    if (!gameId) {
        alert("No game specified!");
        window.location.href = 'GameHub.html';
        return;
    }

    // Load Game Details (Simulated scan or fetch from list)
    // Ideally we would have a specific API for one game details, but we can re-use the list or generic info
    // For now, let's just infer paths and use the API to get metadata if possible, or just load static assets.
    // For now, let's just infer paths and use the API to get metadata if possible, or just load static assets.
    // Simpler: Fetch all games and find ours to get the nice name/desc.    
    loadGameDetails();
});

let gameImages = [];
let currentHeroIndex = 0;

async function loadGameDetails() {
    try {
        const res = await fetch('/api/games');
        const games = await res.json();
        const game = games.find(g => g.id === gameId);

        if (game) {
            document.getElementById('game-title').innerText = game.name;
            document.getElementById('game-desc').innerText = game.description;
            document.title = `${game.name} - Play`;

            // Prepare Images
            const gallery = document.getElementById('game-gallery');
            let images = ['logo.png'];
            if (game.images) {
                images = images.concat(game.images);
            }
            gameImages = [...new Set(images)];
            currentHeroIndex = 0;

            // Render Gallery Strip
            if (gameImages.length > 0) {
                gallery.innerHTML = '';
                gameImages.forEach((img, index) => {
                    const el = document.createElement('img');
                    el.src = `../../src/games/${gameId}/${img}`;
                    el.className = 'gallery-img';
                    el.id = `gallery-img-${index}`;
                    el.onclick = () => updateHeroImage(index);
                    gallery.appendChild(el);
                });
            }

            // Initial Hero
            updateHeroImage(0);

            // Feature Toggles (Normalize)
            const settings = game.settings || {};

            // Leaderboard Logic
            const lbContainer = document.getElementById('leaderboard-container');
            const mainContainer = document.getElementById('game-detail-container');

            let showLeaderboard = false;
            let currentBoard = { key: 'main', title: 'Leaderboard' };

            if (settings.leaderboard) {
                showLeaderboard = true;
                if (typeof settings.leaderboard === 'object') {
                    currentBoard = {
                        key: settings.leaderboard.key || 'main',
                        title: settings.leaderboard.title || 'Leaderboard'
                    };
                }
            }

            if (showLeaderboard) {
                if (lbContainer) {
                    lbContainer.style.display = 'flex';
                    // Set Title
                    lbContainer.querySelector('h3').innerText = currentBoard.title;
                }
                if (mainContainer) mainContainer.style.gridTemplateColumns = '3fr 1fr';
                loadScores(currentBoard.key);
            } else {
                if (lbContainer) lbContainer.style.display = 'none';
                if (mainContainer) mainContainer.style.gridTemplateColumns = '1fr';
            }

            // Render Achievements (Moved OUTSIDE game-play-area for separate box look)
            // We need to inject a new container sibling to game-play-area if it doesn't exist?
            // BETTER: Use existing #achievements-section but style it to look like a separate box.
            // But HTML structure has it inside #game-play-area.
            // Move it out dynamically.
            const achSection = document.getElementById('achievements-section');
            const gameArea = document.getElementById('game-play-area');

            // Move to be a sibling of gameArea if currently a child
            if (achSection && achSection.parentNode === gameArea) {
                gameArea.parentNode.insertBefore(achSection, gameArea.nextSibling);
                // Reset styles to look like a separate box (match .score-sidebar or .game-description)
                achSection.style.marginTop = '20px';
                achSection.style.border = '2px solid #222';
                achSection.style.borderRadius = '10px';
                achSection.style.background = '#000'; // Match aesthetic
            }

            if (settings.achievements !== false && game.achievements && game.achievements.length > 0) {
                achSection.style.display = 'block';
                const achList = document.getElementById('achievements-list');
                achList.innerHTML = '';

                let unlockedIds = [];
                const storedUser = localStorage.getItem('discord_user');
                if (storedUser) {
                    try {
                        const username = JSON.parse(storedUser).username;
                        const res = await fetch(`/api/user/${username}/achievements?game=${gameId}`);
                        if (res.ok) {
                            const data = await res.json();
                            unlockedIds = data.map(a => a.achievement_id);
                        }
                    } catch (e) { console.warn("Failed to fetch achievement status", e); }
                }

                game.achievements.forEach(ach => {
                    const div = document.createElement('div');
                    div.className = 'achievement-card';

                    const achId = ach.id || ach.title;
                    const isUnlocked = unlockedIds.includes(achId);
                    const iconPath = ach.image ? `../../src/games/${gameId}/${ach.image}` : '../../src/assets/icon_placeholder.png';

                    if (isUnlocked) {
                        div.style.borderColor = '#1DCD9F';
                        div.style.opacity = '1';
                    } else {
                        div.style.borderColor = '#333';
                        div.style.opacity = '0.5';
                        div.style.filter = 'grayscale(100%)';
                    }

                    div.innerHTML = `
                        <img src="${iconPath}" class="achievement-icon" alt="Icon" onerror="this.style.display='none'">
                        <div class="achievement-info">
                            <h4>${escapeHtml(ach.title)} ${isUnlocked ? '✅' : ''}</h4>
                            <p>${escapeHtml(ach.description)}</p>
                        </div>
                    `;
                    achList.appendChild(div);
                });
            } else {
                achSection.style.display = 'none';
            }

        } else {
            document.getElementById('game-title').innerText = "Game Not Found";
        }
    } catch (err) {
        console.error("Error loading details", err);
    }
}

function updateHeroImage(index) {
    console.log(`Switching Hero Image to index: ${index} / ${gameImages.length}`);
    if (index < 0 || index >= gameImages.length) {
        console.warn("Index out of bounds");
        return;
    }

    currentHeroIndex = index;

    // Update Poster
    const poster = document.getElementById('game-poster');
    const newSrc = `../../src/games/${gameId}/${gameImages[index]}`;
    console.log("New Poster Src:", newSrc);

    if (poster) {
        poster.src = newSrc;

        // Highlight active thumbnail
        document.querySelectorAll('.gallery-img').forEach(img => img.style.borderColor = '#333');
        const activeThumb = document.getElementById(`gallery-img-${index}`);
        if (activeThumb) {
            activeThumb.style.borderColor = '#1DCD9F';
            activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    } else {
        console.error("Poster element not found!");
    }
}

function launchGame() {
    window.location.href = `../../src/games/${gameId}/index.html`;
}

// Renamed logic but kept function name for HTML compatibility, or updated HTML? 
// User said "buttons don't cycle".
// I will reuse `scrollGallery` name but make it CYCLE images.
function scrollGallery(direction) {
    // Cycle Logic
    console.log("Cycling...", direction);
    let newIndex = currentHeroIndex + direction;

    // Wrap around
    if (newIndex < 0) newIndex = gameImages.length - 1;
    if (newIndex >= gameImages.length) newIndex = 0;

    updateHeroImage(newIndex);
}

async function loadScores(boardKey = 'main') {
    const list = document.getElementById('score-list');
    try {
        // Fetch Top 10 with board key
        const res = await fetch(`/api/scores?game=${gameId}&board=${boardKey}&limit=10`);
        if (!res.ok) {
            console.warn(`Scores API returned status: ${res.status}`);
            if (res.status === 404) {
                list.innerHTML = '<li class="score-item" style="justify-content: center; color: #555;">No scores yet</li>';
                return;
            }
            throw new Error(`API Error: ${res.status}`);
        }

        const scores = await res.json();

        // Safety Check
        if (!Array.isArray(scores)) {
            console.error("Invalid scores response (not an array):", scores);
            list.innerHTML = '<li class="score-item" style="justify-content: center; color: #555;">No scores yet</li>';
            return;
        }

        list.innerHTML = '';
        if (scores.length === 0) {
            list.innerHTML = '<li class="score-item" style="justify-content: center; color: #555;">No scores yet</li>';
            return;
        }

        // Render Top 10
        let userInTop = false;
        const storedUser = localStorage.getItem('discord_user');
        const currentUser = storedUser ? JSON.parse(storedUser).username : null;

        scores.forEach((s, index) => {
            if (currentUser && s.username === currentUser) userInTop = true;

            const isMe = (currentUser && s.username === currentUser);
            const li = document.createElement('li');
            li.className = 'score-item';
            if (isMe) li.style.borderColor = '#1DCD9F'; // Highlight user

            li.innerHTML = `
                <span><span class="score-itm-rank">#${index + 1}</span> ${escapeHtml(s.username)}</span>
                <span>${s.score}</span>
            `;
            list.appendChild(li);
        });

        // If User not in Top 10, fetch their rank
        if (currentUser && !userInTop) {
            fetchUserRank(currentUser, list, boardKey);
        }

    } catch (err) {
        console.error("Error loading scores", err);
        list.innerHTML = '<li class="score-item">Error loading scores</li>';
    }
}

async function fetchUserRank(username, listElement, boardKey = 'main') {
    try {
        const res = await fetch(`/api/scores/rank?game=${gameId}&username=${username}&board=${boardKey}`);
        const data = await res.json();

        if (data.rank && data.score !== null) {
            // Divider
            const divider = document.createElement('li');
            divider.className = 'score-item';
            divider.style.justifyContent = 'center';
            divider.style.border = 'none';
            divider.style.padding = '5px 0';
            divider.style.color = '#555';
            divider.innerHTML = '...';
            listElement.appendChild(divider);

            // User Rank
            const li = document.createElement('li');
            li.className = 'score-item';
            li.style.borderColor = '#1DCD9F';
            li.innerHTML = `
                <span><span class="score-itm-rank">#${data.rank}</span> ${escapeHtml(username)}</span>
                <span>${data.score}</span>
            `;
            listElement.appendChild(li);
        }
    } catch (err) {
        console.error("Rank fetch error", err);
    }
}

async function submitManualScore() {
    // For testing
    const name = document.getElementById('player-name').value || "Anonymous";
    const score = Math.floor(Math.random() * 1000);
    submitScore(name, score);
}

async function submitScore(username, score, boardId = 'main') {
    try {
        const res = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                username: username,
                score: score,
                board_id: boardId
            })
        });

        if (res.ok) {
            loadScores(boardId); // Refresh
        } else {
            alert("Failed to save score");
        }
    } catch (err) {
        console.error(err);
    }
}

// Save System API
async function saveGame(username, slotId, label, data) {
    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                username,
                slot_id: slotId,
                label,
                data
            })
        });
        const result = await res.json();
        // Notify game
        const frame = document.getElementById('game-frame');
        if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'SAVE_COMPLETE', success: result.success }, '*');
    } catch (err) { console.error(err); }
}

async function loadGameSaves(username) {
    try {
        const res = await fetch(`/api/saves?game=${gameId}&username=${username}`);
        const saves = await res.json();
        // Notify game
        const frame = document.getElementById('game-frame');
        if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'LOAD_SAVES_COMPLETE', saves }, '*');
    } catch (err) { console.error(err); }
}

async function deleteGameSave(username, slotId) {
    try {
        await fetch('/api/save', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_id: gameId, username, slot_id: slotId })
        });
        loadGameSaves(username); // Refresh list
    } catch (err) { console.error(err); }
}

// Utility
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Listen for messages from Iframe (Game)
window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    const storedUser = localStorage.getItem('discord_user');
    const username = storedUser ? JSON.parse(storedUser).username : "Anonymous";

    if (data.type === 'SUBMIT_SCORE') {
        const board = data.board_id || 'main'; // Allow game to specify board
        submitScore(data.username || username, data.score, board);
    }
    else if (data.type === 'UNLOCK_ACHIEVEMENT') {
        unlockAchievement(username, data.achievement_id);
    }
    else if (data.type === 'SAVE_GAME') {
        saveGame(username, data.slot_id, data.label, data.payload);
    }
    else if (data.type === 'LOAD_SAVES') {
        loadGameSaves(username);
    }
    else if (data.type === 'DELETE_SAVE') {
        deleteGameSave(username, data.slot_id);
    }
});

async function unlockAchievement(username, achievementId) {
    if (!username || username === "Anonymous") {
        console.warn("Cannot unlock achievement: not logged in.");
        return;
    }

    try {
        const res = await fetch('/api/achievements/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                username: username,
                achievement_id: achievementId
            })
        });

        const data = await res.json();
        if (data.success && data.new_unlock) {
            // Maybe show a toast notification?
            // alert(`Achievement Unlocked: ${achievementId}`);
            // Refresh visual state
            loadGameDetails();
        }
    } catch (err) {
        console.error("Unlock Error:", err);
    }
}

function loginDiscord() {
    window.location.href = '/api/auth/discord';
}

function updateUserInGame() {
    const storedUser = localStorage.getItem('discord_user');
    const user = storedUser ? JSON.parse(storedUser) : { username: "Anonymous" };

    const frame = document.getElementById('game-frame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'SET_USER', user: user }, '*');
    }
}

function updateVolume(value) {
    const vol = value / 100;
    const frame = document.getElementById('game-frame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'SET_VOLUME', value: vol }, '*');
    }
}
