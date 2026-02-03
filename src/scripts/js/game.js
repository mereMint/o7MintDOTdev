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

    // Auto-refresh when page is clicked or refocused (e.g. closing game, switching tabs)
    window.addEventListener('focus', () => {
        console.log("Page focused, refreshing details...");
        loadGameDetails();
    });
});

let gameImages = [];
let currentHeroIndex = 0;
let isLoadingDetails = false;

async function loadGameDetails() {
    if (isLoadingDetails) return; // Prevent concurrent loads
    isLoadingDetails = true;
    try {
        const res = await fetch(`/api/games?t=${Date.now()}`);
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

            // Debug Logging for Duplicates
            console.log("Loading Game Details. Achievements count:", game.achievements ? game.achievements.length : 0);

            // Dev Mode: Reset Button (Injected into Sidebar if Dev)
            const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            if (isDev && lbContainer && !document.getElementById('reset-progress-btn')) {
                const btn = document.createElement('button');
                btn.id = 'reset-progress-btn';
                btn.innerText = "[!] Reset Progress";
                btn.style.marginTop = "20px";
                btn.style.width = "100%";
                btn.style.background = "#444";
                btn.style.color = "#ff5555";
                btn.style.border = "1px dashed #ff5555";
                btn.style.padding = "5px";
                btn.style.cursor = "pointer";
                btn.onclick = async () => {
                    if (!confirm("Reset ALL achievements for this game?")) return;
                    const storedUser = localStorage.getItem('discord_user');
                    if (!storedUser) return alert("Not logged in");
                    const user = JSON.parse(storedUser);

                    await fetch(`/api/user/${user.username}/progress?game_id=${gameId}`, { method: 'DELETE' });
                    location.reload();
                };
                lbContainer.appendChild(btn);
            }

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

            // FIX: Ensure Achievements is INSIDE gameArea (at the bottom)
            if (achSection && gameArea && achSection.parentNode !== gameArea) {
                gameArea.appendChild(achSection);
                achSection.style.marginTop = '0';
                achSection.style.borderTop = '1px solid #222';
                achSection.style.borderRadius = '0 0 10px 10px';
                achSection.style.background = '#111';
                achSection.style.width = 'auto'; // Reset width
                achSection.style.borderLeft = 'none';
                achSection.style.borderRight = 'none';
                achSection.style.borderBottom = 'none';
            } else if (achSection) {
                // Ensure styles are correct even if already inside
                achSection.style.marginTop = '0';
                achSection.style.borderTop = '1px solid #222';
                achSection.style.borderRadius = '0 0 10px 10px';
                achSection.style.background = '#111';
                achSection.style.width = 'auto';
                achSection.style.borderLeft = 'none';
                achSection.style.borderRight = 'none';
                achSection.style.borderBottom = 'none';
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
                    const achId = ach.id || ach.title;
                    const cardDomId = `ach-card-${achId.replace(/\s+/g, '-')}`;

                    // Safety: Remove existing card if it exists (prevents duplicates)
                    const existing = document.getElementById(cardDomId);
                    if (existing) existing.remove();

                    const div = document.createElement('div');
                    div.className = 'achievement-card';
                    div.id = cardDomId;

                    const isUnlocked = unlockedIds.includes(achId);

                    let iconPath = ach.image ? `../../src/games/${gameId}/${ach.image}` : '../../src/assets/icon_placeholder.png';
                    let displayTitle = ach.title;
                    let displayDesc = ach.description;
                    let isSecret = false;
                    const isHidden = ach.secret || ach.hidden; // Support both

                    // Logic: If Locked AND (Secret OR Hidden) -> Apply Hiding
                    if (!isUnlocked && isHidden) {
                        isSecret = true;

                        // Steam-Style Hiding:
                        // Default view is "Hidden Achievement"
                        displayTitle = "Hidden Achievement";
                        displayDesc = "Details are hidden. (Click to reveal)";
                        iconPath = '../assets/imgs/const.png'; // Generic Icon
                    }

                    if (isUnlocked) {
                        div.style.borderColor = '#1DCD9F';
                        div.style.opacity = '1';
                    } else {
                        // Locked Style
                        div.style.borderColor = '#333';
                        div.style.opacity = '0.5';

                        if (isSecret) {
                            // Secret Handlers
                            div.style.cursor = 'pointer';
                            div.title = "Click to reveal spoiler";
                            div.className += ' spoiler-card'; // Marker class

                            // Store real data
                            div.dataset.hidden = 'true';
                            div.dataset.realTitle = ach.title;
                            div.dataset.realDesc = ach.description;
                            div.dataset.realIcon = ach.image ? `../../src/games/${gameId}/${ach.image}` : '../../src/assets/icon_placeholder.png';

                            div.onclick = function () {
                                if (this.dataset.hidden === 'true') {
                                    // Reveal Stage 1: Title + Blurred Icon, but keep Desc as ???
                                    this.dataset.hidden = 'false';
                                    this.querySelector('h4').innerText = this.dataset.realTitle;
                                    this.querySelector('p').innerText = "???";

                                    // Update Icon and blur it
                                    const img = this.querySelector('.achievement-icon');
                                    img.src = this.dataset.realIcon;
                                    img.classList.add('spoiler-blur');

                                    this.title = "Click to reveal description";
                                } else {
                                    // Reveal Stage 2: Full reveal
                                    this.querySelector('p').innerText = this.dataset.realDesc;
                                    const blurs = this.querySelectorAll('.spoiler-blur');
                                    if (blurs.length > 0) {
                                        blurs.forEach(el => el.classList.remove('spoiler-blur'));
                                    }
                                    this.style.opacity = '0.7';
                                    this.title = "";
                                    this.style.cursor = 'default';
                                    this.onclick = null;
                                }
                            };
                        } else {
                            div.style.filter = 'grayscale(100%)';
                        }
                    }

                    div.innerHTML = `
                        <img src="${iconPath}" class="achievement-icon" alt="Icon" onerror="this.style.display='none'">
                        <div class="achievement-info">
                            <h4>${escapeHtml(displayTitle)} ${isUnlocked ? '<img src="../assets/imgs/icons/check.svg" alt="Unlocked" style="width:14px;height:14px;vertical-align:middle;">' : ''}</h4>
                            <p>${escapeHtml(displayDesc)}</p>
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
    } finally {
        isLoadingDetails = false;
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
        // Fetch Top 5 with board key (Shorter leaderboard)
        const res = await fetch(`/api/scores?game=${gameId}&board=${boardKey}&limit=5`);
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

            // Avatar Logic - use placeholder with background to prevent flash
            const placeholderImg = '../assets/imgs/const.png';
            let avatarImg = placeholderImg;
            if (s.discord_id && s.avatar) {
                // Discord avatar hash can be animated (starts with a_) - use gif, otherwise png
                const ext = s.avatar.startsWith('a_') ? 'gif' : 'png';
                avatarImg = `https://cdn.discordapp.com/avatars/${s.discord_id}/${s.avatar}.${ext}`;
            }

            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="score-itm-rank">#${index + 1}</span>
                    <img src="${avatarImg}" style="width:24px; height:24px; border-radius:50%; background-color:#2a2a2a; border:1px solid #3a3a3a;" onerror="this.src='${placeholderImg}'">
                    <span>${escapeHtml(s.username)}</span>
                </div>
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
        // Get user's discord_id and avatar from localStorage
        const storedUser = localStorage.getItem('discord_user');
        let discord_id = null;
        let avatar = null;
        if (storedUser) {
            const userData = JSON.parse(storedUser);
            discord_id = userData.discord_id;
            avatar = userData.avatar;
        }

        const res = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                username: username,
                score: score,
                board_id: boardId,
                discord_id: discord_id,
                avatar: avatar
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
