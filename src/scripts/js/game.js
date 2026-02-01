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
    // Simpler: Fetch all games and find ours to get the nice name/desc.    
    loadGameDetails();
    loadScores();
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

async function loadScores() {
    const list = document.getElementById('score-list');
    try {
        // Fetch Top 10
        const res = await fetch(`/api/scores?game=${gameId}&limit=10`);
        const scores = await res.json();

        // Safety Check
        if (!Array.isArray(scores)) {
            console.error("Invalid scores response:", scores);
            list.innerHTML = '<li class="score-item" style="color: red;">Failed to load scores.</li>';
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
            fetchUserRank(currentUser, list);
        }

    } catch (err) {
        console.error("Error loading scores", err);
        list.innerHTML = '<li class="score-item">Error loading scores</li>';
    }
}



async function fetchUserRank(username, listElement) {
    try {
        const res = await fetch(`/api/scores/rank?game=${gameId}&username=${username}`);
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

async function submitScore(username, score) {
    try {
        const res = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                username: username,
                score: score
            })
        });

        if (res.ok) {
            loadScores(); // Refresh
        } else {
            alert("Failed to save score");
        }
    } catch (err) {
        console.error(err);
    }
}

// Utility
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Listen for messages from Iframe (Game)


function loginDiscord() {
    window.location.href = '/api/auth/discord';
}


// Check Auth State on Load & Apply Global Settings
document.addEventListener('DOMContentLoaded', () => {
    // Auth Display not needed in sidebar anymore? 
    // User requested "discord login... global for every game"
    // So we don't need the login button here, just the ability to submit scores (which we have).
    // But maybe we should show "Logged in as..." somewhere so they know?
    // User implies the HUB has the settings/profile. Game page is for playing.

    // Apply Global Volume
    const vol = localStorage.getItem('global_volume') || 100;
    setTimeout(() => {
        updateVolume(vol); // Send to iframe once loaded
        updateUserInGame(); // Send User Info
    }, 1000); // Small delay for iframe load
});

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
