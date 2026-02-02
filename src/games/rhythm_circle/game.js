// Rhythm Circle - Main Game Logic

// ===== GAME STATE =====
const GameState = {
    MENU: 'menu',
    SONG_SELECT: 'song-select',
    BROWSE: 'browse',
    SETTINGS: 'settings',
    PLAYING: 'playing',
    PAUSED: 'paused',
    RESULTS: 'results'
};

let currentState = GameState.MENU;
let songs = [];
let selectedSongIndex = 0;
let currentMap = null;
let availableMaps = []; // Maps available for download

// Game settings (loaded from localStorage)
let settings = {
    audioOffset: 0,
    keyRed: 'KeyD',
    keyBlue: 'KeyK',
    keyPause: 'Escape',
    mouseKey: 'red',
    volume: 0.8,
    approachRate: 1500,
    noteStyle: 'shrink'
};

// ===== GAME VARIABLES =====
let canvas, ctx;
let audio = null;
let gameStartTime = 0;
let isPaused = false;
let animationFrameId = null;

// Gameplay
let notes = [];
let activeHolds = [];
let score = 0;
let combo = 0;
let maxCombo = 0;
let accuracy = 100;
let totalHits = 0;
let judgmentCounts = { perfect: 0, great: 0, good: 0, miss: 0 };

// Visual settings
const CENTER_X = () => canvas.width / 2;
const CENTER_Y = () => canvas.height / 2;
const RING_RADIUS = 120;
const RING_THICKNESS = 15;
const NOTE_SPAWN_RADIUS = 400;
const NOTE_SIZE = 35;
let APPROACH_TIME = 1500; // ms for note to reach center (now configurable)

// Timing windows (in ms)
const TIMING = {
    PERFECT: 30,
    GREAT: 60,
    GOOD: 100,
    MISS: 150
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initCanvas();
    initMenuNavigation();
    loadSongs();
    updateSettingsUI();
    
    // Global key listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Show menu
    showScreen('menu-screen');
});

function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// ===== SCREEN MANAGEMENT =====
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.add('active');
    }
    
    // Update state
    switch (screenId) {
        case 'menu-screen':
            currentState = GameState.MENU;
            break;
        case 'song-select-screen':
            currentState = GameState.SONG_SELECT;
            updateSongSelect();
            break;
        case 'browse-screen':
            currentState = GameState.BROWSE;
            loadAvailableMaps();
            break;
        case 'settings-screen':
            currentState = GameState.SETTINGS;
            break;
        case 'game-screen':
            currentState = GameState.PLAYING;
            break;
        case 'results-screen':
            currentState = GameState.RESULTS;
            break;
    }
}

// ===== MENU NAVIGATION =====
function initMenuNavigation() {
    const options = document.querySelectorAll('.menu-option');
    let selectedIndex = 0;
    
    function selectOption(index) {
        options.forEach(o => o.classList.remove('selected'));
        options[index].classList.add('selected');
        document.getElementById('selected-option').textContent = options[index].querySelector('span').textContent;
    }
    
    options.forEach((opt, i) => {
        opt.addEventListener('click', () => {
            selectOption(i);
            activateMenuOption(opt.dataset.action);
        });
        opt.addEventListener('mouseenter', () => selectOption(i));
    });
    
    // Keyboard navigation for menu
    document.addEventListener('keydown', (e) => {
        if (currentState !== GameState.MENU) return;
        
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            selectedIndex = (selectedIndex - 1 + options.length) % options.length;
            selectOption(selectedIndex);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            selectedIndex = (selectedIndex + 1) % options.length;
            selectOption(selectedIndex);
        } else if (e.key === 'Enter' || e.key === ' ') {
            activateMenuOption(options[selectedIndex].dataset.action);
        }
    });
    
    selectOption(0);
}

function activateMenuOption(action) {
    switch (action) {
        case 'play':
            showScreen('song-select-screen');
            break;
        case 'browse':
            showScreen('browse-screen');
            break;
        case 'settings':
            showScreen('settings-screen');
            break;
        case 'editor':
            window.location.href = 'editor/index.html';
            break;
        case 'quit':
            window.history.back();
            break;
    }
}

