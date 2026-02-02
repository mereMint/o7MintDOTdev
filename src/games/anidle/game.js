// Anidle Game Logic

// Game State
let gameState = {
    mode: 'daily', // 'daily' or 'unlimited'
    targetAnime: null,
    tries: 21,
    maxTries: 21,
    guesses: [],
    startTime: null,
    elapsedSeconds: 0,
    timerInterval: null,
    gameOver: false,
    won: false
};

// User info
const storedUser = localStorage.getItem('discord_user');
const user = storedUser ? JSON.parse(storedUser) : { username: "Anonymous" };

// Anime list cache for autocomplete
let animeList = [];
let selectedAutocompleteIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('user-display').innerText = `Player: ${user.username}`;
    
    // Load anime list for autocomplete
    loadAnimeList();
    
    // Start game
    startGame('daily');
    
    // Setup autocomplete
    setupAutocomplete();
});

// Load anime list from API
async function loadAnimeList() {
    try {
        const res = await fetch('/api/anidle/anime-list');
        if (res.ok) {
            animeList = await res.json();
        }
    } catch (err) {
        console.error('Failed to load anime list:', err);
    }
}

// Select game mode
function selectMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(mode === 'daily' ? 'daily-btn' : 'unlimited-btn').classList.add('active');
    
    gameState.mode = mode;
    startGame(mode);
}

// Start a new game
async function startGame(mode) {
    // Reset state
    gameState = {
        mode: mode,
        targetAnime: null,
        tries: 21,
        maxTries: 21,
        guesses: [],
        startTime: Date.now(),
        elapsedSeconds: 0,
        timerInterval: null,
        gameOver: false,
        won: false
    };
    
    // Clear UI
    document.getElementById('guess-history').innerHTML = '';
    document.getElementById('guess-input').value = '';
    document.getElementById('guess-input').disabled = false;
    document.getElementById('guess-btn').disabled = false;
    document.getElementById('tries-count').textContent = '21';
    document.getElementById('result-screen').style.display = 'none';
    document.getElementById('hints-container').style.display = 'none';
    document.getElementById('hint-cover').style.display = 'none';
    document.getElementById('hint-synopsis').style.display = 'none';
    document.getElementById('hint-character').style.display = 'none';
    
    // Reset clues
    document.getElementById('clue-score').textContent = '?';
    document.getElementById('clue-studio').textContent = '?';
    document.getElementById('clue-genres').innerHTML = '<span class="tag">?</span>';
    document.getElementById('clue-release').textContent = '?';
    document.getElementById('clue-source').textContent = '?';
    document.getElementById('clue-tags').innerHTML = '<span class="tag">?</span>';
    
    // Show/hide play again button
    document.getElementById('play-again-btn').style.display = mode === 'unlimited' ? 'inline-block' : 'none';
    
    // Start timer
    startTimer();
    
    // Load target anime
    try {
        const endpoint = mode === 'daily' ? '/api/anidle/daily' : '/api/anidle/random';
        const res = await fetch(endpoint);
        if (res.ok) {
            const data = await res.json();
            gameState.targetAnime = data;
            displayClues(data);
        } else {
            console.error('Failed to load anime');
            alert('Failed to load game. Please try again.');
        }
    } catch (err) {
        console.error('Error loading game:', err);
        alert('Failed to connect to server.');
    }
}

// Display clues for the target anime
function displayClues(anime) {
    document.getElementById('clue-score').textContent = anime.score ? anime.score.toFixed(2) : 'N/A';
    document.getElementById('clue-studio').textContent = anime.studio || 'Unknown';
    document.getElementById('clue-release').textContent = anime.release_date || 'Unknown';
    document.getElementById('clue-source').textContent = anime.source || 'Unknown';
    
    // Display genres
    const genresContainer = document.getElementById('clue-genres');
    genresContainer.innerHTML = '';
    if (anime.genres && anime.genres.length > 0) {
        anime.genres.forEach(genre => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = genre;
            tag.dataset.genre = genre;
            genresContainer.appendChild(tag);
        });
    } else {
        genresContainer.innerHTML = '<span class="tag">None</span>';
    }
    
    // Display tags
    const tagsContainer = document.getElementById('clue-tags');
    tagsContainer.innerHTML = '';
    if (anime.tags && anime.tags.length > 0) {
        anime.tags.slice(0, 8).forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag';
            tagEl.textContent = tag.name || tag;
            tagEl.dataset.tag = tag.name || tag;
            tagEl.dataset.primary = tag.primary ? 'true' : 'false';
            tagsContainer.appendChild(tagEl);
        });
    } else {
        tagsContainer.innerHTML = '<span class="tag">None</span>';
    }
}

// Timer functions
function startTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }
    
    gameState.startTime = Date.now();
    gameState.elapsedSeconds = 0;
    updateTimerDisplay();
    
    gameState.timerInterval = setInterval(() => {
        gameState.elapsedSeconds = Math.floor((Date.now() - gameState.startTime) / 1000);
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
}

function updateTimerDisplay() {
    const mins = Math.floor(gameState.elapsedSeconds / 60);
    const secs = gameState.elapsedSeconds % 60;
    document.getElementById('timer-display').textContent = `Time: ${mins}:${secs.toString().padStart(2, '0')}`;
}

// Autocomplete setup
function setupAutocomplete() {
    const input = document.getElementById('guess-input');
    const autocompleteList = document.getElementById('autocomplete-list');
    
    input.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        selectedAutocompleteIndex = -1;
        
        if (query.length < 2) {
            autocompleteList.style.display = 'none';
            return;
        }
        
        // Filter anime list
        const matches = animeList.filter(anime => {
            const title = (anime.title || anime.name || '').toLowerCase();
            const titleEnglish = (anime.title_english || '').toLowerCase();
            return title.includes(query) || titleEnglish.includes(query);
        }).slice(0, 10);
        
        if (matches.length === 0) {
            autocompleteList.style.display = 'none';
            return;
        }
        
        // Display matches
        autocompleteList.innerHTML = '';
        matches.forEach((anime, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.dataset.index = index;
            
            const img = document.createElement('img');
            img.src = anime.image || '/src/assets/imgs/const.png';
            img.alt = anime.title || anime.name;
            img.onerror = function() { this.src = '/src/assets/imgs/const.png'; };
            
            const span = document.createElement('span');
            span.textContent = anime.title || anime.name;
            
            item.appendChild(img);
            item.appendChild(span);
            
            item.addEventListener('click', () => {
                input.value = anime.title || anime.name;
                input.dataset.selectedId = anime.mal_id || anime.id;
                autocompleteList.style.display = 'none';
            });
            
            autocompleteList.appendChild(item);
        });
        
        autocompleteList.style.display = 'block';
    });
    
    // Keyboard navigation
    input.addEventListener('keydown', function(e) {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
            updateAutocompleteSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
            updateAutocompleteSelection(items);
        } else if (e.key === 'Enter') {
            if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
                e.preventDefault();
                items[selectedAutocompleteIndex].click();
            } else if (input.value.trim()) {
                e.preventDefault();
                submitGuess();
            }
        } else if (e.key === 'Escape') {
            autocompleteList.style.display = 'none';
        }
    });
    
    // Close on outside click
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !autocompleteList.contains(e.target)) {
            autocompleteList.style.display = 'none';
        }
    });
}

function updateAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === selectedAutocompleteIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

// Submit a guess
async function submitGuess() {
    if (gameState.gameOver || gameState.tries <= 0) return;
    
    const input = document.getElementById('guess-input');
    const guessName = input.value.trim();
    
    if (!guessName) {
        alert('Please enter an anime name!');
        return;
    }
    
    // Check if already guessed
    if (gameState.guesses.some(g => g.name.toLowerCase() === guessName.toLowerCase())) {
        alert('You already guessed that anime!');
        return;
    }
    
    // Disable input while processing
    input.disabled = true;
    document.getElementById('guess-btn').disabled = true;
    
    try {
        // Send guess to server for comparison
        const res = await fetch('/api/anidle/guess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guess: guessName,
                target_id: gameState.targetAnime.mal_id || gameState.targetAnime.id,
                mode: gameState.mode
            })
        });
        
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Invalid guess');
            input.disabled = false;
            document.getElementById('guess-btn').disabled = false;
            return;
        }
        
        const result = await res.json();
        
        // Decrement tries
        gameState.tries--;
        document.getElementById('tries-count').textContent = gameState.tries;
        
        // Add to guess history
        gameState.guesses.push({
            name: result.guessed_anime.title || result.guessed_anime.name,
            comparison: result.comparison,
            correct: result.correct
        });
        
        // Display guess result
        displayGuessResult(result);
        
        // Check for hints
        checkHints();
        
        // Check win/lose conditions
        if (result.correct) {
            endGame(true);
        } else if (gameState.tries <= 0) {
            endGame(false);
        }
        
        // Clear input
        input.value = '';
        input.dataset.selectedId = '';
        
    } catch (err) {
        console.error('Guess error:', err);
        alert('Error submitting guess. Please try again.');
    } finally {
        if (!gameState.gameOver) {
            input.disabled = false;
            document.getElementById('guess-btn').disabled = false;
            input.focus();
        }
    }
}