// ===== SONG LOADING =====
async function loadSongs() {
    // Load songs from localStorage only (downloaded maps)
    const savedMaps = localStorage.getItem('rhythm_circle_maps');
    if (savedMaps) {
        try {
            songs = JSON.parse(savedMaps);
        } catch (e) {
            songs = [];
        }
    }
    
    // If no downloaded songs, show message
    if (songs.length === 0) {
        songs.push({
            id: 'no_songs',
            title: 'No Maps Downloaded',
            artist: 'Browse maps to download some!',
            difficulty: '-',
            difficultyLevel: 0,
            path: null
        });
    }
    
    updateSongSelect();
}

// ===== MAP BROWSING & DOWNLOAD =====
async function loadAvailableMaps() {
    const browseList = document.getElementById('browse-list');
    browseList.innerHTML = '<div class="loading">Loading available maps...</div>';
    
    // Get downloaded map IDs from localStorage
    const savedMaps = localStorage.getItem('rhythm_circle_maps');
    const downloadedMaps = savedMaps ? JSON.parse(savedMaps) : [];
    const downloadedIds = downloadedMaps.map(m => m.id);
    
    try {
        // Try to fetch available maps from the API
        const response = await fetch('/api/rhythm/maps');
        if (response.ok) {
            availableMaps = await response.json();
        }
    } catch (e) {
        console.log('API not available, loading local maps');
    }
    
    // Fallback: try to load demo song from maps folder
    if (availableMaps.length === 0) {
        try {
            const demoRes = await fetch('maps/demo_song/map.json');
            if (demoRes.ok) {
                const demoMap = await demoRes.json();
                availableMaps.push({
                    id: 'demo_song',
                    title: demoMap.title || 'Demo Song',
                    artist: demoMap.artist || 'Unknown',
                    difficulty: demoMap.difficulty || 'Normal',
                    difficultyLevel: demoMap.difficultyLevel || 3,
                    path: 'maps/demo_song',
                    mapData: demoMap
                });
            }
        } catch (e) {
            console.log('No demo song found');
        }
    }
    
    // Render the browse list
    if (availableMaps.length === 0) {
        browseList.innerHTML = '<div class="loading">No maps available. Create some in the editor!</div>';
        return;
    }
    
    browseList.innerHTML = availableMaps.map((map, i) => {
        const isDownloaded = downloadedIds.includes(map.id);
        const diffClass = getDifficultyClass(map.difficultyLevel);
        return `
            <div class="browse-card ${isDownloaded ? 'downloaded' : ''}" data-map-index="${i}">
                ${isDownloaded ? `<button class="delete-btn" onclick="deleteDownloadedMap('${map.id}')" title="Delete">×</button>` : ''}
                <div class="map-title">${escapeHtml(map.title)}</div>
                <div class="map-artist">${escapeHtml(map.artist)}</div>
                <div class="map-diff ${diffClass}">${escapeHtml(map.difficulty)}</div>
                <button class="download-btn ${isDownloaded ? 'downloaded' : ''}" 
                        onclick="downloadMap(${i})" 
                        ${isDownloaded ? 'disabled' : ''}>
                    ${isDownloaded ? '✓ Downloaded' : 'Download'}
                </button>
            </div>
        `;
    }).join('');
}

async function downloadMap(index) {
    const map = availableMaps[index];
    if (!map) return;
    
    try {
        // If mapData is not already included, fetch it
        let mapData = map.mapData;
        if (!mapData && map.path) {
            const res = await fetch(`${map.path}/map.json`);
            if (res.ok) {
                mapData = await res.json();
            }
        }
        
        if (!mapData) {
            alert('Failed to download map data');
            return;
        }
        
        // Get existing downloaded maps
        const savedMaps = localStorage.getItem('rhythm_circle_maps');
        const downloadedMaps = savedMaps ? JSON.parse(savedMaps) : [];
        
        // Check if already downloaded
        if (downloadedMaps.find(m => m.id === map.id)) {
            alert('Map already downloaded!');
            return;
        }
        
        // Add to downloaded maps
        downloadedMaps.push({
            id: map.id,
            title: map.title,
            artist: map.artist,
            difficulty: map.difficulty,
            difficultyLevel: map.difficultyLevel,
            path: null, // Local storage maps don't have paths
            mapData: mapData
        });
        
        // Save to localStorage
        localStorage.setItem('rhythm_circle_maps', JSON.stringify(downloadedMaps));
        
        // Reload songs and browse list
        loadSongs();
        loadAvailableMaps();
        
    } catch (e) {
        console.error('Failed to download map:', e);
        alert('Failed to download map');
    }
}