// Display guess result in history
function displayGuessResult(result) {
    const historyContainer = document.getElementById('guess-history');
    const guessedAnime = result.guessed_anime;
    const comparison = result.comparison;
    
    const item = document.createElement('div');
    item.className = 'history-item';
    
    // Check how close the guess was
    let matchCount = 0;
    if (comparison.score_match) matchCount++;
    if (comparison.studio_match) matchCount++;
    if (comparison.source_match) matchCount++;
    if (comparison.genres_match && comparison.genres_match.correct > 0) matchCount++;
    
    if (matchCount >= 3) {
        item.classList.add('close');
    }
    
    // Build comparison tags
    let tagsHtml = '';
    
    // Score comparison
    tagsHtml += `<span class="comparison-tag ${comparison.score_match ? 'match' : 'miss'}">
        Score: ${guessedAnime.score || 'N/A'} ${comparison.score_direction || ''}
    </span>`;
    
    // Studio comparison
    tagsHtml += `<span class="comparison-tag ${comparison.studio_match ? 'match' : 'miss'}">
        Studio: ${guessedAnime.studio || 'Unknown'}
    </span>`;
    
    // Release year comparison
    tagsHtml += `<span class="comparison-tag ${comparison.release_match ? 'match' : 'miss'}">
        Release: ${guessedAnime.release_date || 'Unknown'} ${comparison.release_direction || ''}
    </span>`;
    
    // Source comparison
    tagsHtml += `<span class="comparison-tag ${comparison.source_match ? 'match' : 'miss'}">
        Source: ${guessedAnime.source || 'Unknown'}
    </span>`;
    
    // Genres comparison
    if (comparison.genres_match) {
        const genreClass = comparison.genres_match.correct > 0 
            ? (comparison.genres_match.correct === comparison.genres_match.total ? 'match' : 'partial')
            : 'miss';
        tagsHtml += `<span class="comparison-tag ${genreClass}">
            Genres: ${comparison.genres_match.correct}/${comparison.genres_match.total}
        </span>`;
    }
    
    // Tags comparison
    if (comparison.tags_match) {
        const tagClass = comparison.tags_match.primary > 0 
            ? 'match' 
            : (comparison.tags_match.secondary > 0 ? 'partial' : 'miss');
        tagsHtml += `<span class="comparison-tag ${tagClass}">
            Tags: ${comparison.tags_match.primary}P/${comparison.tags_match.secondary}S
        </span>`;
    }
    
    item.innerHTML = `
        <div class="anime-name">${escapeHtml(guessedAnime.title || guessedAnime.name)}</div>
        <div class="comparison-tags">${tagsHtml}</div>
    `;
    
    // Insert at top
    historyContainer.insertBefore(item, historyContainer.firstChild);
    
    // Update clue tags colors based on comparison
    updateClueColors(comparison);
}

// Update clue tag colors based on guess
function updateClueColors(comparison) {
    // Update genre tags
    if (comparison.genres_details) {
        const genreTags = document.querySelectorAll('#clue-genres .tag');
        genreTags.forEach(tag => {
            const genre = tag.dataset.genre;
            if (comparison.genres_details.correct && comparison.genres_details.correct.includes(genre)) {
                tag.classList.add('correct');
                tag.classList.remove('wrong', 'partial');
            } else if (comparison.genres_details.wrong && comparison.genres_details.wrong.includes(genre)) {
                tag.classList.add('wrong');
                tag.classList.remove('correct', 'partial');
            }
        });
    }
    
    // Update regular tags
    if (comparison.tags_details) {
        const tagEls = document.querySelectorAll('#clue-tags .tag');
        tagEls.forEach(tagEl => {
            const tagName = tagEl.dataset.tag;
            if (comparison.tags_details.primary && comparison.tags_details.primary.includes(tagName)) {
                tagEl.classList.add('correct');
                tagEl.classList.remove('wrong', 'partial');
            } else if (comparison.tags_details.secondary && comparison.tags_details.secondary.includes(tagName)) {
                tagEl.classList.add('partial');
                tagEl.classList.remove('wrong', 'correct');
            } else if (comparison.tags_details.wrong && comparison.tags_details.wrong.includes(tagName)) {
                tagEl.classList.add('wrong');
                tagEl.classList.remove('correct', 'partial');
            }
        });
    }
}

// Check and reveal hints based on tries remaining
function checkHints() {
    const triesUsed = gameState.maxTries - gameState.tries;
    
    if (triesUsed >= 10 && gameState.targetAnime) {
        document.getElementById('hints-container').style.display = 'block';
        
        // Show blurred cover at try 10
        if (triesUsed >= 10) {
            document.getElementById('hint-cover').style.display = 'block';
            const coverImg = document.getElementById('anime-cover');
            coverImg.src = gameState.targetAnime.image || '/src/assets/imgs/const.png';
            coverImg.onerror = function() { this.src = '/src/assets/imgs/const.png'; };
        }
        
        // Show synopsis at try 15
        if (triesUsed >= 15) {
            document.getElementById('hint-synopsis').style.display = 'block';
            document.getElementById('anime-synopsis').textContent = 
                gameState.targetAnime.synopsis || 'No synopsis available.';
        }
        
        // Show character at try 20
        if (triesUsed >= 20) {
            document.getElementById('hint-character').style.display = 'block';
            if (gameState.targetAnime.main_character) {
                document.getElementById('character-image').src = 
                    gameState.targetAnime.main_character.image || '/src/assets/imgs/const.png';
                document.getElementById('character-name').textContent = 
                    gameState.targetAnime.main_character.name || 'Unknown Character';
            } else {
                document.getElementById('character-name').textContent = 'No character data available';
            }
        }
    }
}

// End the game
function endGame(won) {
    gameState.gameOver = true;
    gameState.won = won;
    stopTimer();
    
    // Disable input
    document.getElementById('guess-input').disabled = true;
    document.getElementById('guess-btn').disabled = true;
    
    // Calculate score
    const score = calculateScore();
    
    // Show result screen
    const resultScreen = document.getElementById('result-screen');
    const resultTitle = document.getElementById('result-title');
    
    if (won) {
        resultTitle.textContent = '🎉 Correct!';
        resultTitle.className = 'win';
    } else {
        resultTitle.textContent = '😢 Game Over';
        resultTitle.className = 'lose';
    }
    
    // Show anime info
    document.getElementById('result-cover').src = gameState.targetAnime.image || '/src/assets/imgs/const.png';
    document.getElementById('result-name').textContent = gameState.targetAnime.title || gameState.targetAnime.name;
    document.getElementById('result-details').textContent = `${gameState.targetAnime.studio || 'Unknown Studio'} • ${gameState.targetAnime.release_date || 'Unknown'}`;
    
    // Show score
    document.getElementById('final-score').textContent = score;
    document.getElementById('tries-used').textContent = gameState.maxTries - gameState.tries;
    
    const mins = Math.floor(gameState.elapsedSeconds / 60);
    const secs = gameState.elapsedSeconds % 60;
    document.getElementById('time-taken').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    
    resultScreen.style.display = 'flex';
    
    // Submit score
    submitScore(score);
    
    // Unlock achievements
    checkAchievements(won, score);
}

// Calculate score
// Max 10000, -500 per try used, -25 per 30 seconds
function calculateScore() {
    if (!gameState.won) return 0;
    
    let score = 10000;
    
    // Deduct for tries
    const triesUsed = gameState.maxTries - gameState.tries;
    score -= triesUsed * 500;
    
    // Deduct for time (25 points per 30 seconds)
    const timeBlocks = Math.floor(gameState.elapsedSeconds / 30);
    score -= timeBlocks * 25;
    
    return Math.max(0, score);
}

// Submit score to server
async function submitScore(score) {
    if (!gameState.won) return;
    
    try {
        await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: 'anidle',
                username: user.username,
                score: score,
                board_id: gameState.mode === 'daily' ? 'daily' : 'unlimited',
                discord_id: user.discord_id,
                avatar: user.avatar
            })
        });
    } catch (err) {
        console.error('Failed to submit score:', err);
    }
}

// Check and unlock achievements
async function checkAchievements(won, score) {
    if (user.username === 'Anonymous') return;
    
    const achievements = [];
    
    if (won) {
        // First guess achievement
        achievements.push('first_guess');
        
        // Perfect score
        if (score === 10000) {
            achievements.push('perfect_score');
        }
        
        // No hints needed (before try 10)
        const triesUsed = gameState.maxTries - gameState.tries;
        if (triesUsed < 10) {
            achievements.push('no_hints');
        }
        
        // Last chance (try 21)
        if (triesUsed === 21) {
            achievements.push('last_chance');
        }
    }
    
    // Unlock each achievement
    for (const achId of achievements) {
        try {
            await fetch('/api/achievements/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    game_id: 'anidle',
                    username: user.username,
                    achievement_id: achId
                })
            });
        } catch (err) {
            console.error('Failed to unlock achievement:', err);
        }
    }
}

// Play again (unlimited mode only)
function playAgain() {
    if (gameState.mode === 'unlimited') {
        startGame('unlimited');
    }
}

// Utility function
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#039;');
}