function deleteDownloadedMap(mapId) {
    if (!confirm('Are you sure you want to delete this map?')) return;
    
    const savedMaps = localStorage.getItem('rhythm_circle_maps');
    if (!savedMaps) return;
    
    let downloadedMaps = JSON.parse(savedMaps);
    downloadedMaps = downloadedMaps.filter(m => m.id !== mapId);
    
    localStorage.setItem('rhythm_circle_maps', JSON.stringify(downloadedMaps));
    
    // Reload
    loadSongs();
    loadAvailableMaps();
}

function updateSongSelect() {
    const songList = document.getElementById('song-list');
    songList.innerHTML = '';
    
    songs.forEach((song, i) => {
        const card = document.createElement('div');
        card.className = 'song-card' + (i === selectedSongIndex ? ' selected' : '');
        card.onclick = () => selectSong(i);
        
        const diffClass = getDifficultyClass(song.difficultyLevel);
        
        card.innerHTML = `
            <div class="song-name">${escapeHtml(song.title)}</div>
            <div class="song-artist">${escapeHtml(song.artist)}</div>
            <div class="song-diff ${diffClass}">${escapeHtml(song.difficulty)}</div>
        `;
        songList.appendChild(card);
    });
    
    updateSongInfo();
}

function selectSong(index) {
    selectedSongIndex = index;
    document.querySelectorAll('.song-card').forEach((c, i) => {
        c.classList.toggle('selected', i === index);
    });
    updateSongInfo();
}

function updateSongInfo() {
    const song = songs[selectedSongIndex];
    if (!song) return;
    
    document.getElementById('song-title').textContent = song.title;
    document.getElementById('song-artist').textContent = song.artist;
    document.getElementById('song-difficulty').textContent = `Difficulty: ${song.difficulty}`;
}

function rotateSongs(direction) {
    selectedSongIndex = (selectedSongIndex + direction + songs.length) % songs.length;
    selectSong(selectedSongIndex);
    
    // Scroll to selected
    const songList = document.getElementById('song-list');
    const cards = songList.querySelectorAll('.song-card');
    if (cards[selectedSongIndex]) {
        cards[selectedSongIndex].scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
}

function getDifficultyClass(level) {
    if (level <= 2) return 'easy';
    if (level <= 4) return 'normal';
    if (level <= 6) return 'hard';
    return 'expert';
}

// ===== SETTINGS =====
function loadSettings() {
    const saved = localStorage.getItem('rhythm_circle_settings');
    if (saved) {
        try {
            settings = { ...settings, ...JSON.parse(saved) };
        } catch (e) {}
    }
}

function saveSettings() {
    settings.audioOffset = parseInt(document.getElementById('audio-offset').value);
    settings.volume = parseInt(document.getElementById('volume').value) / 100;
    settings.mouseKey = document.getElementById('mouse-key').value;
    settings.approachRate = parseInt(document.getElementById('approach-rate').value);
    settings.noteStyle = document.getElementById('note-style').value;
    
    // Update the approach time
    APPROACH_TIME = settings.approachRate;
    
    localStorage.setItem('rhythm_circle_settings', JSON.stringify(settings));
    showScreen('menu-screen');
}

function updateSettingsUI() {
    document.getElementById('audio-offset').value = settings.audioOffset;
    document.getElementById('offset-value').textContent = `${settings.audioOffset}ms`;
    document.getElementById('volume').value = settings.volume * 100;
    document.getElementById('volume-value').textContent = `${Math.round(settings.volume * 100)}%`;
    document.getElementById('key-red').textContent = getKeyName(settings.keyRed);
    document.getElementById('key-red').dataset.key = settings.keyRed;
    document.getElementById('key-blue').textContent = getKeyName(settings.keyBlue);
    document.getElementById('key-blue').dataset.key = settings.keyBlue;
    document.getElementById('key-pause').textContent = getKeyName(settings.keyPause);
    document.getElementById('key-pause').dataset.key = settings.keyPause;
    document.getElementById('mouse-key').value = settings.mouseKey;
    document.getElementById('approach-rate').value = settings.approachRate;
    document.getElementById('approach-rate-value').textContent = `${settings.approachRate}ms`;
    document.getElementById('note-style').value = settings.noteStyle;
    
    // Apply approach rate
    APPROACH_TIME = settings.approachRate;
    
    // Slider listeners
    document.getElementById('audio-offset').oninput = (e) => {
        document.getElementById('offset-value').textContent = `${e.target.value}ms`;
    };
    document.getElementById('volume').oninput = (e) => {
        document.getElementById('volume-value').textContent = `${e.target.value}%`;
    };
    document.getElementById('approach-rate').oninput = (e) => {
        document.getElementById('approach-rate-value').textContent = `${e.target.value}ms`;
    };
    
    // Key binding
    const keyBinds = document.querySelectorAll('.key-bind');
    keyBinds.forEach(btn => {
        btn.onclick = () => startKeyBind(btn);
    });
}

let listeningForKey = null;

function startKeyBind(btn) {
    document.querySelectorAll('.key-bind').forEach(b => b.classList.remove('listening'));
    btn.classList.add('listening');
    btn.textContent = 'Press key...';
    listeningForKey = btn;
}

function handleKeyBindInput(e) {
    if (!listeningForKey) return false;
    
    e.preventDefault();
    const key = e.code;
    
    if (listeningForKey.id === 'key-red') {
        settings.keyRed = key;
    } else if (listeningForKey.id === 'key-blue') {
        settings.keyBlue = key;
    } else if (listeningForKey.id === 'key-pause') {
        settings.keyPause = key;
    }
    
    listeningForKey.textContent = getKeyName(key);
    listeningForKey.dataset.key = key;
    listeningForKey.classList.remove('listening');
    listeningForKey = null;
    return true;
}

function getKeyName(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code.replace('Arrow', '').replace('Left', 'L').replace('Right', 'R');
}

// ===== GAME START =====
async function startGame() {
    const song = songs[selectedSongIndex];
    if (!song || song.id === 'no_songs') {
        alert('Please download a map from the Browse section first!');
        return;
    }
    
    // Load map - check if it's from localStorage (has mapData) or from path
    try {
        if (song.mapData) {
            // Map is stored in localStorage
            currentMap = song.mapData;
        } else if (song.path) {
            // Map is from server path
            const mapRes = await fetch(`${song.path}/map.json`);
            currentMap = await mapRes.json();
        } else {
            alert('Map data not available');
            return;
        }
    } catch (e) {
        alert('Failed to load map');
        return;
    }
    
    // Load audio - for localStorage maps, we need to handle audio differently
    try {
        let audioPath;
        if (song.path) {
            audioPath = `${song.path}/${currentMap.audioFile || 'song.mp3'}`;
        } else if (currentMap.audioFile) {
            // Try to find audio in default maps location
            audioPath = `maps/${song.id}/${currentMap.audioFile}`;
        } else {
            // No audio available - use a silent fallback or notify user
            console.log('No audio file specified');
            audioPath = null;
        }
        
        if (audioPath) {
            audio = new Audio(audioPath);
            audio.volume = settings.volume;
            await new Promise((resolve, reject) => {
                audio.addEventListener('canplaythrough', resolve, { once: true });
                audio.addEventListener('error', reject, { once: true });
                audio.load();
            });
        } else {
            // Create a dummy audio for timing (maps without audio)
            audio = null;
        }
    } catch (e) {
        console.log('Audio load failed, continuing without audio');
        audio = null;
    }
    
    // Reset game state
    resetGameState();
    
    // Show game screen
    showScreen('game-screen');
    
    // Start after short delay
    setTimeout(() => {
        if (audio) audio.play();
        gameStartTime = performance.now();
        isPaused = false;
        gameLoop();
    }, 1000);
}

function resetGameState() {
    score = 0;
    combo = 0;
    maxCombo = 0;
    totalHits = 0;
    accuracy = 100;
    judgmentCounts = { perfect: 0, great: 0, good: 0, miss: 0 };
    
    // Load notes from map
    notes = currentMap.notes.map(n => ({
        ...n,
        hit: false,
        missed: false,
        holdProgress: 0,
        spamCount: 0
    }));
    
    activeHolds = [];
    updateHUD();
}

// ===== GAME LOOP =====
function gameLoop() {
    if (currentState !== GameState.PLAYING || isPaused) return;
    
    const currentTime = getCurrentTime();
    
    // Clear canvas
    ctx.fillStyle = 'rgba(10, 10, 26, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw background effects
    drawBackground();
    
    // Draw center ring (indicator)
    drawCenterRing();
    
    // Update and draw notes
    updateNotes(currentTime);
    drawNotes(currentTime);
    
    // Draw hold effects
    drawHoldEffects();
    
    // Check for song end
    if (audio && audio.ended) {
        endGame();
        return;
    }
    
    // Check if all notes are done (for maps without audio)
    if (!audio) {
        const allNotesDone = notes.every(n => n.hit || n.missed);
        const lastNoteTime = notes.length > 0 ? Math.max(...notes.map(n => n.endTime || n.time)) : 0;
        if (allNotesDone && currentTime > lastNoteTime + 1000) {
            endGame();
            return;
        }
    }
    
    animationFrameId = requestAnimationFrame(gameLoop);
}

function getCurrentTime() {
    if (!audio) {
        // Fallback to performance timing when no audio
        return (performance.now() - gameStartTime) + settings.audioOffset;
    }
    return (audio.currentTime * 1000) + settings.audioOffset;
}

// ===== DRAWING =====
function drawBackground() {
    const cx = CENTER_X();
    const cy = CENTER_Y();
    
    // Subtle pulsing background circles
    const pulse = Math.sin(performance.now() / 500) * 0.1 + 0.9;
    
    for (let i = 5; i >= 1; i--) {
        const radius = NOTE_SPAWN_RADIUS * (i / 5) * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(50, 50, 80, ${0.1 / i})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawCenterRing() {
    const cx = CENTER_X();
    const cy = CENTER_Y();
    
    // Outer ring (filled donut shape - filled except middle)
    ctx.beginPath();
    ctx.arc(cx, cy, RING_RADIUS + RING_THICKNESS, 0, Math.PI * 2);
    ctx.arc(cx, cy, RING_RADIUS - RING_THICKNESS, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fill();
    
    // Ring border
    ctx.beginPath();
    ctx.arc(cx, cy, RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Inner glow on combo
    if (combo > 0) {
        const intensity = Math.min(combo / 50, 1);
        ctx.beginPath();
        ctx.arc(cx, cy, RING_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 51, 102, ${intensity * 0.8})`;
        ctx.lineWidth = 6;
        ctx.stroke();
    }
}

function drawNotes(currentTime) {
    const cx = CENTER_X();
    const cy = CENTER_Y();
    
    notes.forEach(note => {
        if (note.hit || note.missed) return;
        
        const timeUntilHit = note.time - currentTime;
        if (timeUntilHit > APPROACH_TIME || timeUntilHit < -TIMING.MISS) return;
        
        // Angle for this note (use note's angle or default)
        const angle = (note.angle || 0) * Math.PI / 180;
        
        // Note color based on type
        let color;
        if (note.type === 'red') {
            color = '#ff3366';
        } else if (note.type === 'blue') {
            color = '#33ccff';
        } else if (note.type === 'spam') {
            color = '#ffcc00';
        } else {
            color = '#ff3366';
        }
        
        // Calculate based on note style setting
        if (settings.noteStyle === 'shrink') {
            // SHRINKING APPROACH CIRCLE STYLE
            // Note stays at hit position, approach circle shrinks toward it
            const hitX = cx + Math.cos(angle) * RING_RADIUS;
            const hitY = cy + Math.sin(angle) * RING_RADIUS;
            
            // Progress from 0 (just appeared) to 1 (hit time)
            const progress = 1 - (timeUntilHit / APPROACH_TIME);
            
            // Approach circle shrinks from large to note size
            const approachRadius = NOTE_SIZE + (NOTE_SPAWN_RADIUS - RING_RADIUS) * (1 - progress);
            
            // Draw the hit circle (static at hit position)
            ctx.beginPath();
            ctx.arc(hitX, hitY, NOTE_SIZE, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = Math.min(progress * 2, 1); // Fade in
            ctx.fill();
            
            // Note border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = 1;
            
            // Draw the shrinking approach circle
            if (timeUntilHit > 0) {
                ctx.beginPath();
                ctx.arc(hitX, hitY, approachRadius, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 4;
                ctx.globalAlpha = 0.8;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            
            // Hold note indicator
            if (note.type === 'hold' && note.endTime) {
                const holdDuration = note.endTime - note.time;
                // Draw a ring around the note to indicate hold
                ctx.beginPath();
                ctx.arc(hitX, hitY, NOTE_SIZE + 8, 0, Math.PI * 2);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            
            // Spam note indicator
            if (note.type === 'spam' && note.spamRequired) {
                ctx.fillStyle = '#000';
                ctx.font = 'bold 16px Orbitron';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${note.spamRequired - (note.spamCount || 0)}`, hitX, hitY);
            }
        } else {
            // ORIGINAL APPROACH STYLE - notes fly toward center
            const progress = 1 - (timeUntilHit / APPROACH_TIME);
            const radius = NOTE_SPAWN_RADIUS - (NOTE_SPAWN_RADIUS - RING_RADIUS) * progress;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            
            // Draw note
            ctx.beginPath();
            ctx.arc(x, y, NOTE_SIZE, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            
            // Note border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Hold note trail
            if (note.type === 'hold' && note.endTime) {
                const holdDuration = note.endTime - note.time;
                const endTimeUntil = note.endTime - currentTime;
                const endProgress = 1 - (endTimeUntil / APPROACH_TIME);
                const endRadius = Math.max(RING_RADIUS, NOTE_SPAWN_RADIUS - (NOTE_SPAWN_RADIUS - RING_RADIUS) * endProgress);
                
                // Draw trail
                ctx.beginPath();
                ctx.moveTo(x, y);
                const endX = cx + Math.cos(angle) * endRadius;
                const endY = cy + Math.sin(angle) * endRadius;
                ctx.lineTo(endX, endY);
                ctx.strokeStyle = color;
                ctx.lineWidth = NOTE_SIZE * 1.5;
                ctx.lineCap = 'round';
                ctx.globalAlpha = 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            
            // Spam note indicator
            if (note.type === 'spam' && note.spamRequired) {
                ctx.fillStyle = '#000';
                ctx.font = 'bold 16px Orbitron';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${note.spamRequired - (note.spamCount || 0)}`, x, y);
            }
        }
    });
}

function drawHoldEffects() {
    const cx = CENTER_X();
    const cy = CENTER_Y();
    
    activeHolds.forEach(note => {
        const angle = (note.angle || 0) * Math.PI / 180;
        const x = cx + Math.cos(angle) * RING_RADIUS;
        const y = cy + Math.sin(angle) * RING_RADIUS;
        
        // Glow effect
        ctx.beginPath();
        ctx.arc(x, y, NOTE_SIZE + 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 51, 102, 0.5)';
        ctx.fill();
    });
}

// ===== NOTE UPDATES =====
function updateNotes(currentTime) {
    notes.forEach(note => {
        if (note.hit || note.missed) return;
        
        const timeDiff = currentTime - note.time;
        
        // Check for miss
        if (timeDiff > TIMING.MISS) {
            note.missed = true;
            processJudgment('miss', note);
        }
    });
    
    // Update active holds
    activeHolds = activeHolds.filter(note => {
        const holdTime = getCurrentTime();
        if (holdTime >= note.endTime) {
            // Hold completed successfully
            note.hit = true;
            processJudgment('perfect', note, true);
            return false;
        }
        return true;
    });
}

// ===== INPUT HANDLING =====
function handleKeyDown(e) {
    // Settings key binding
    if (listeningForKey) {
        if (handleKeyBindInput(e)) return;
    }
    
    // Pause - use configurable pause key
    if (e.code === settings.keyPause) {
        if (currentState === GameState.PLAYING) {
            pauseGame();
        } else if (isPaused) {
            resumeGame();
        }
        return;
    }
    
    // Game input
    if (currentState !== GameState.PLAYING || isPaused) return;
    
    if (e.code === settings.keyRed) {
        hitNote('red');
    } else if (e.code === settings.keyBlue) {
        hitNote('blue');
    }
}

function handleKeyUp(e) {
    if (currentState !== GameState.PLAYING) return;
    
    // Release holds
    if (e.code === settings.keyRed || e.code === settings.keyBlue) {
        releaseHold();
    }
}

function handleMouseDown(e) {
    if (currentState !== GameState.PLAYING || isPaused) return;
    if (settings.mouseKey === 'none') return;
    
    const type = settings.mouseKey; // 'red' or 'blue'
    hitNote(type);
}

function handleMouseUp(e) {
    if (currentState !== GameState.PLAYING) return;
    if (settings.mouseKey === 'none') return;
    
    releaseHold();
}

function hitNote(inputType) {
    const currentTime = getCurrentTime();
    
    // Find closest hittable note of matching type
    let closestNote = null;
    let closestDiff = Infinity;
    
    notes.forEach(note => {
        if (note.hit || note.missed) return;
        
        // Check type match - spam/hold notes can be hit by either key, 
        // red notes only by red input, blue notes only by blue input
        if (note.type === 'red' && inputType !== 'red') return;
        if (note.type === 'blue' && inputType !== 'blue') return;
        // spam and hold notes accept any input type
        
        const timeDiff = Math.abs(currentTime - note.time);
        if (timeDiff < closestDiff && timeDiff <= TIMING.MISS) {
            closestDiff = timeDiff;
            closestNote = note;
        }
    });
    
    if (closestNote) {
        // Handle spam notes
        if (closestNote.type === 'spam') {
            closestNote.spamCount = (closestNote.spamCount || 0) + 1;
            if (closestNote.spamCount >= closestNote.spamRequired) {
                closestNote.hit = true;
                processJudgment('perfect', closestNote);
            } else {
                // Partial hit feedback
                showJudgment('');
                combo++;
                score += 10;
            }
            return;
        }
        
        // Handle hold notes
        if (closestNote.type === 'hold') {
            if (closestDiff <= TIMING.MISS) {
                activeHolds.push(closestNote);
                showJudgment('hold');
            }
            return;
        }
        
        // Regular notes
        closestNote.hit = true;
        
        // Determine judgment
        let judgment;
        if (closestDiff <= TIMING.PERFECT) {
            judgment = 'perfect';
        } else if (closestDiff <= TIMING.GREAT) {
            judgment = 'great';
        } else if (closestDiff <= TIMING.GOOD) {
            judgment = 'good';
        } else {
            judgment = 'miss';
        }
        
        processJudgment(judgment, closestNote);
    }
}

function releaseHold() {
    // Early release of hold notes
    const currentTime = getCurrentTime();
    
    activeHolds.forEach(note => {
        const remaining = note.endTime - currentTime;
        const total = note.endTime - note.time;
        const progress = 1 - (remaining / total);
        
        if (progress >= 0.8) {
            // Good enough
            note.hit = true;
            processJudgment('great', note, true);
        } else {
            // Too early
            note.missed = true;
            processJudgment('miss', note, true);
        }
    });
    
    activeHolds = [];
}

function processJudgment(judgment, note, isHold = false) {
    judgmentCounts[judgment]++;
    totalHits++;
    
    // Score calculation
    const baseScore = {
        perfect: 300,
        great: 200,
        good: 100,
        miss: 0
    };
    
    if (judgment === 'miss') {
        combo = 0;
    } else {
        combo++;
        maxCombo = Math.max(maxCombo, combo);
        
        // Combo multiplier
        const multiplier = Math.min(1 + combo * 0.01, 2);
        score += Math.floor(baseScore[judgment] * multiplier);
    }
    
    // Update accuracy
    const weights = { perfect: 100, great: 75, good: 50, miss: 0 };
    const totalWeight = judgmentCounts.perfect * 100 + judgmentCounts.great * 75 + 
                       judgmentCounts.good * 50 + judgmentCounts.miss * 0;
    accuracy = totalHits > 0 ? (totalWeight / totalHits) : 100;
    
    showJudgment(judgment);
    updateHUD();
}

function showJudgment(judgment) {
    const el = document.getElementById('judgment');
    el.className = 'judgment show ' + judgment;
    el.textContent = judgment.toUpperCase();
    
    setTimeout(() => {
        el.classList.remove('show');
    }, 200);
}

function updateHUD() {
    document.getElementById('score').textContent = score.toLocaleString();
    document.getElementById('combo').textContent = combo;
    document.getElementById('accuracy').textContent = `${accuracy.toFixed(2)}%`;
}

// ===== PAUSE/RESUME =====
function pauseGame() {
    isPaused = true;
    if (audio) audio.pause();
    document.getElementById('pause-overlay').classList.remove('hidden');
}

function resumeGame() {
    isPaused = false;
    document.getElementById('pause-overlay').classList.add('hidden');
    if (audio) audio.play();
    gameLoop();
}

function restartGame() {
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
    document.getElementById('pause-overlay').classList.add('hidden');
    startGame();
}

function exitToMenu() {
    if (audio) {
        audio.pause();
        audio = null;
    }
    cancelAnimationFrame(animationFrameId);
    document.getElementById('pause-overlay').classList.add('hidden');
    showScreen('song-select-screen');
}

// ===== END GAME =====
function endGame() {
    cancelAnimationFrame(animationFrameId);
    if (audio) audio.pause();
    
    // Calculate PP (Performance Points)
    const pp = calculatePP();
    
    // Determine grade
    const grade = getGrade(accuracy);
    
    // Update results screen
    document.getElementById('result-title').textContent = songs[selectedSongIndex].title;
    document.getElementById('result-grade').textContent = grade;
    document.getElementById('result-grade').className = 'result-grade ' + grade.toLowerCase();
    document.getElementById('result-score').textContent = score.toLocaleString();
    document.getElementById('result-accuracy').textContent = `${accuracy.toFixed(2)}%`;
    document.getElementById('result-combo').textContent = maxCombo;
    document.getElementById('result-pp').textContent = `+${pp}`;
    document.getElementById('count-perfect').textContent = judgmentCounts.perfect;
    document.getElementById('count-great').textContent = judgmentCounts.great;
    document.getElementById('count-good').textContent = judgmentCounts.good;
    document.getElementById('count-miss').textContent = judgmentCounts.miss;
    
    // Submit score
    submitScore(score, pp);
    
    showScreen('results-screen');
}

function calculatePP() {
    const song = songs[selectedSongIndex];
    const diffMultiplier = (song.difficultyLevel || 3) * 10;
    const accMultiplier = Math.pow(accuracy / 100, 3);
    const comboBonus = maxCombo / notes.length;
    
    // PP formula (simplified version inspired by osu!)
    let pp = diffMultiplier * accMultiplier * (1 + comboBonus * 0.5);
    
    // Full combo bonus
    if (judgmentCounts.miss === 0) {
        pp *= 1.1;
    }
    
    return Math.floor(pp);
}

function getGrade(acc) {
    if (acc >= 95) return 'S';
    if (acc >= 90) return 'A';
    if (acc >= 80) return 'B';
    if (acc >= 70) return 'C';
    return 'D';
}

// ===== API INTEGRATION =====
async function submitScore(finalScore, pp) {
    const song = songs[selectedSongIndex];
    const storedUser = localStorage.getItem('discord_user');
    const user = storedUser ? JSON.parse(storedUser) : { username: 'Anonymous' };
    
    try {
        // Submit regular score
        await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: 'rhythm_circle',
                username: user.username,
                score: finalScore,
                board_id: song.id
            })
        });
        
        // Submit PP score
        await fetch('/api/rhythm/pp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: user.username,
                song_id: song.id,
                score: finalScore,
                pp: pp,
                accuracy: accuracy,
                max_combo: maxCombo
            })
        });
        
        // Check achievements
        if (judgmentCounts.miss === 0 && notes.length > 0) {
            unlockAchievement('perfect_combo');
        }
        unlockAchievement('first_clear');
        
    } catch (e) {
        console.log('Score submission failed (offline mode)');
    }
}

async function unlockAchievement(achievementId) {
    const storedUser = localStorage.getItem('discord_user');
    if (!storedUser) return;
    
    const user = JSON.parse(storedUser);
    
    try {
        await fetch('/api/achievements/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: 'rhythm_circle',
                username: user.username,
                achievement_id: achievementId
            })
        });
    } catch (e) {}
}

// ===== UTILITIES =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
