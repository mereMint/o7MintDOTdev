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
    won: false,
    skippedTries: 0
};

// LocalStorage keys for game state persistence
const ANIDLE_DAILY_STORAGE_KEY = 'anidle_daily_game_state';
const ANIDLE_UNLIMITED_STORAGE_KEY = 'anidle_unlimited_game_state';
// Expiry time for saved game state (2 hours in milliseconds) - only applies to unlimited mode
const ANIDLE_SAVE_EXPIRY_MS = 2 * 60 * 60 * 1000;
// Score comparison tolerance for floating point precision
const SCORE_MATCH_TOLERANCE = 0.01;

// Get storage key based on mode
function getStorageKey(mode) {
    return mode === 'daily' ? ANIDLE_DAILY_STORAGE_KEY : ANIDLE_UNLIMITED_STORAGE_KEY;
}

// Save game state to localStorage
function saveAnidleGameState() {
    if (gameState.gameOver) {
        // Don't save finished games
        localStorage.removeItem(getStorageKey(gameState.mode));
        return;
    }
    
    const stateToSave = {
        mode: gameState.mode,
        targetAnime: gameState.targetAnime,
        tries: gameState.tries,
        maxTries: gameState.maxTries,
        guesses: gameState.guesses,
        elapsedSeconds: gameState.elapsedSeconds,
        gameOver: gameState.gameOver,
        won: gameState.won,
        skippedTries: gameState.skippedTries,
        savedAt: Date.now(),
        // For daily mode, save the date to verify it's still the same day
        savedDate: new Date().toISOString().split('T')[0]
    };
    
    try {
        localStorage.setItem(getStorageKey(gameState.mode), JSON.stringify(stateToSave));
    } catch (e) {
        console.warn('Failed to save Anidle game state:', e);
    }
}

// Load game state from localStorage
function loadSavedAnidleState(mode) {
    try {
        const saved = localStorage.getItem(getStorageKey(mode));
        if (!saved) return null;
        
        const state = JSON.parse(saved);
        
        // For daily mode, check if it's still the same day
        if (mode === 'daily') {
            const today = new Date().toISOString().split('T')[0];
            if (state.savedDate !== today) {
                localStorage.removeItem(getStorageKey(mode));
                return null;
            }
        }
        
        // For unlimited mode, check if save is too old
        if (mode === 'unlimited' && Date.now() - state.savedAt > ANIDLE_SAVE_EXPIRY_MS) {
            localStorage.removeItem(getStorageKey(mode));
            return null;
        }
        
        return state;
    } catch (e) {
        console.warn('Failed to load saved Anidle game state:', e);
        localStorage.removeItem(getStorageKey(mode));
        return null;
    }
}

// Clear saved game state
function clearSavedAnidleState(mode) {
    localStorage.removeItem(getStorageKey(mode));
}

// User info
const storedUser = localStorage.getItem('discord_user');
const user = storedUser ? JSON.parse(storedUser) : { username: "Anonymous" };

// Anime list cache for autocomplete
let selectedAutocompleteIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('user-display').innerText = `Player: ${user.username}`;

    // Check for saved daily game state
    const savedDailyState = loadSavedAnidleState('daily');
    if (savedDailyState && !savedDailyState.gameOver) {
        const resume = confirm('You have a daily game in progress. Would you like to resume?');
        if (resume) {
            await resumeAnidleGame(savedDailyState);
        } else {
            clearSavedAnidleState('daily');
            await startGame('daily');
        }
    } else {
        // Start game
        await startGame('daily');
    }

    // Setup autocomplete (Jikan API)
    setupAutocomplete();
});

// Resume a saved Anidle game
async function resumeAnidleGame(savedState) {
    console.log('Resuming saved Anidle game...');
    
    // Restore game state
    gameState.mode = savedState.mode;
    gameState.targetAnime = savedState.targetAnime;
    gameState.tries = savedState.tries;
    gameState.maxTries = savedState.maxTries;
    gameState.guesses = savedState.guesses;
    gameState.elapsedSeconds = savedState.elapsedSeconds;
    gameState.gameOver = savedState.gameOver;
    gameState.won = savedState.won;
    gameState.skippedTries = savedState.skippedTries;
    gameState.startTime = Date.now() - (savedState.elapsedSeconds * 1000);
    
    // Update mode button UI
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(gameState.mode === 'daily' ? 'daily-btn' : 'unlimited-btn').classList.add('active');
    
    // Show/hide play again button
    document.getElementById('play-again-btn').style.display = gameState.mode === 'unlimited' ? 'inline-block' : 'none';
    
    // Enable inputs
    document.getElementById('guess-input').disabled = false;
    document.getElementById('guess-btn').disabled = false;
    document.getElementById('tries-count').textContent = gameState.tries.toString();
    
    // Start timer
    startTimer();
    
    // Restore guesses display
    document.getElementById('guess-history').innerHTML = '';
    for (const guess of gameState.guesses) {
        // Recreate the history items
        displayGuessResultFromSaved(guess);
    }
    
    // Restore clues based on saved state
    checkHints();
    updateSkipCost();
}

// Display a saved guess result (simplified version for restoration)
function displayGuessResultFromSaved(guess) {
    const historyContainer = document.getElementById('guess-history');
    const item = document.createElement('div');
    item.className = 'history-item';
    if (guess.correct) item.classList.add('close');
    
    item.innerHTML = `
        <div class="anime-name">${escapeHtml(guess.name)}</div>
        <div class="comparison-tags">
            <span class="comparison-tag ${guess.comparison.score_match ? 'match' : 'miss'}">
                Score: ${guess.comparison.score_match ? '✓' : guess.comparison.score_direction || '?'}
            </span>
            <span class="comparison-tag ${guess.comparison.studio_match ? 'match' : 'miss'}">
                Studio: ${guess.comparison.studio_match ? '✓' : '✗'}
            </span>
            <span class="comparison-tag ${guess.comparison.release_match ? 'match' : 'miss'}">
                Release: ${guess.comparison.release_match ? '✓' : guess.comparison.release_direction || '?'}
            </span>
        </div>
    `;
    
    historyContainer.insertBefore(item, historyContainer.firstChild);
    
    // Also update accumulated clues
    updateAccumulatedClues(guess.comparison);
}

// Sleep helper
const delay = ms => new Promise(res => setTimeout(res, ms));

// Helper: Check if title indicates a sequel
function isSequelTitle(title) {
    if (!title) return false;
    const t = title.toLowerCase();
    // Catch "Season 2", "Season 10", "2nd Season", "3rd Season", "Part 2"
    // Also catch "Act 2", "Cour 2"
    const sequelPatterns = [
        /season \d+/,         // Season 2, Season 3
        /\d+(?:st|nd|rd|th) season/, // 2nd Season
        /part \d+/,           // Part 2
        /cour \d+/,           // Cour 2
        /act \d+/,            // Act 2
        /collection/,         // Collection usually implies bundles
        /movie/,              // Explicit "Movie" in title
        /movie \d+/,          // Movie 1, Movie 2... (catches Detective Conan Movie 13)
    ];

    if (sequelPatterns.some(p => t.match(p))) return true;

    // Specific checks for symbolic sequels (Gintama', K-On!!, etc)
    // If it ends with special chars often used for sequels, and isn't just "!" (Haikyuu!!)
    // This is risky, so we'll rely mostly on explicit patterns or relations.
    // However, we can blacklist specific known offenders if needed, or rely on strict relation checking.
    return false;
}

// Fetch Random Valid Anime
async function fetchRandomAnime() {
    if (gameState.mode === 'daily') {
        // Fetch from Server API
        const res = await fetch('/api/daily/anidle');
        if (!res.ok) throw new Error('Daily API Failed');
        const anime = await res.json();
        return anime;
    }

    // Unlimited Mode: Client-Side Fetch
    let attempts = 0;
    while (attempts < 8) { // Increased attempts
        try {
            const page = Math.floor(Math.random() * 10) + 1; // Top 10 pages for popularity
            // Filter by type=tv to avoid Movies/OVAs/Specials
            const listRes = await fetch(`https://api.jikan.moe/v4/top/anime?page=${page}&filter=bypopularity&limit=25`);
            if (!listRes.ok) throw new Error('API Error');

            const listData = await listRes.json();
            const candidates = listData.data;
            if (!candidates || candidates.length === 0) continue;

            const shuffled = candidates.sort(() => 0.5 - Math.random());

            for (const candidate of shuffled) {
                // strict heuristic check
                if (isSequelTitle(candidate.title) ||
                    isSequelTitle(candidate.title_english) ||
                    (candidate.approved === false)) continue; // Skip unapproved

                await delay(800);
                const detailRes = await fetch(`https://api.jikan.moe/v4/anime/${candidate.mal_id}/full`);
                if (!detailRes.ok) continue;
                const data = await detailRes.json();
                const anime = data.data;

                // Double check type
                if (anime.type !== 'TV' && anime.type !== 'Movie') continue;

                // Check relations: No Prequel allowed
                const hasPrequel = anime.relations?.some(r => r.relation === 'Prequel');
                // Also check if "Parent story" exists (sometimes distinct from Prequel)
                const hasParent = anime.relations?.some(r => r.relation === 'Parent story');

                if (!hasPrequel && !hasParent) return anime;
            }
        } catch (err) { console.error('Retry...', err); }
        attempts++;
        await delay(1000);
    }
    throw new Error('No anime found');
}

// Jikan API Search
async function searchAnime(query) {
    try {
        // Allow TV and Movie types in search (User wants standalone movies)
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=15&sfw`);
        if (!res.ok) return [];
        const data = await res.json();
        const results = data.data || [];

        // Filter sequels and specials
        return results.filter(a => {
            // Must be TV or Movie
            if (a.type !== 'TV' && a.type !== 'Movie') return false;

            // Filter out sequels based on title
            // This catches "Detective Conan Movie 14" via "movie \d+" regex
            if (isSequelTitle(a.title) || isSequelTitle(a.title_english)) return false;

            return true;
        });
    } catch (err) {
        console.error('Jikan API Error:', err);
        return [];
    }
}

// Select game mode
async function selectMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(mode === 'daily' ? 'daily-btn' : 'unlimited-btn').classList.add('active');

    // Check for saved game state for this mode
    const savedState = loadSavedAnidleState(mode);
    if (savedState && !savedState.gameOver) {
        const resume = confirm(`You have a ${mode} game in progress. Would you like to resume?`);
        if (resume) {
            await resumeAnidleGame(savedState);
            return;
        } else {
            clearSavedAnidleState(mode);
        }
    }

    gameState.mode = mode;
    await startGame(mode);
}

// Start a new game
async function startGame(mode) {
    // For daily mode, check if user has already completed today's challenge
    if (mode === 'daily' && user.username !== 'Anonymous') {
        try {
            const checkUrl = `/api/anidle/check-daily?username=${encodeURIComponent(user.username)}` +
                (user.discord_id ? `&discord_id=${encodeURIComponent(user.discord_id)}` : '');
            const response = await fetch(checkUrl);
            if (response.ok) {
                const data = await response.json();
                if (data.completed) {
                    alert('You have already completed today\'s daily challenge! Come back tomorrow or try unlimited mode.');
                    // Switch to unlimited mode
                    await selectMode('unlimited');
                    return;
                }
            }
        } catch (err) {
            console.error('Failed to check daily completion:', err);
            // Continue anyway if check fails
        }
    }
    
    // Clear any old saved state for this mode
    clearSavedAnidleState(mode);
    
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
        won: false,
        skippedTries: 0
    };

    // Clear UI
    document.getElementById('guess-history').innerHTML = '';
    document.getElementById('guess-input').value = '';
    document.getElementById('guess-input').disabled = true; // Disable until loaded
    document.getElementById('guess-btn').disabled = true;
    document.getElementById('skip-btn').disabled = true;
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
        const anime = await fetchRandomAnime();
        gameState.targetAnime = anime;

        // Enable Inputs
        document.getElementById('guess-input').disabled = false;
        document.getElementById('guess-btn').disabled = false;
        updateSkipCost();

    } catch (err) {
        console.error('Error loading game:', err);
        alert('Failed to load anime (Rate Limit?). Please refresh.');
    }
}

// Reveal all hints (called on game over)
function revealAllClues(anime) {
    if (!anime) anime = gameState.targetAnime;

    const studioName = (anime.studios || []).map(s => s.name).join(', ') || 'Unknown';
    const releaseYear = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : 'Unknown');

    document.getElementById('clue-score').textContent = anime.score ? anime.score.toFixed(2) : 'N/A';
    document.getElementById('clue-studio').textContent = studioName;
    document.getElementById('clue-release').textContent = releaseYear;
    document.getElementById('clue-source').textContent = anime.source || 'Unknown';

    // Display genres
    const genresContainer = document.getElementById('clue-genres');
    genresContainer.innerHTML = '';
    if (anime.genres && anime.genres.length > 0) {
        anime.genres.forEach(genre => {
            const tag = document.createElement('span');
            tag.className = 'tag correct';
            tag.textContent = genre.name || genre; // Handle object or fallback
            genresContainer.appendChild(tag);
        });
    } else {
        genresContainer.innerHTML = '<span class="tag">None</span>';
    }

    // Display tags (Themes/Demographics)
    const tagsContainer = document.getElementById('clue-tags');
    tagsContainer.innerHTML = '';
    const themes = [
        ...(anime.themes || []),
        ...(anime.demographics || [])
    ];

    if (themes.length > 0) {
        themes.slice(0, 8).forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag';
            // Mark as 'correct' implies we matched it? No, this is reveal, just show them.
            // But usually we mark them neutral or correct color.
            tagEl.classList.add('correct');

            tagEl.textContent = tag.name || tag;
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
    let debounceTimer;

    input.addEventListener('input', function () {
        const query = this.value.trim();
        selectedAutocompleteIndex = -1;

        clearTimeout(debounceTimer);

        if (query.length < 3) {
            autocompleteList.style.display = 'none';
            return;
        }

        // Debounce search
        debounceTimer = setTimeout(async () => {
            const matches = await searchAnime(query);

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
                img.src = anime.images?.jpg?.image_url || '/src/assets/imgs/const.png';
                img.alt = anime.title;

                const infoDiv = document.createElement('div');
                infoDiv.className = 'autocomplete-info';

                const titleSpan = document.createElement('span');
                titleSpan.className = 'autocomplete-title';
                titleSpan.textContent = anime.title;
                if (anime.title_english && anime.title_english !== anime.title) {
                    titleSpan.textContent += ` (${anime.title_english})`;
                }

                const detailSpan = document.createElement('span');
                detailSpan.className = 'autocomplete-detail';
                // Show year and type (e.g. "TV - 2011")
                const year = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : 'Unknown');
                detailSpan.textContent = `${anime.type || 'TV'} • ${year}`;

                infoDiv.appendChild(titleSpan);
                infoDiv.appendChild(detailSpan);

                item.appendChild(img);
                item.appendChild(infoDiv);

                item.addEventListener('click', () => {
                    // Prefer English title if available and reasonable length, otherwise default
                    input.value = anime.title;
                    input.dataset.selectedId = anime.mal_id;
                    autocompleteList.style.display = 'none';
                });

                autocompleteList.appendChild(item);
            });

            autocompleteList.style.display = 'block';
        }, 300); // 300ms delay
    });

    // Keyboard navigation
    input.addEventListener('keydown', function (e) {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (autocompleteList.style.display !== 'none') {
                selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
                updateAutocompleteSelection(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (autocompleteList.style.display !== 'none') {
                selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
                updateAutocompleteSelection(items);
            }
        } else if (e.key === 'Enter') {
            if (autocompleteList.style.display !== 'none' && selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
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
    document.addEventListener('click', function (e) {
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

// Client-Side Comparison Logic
function compareAnime(target, guess) {
    const comparison = {
        score_match: false,
        score_direction: '',
        studio_match: false,
        release_match: false,
        release_direction: '',
        source_match: false,
        genres_match: { correct: 0, total: target.genres?.length || 0 },
        genres_details: { correct: [], wrong: [] },
        tags_match: { primary: 0, secondary: 0 },
        tags_details: { primary: [], secondary: [], wrong: [] }
    };

    // Score
    if (target.score && guess.score) {
        const diff = target.score - guess.score;
        // Score matches only if exactly equal (accounting for floating point precision)
        if (Math.abs(diff) < SCORE_MATCH_TOLERANCE) comparison.score_match = true;
        else comparison.score_direction = diff > 0 ? '↑' : '↓';
    }

    // Studio (Check overlaps)
    const targetStudios = (target.studios || []).map(s => s.name);
    const guessStudios = (guess.studios || []).map(s => s.name);
    comparison.studio_match = targetStudios.some(s => guessStudios.includes(s));

    // Release Year
    const targetYear = target.year || (target.aired?.from ? new Date(target.aired.from).getFullYear() : 0);
    const guessYear = guess.year || (guess.aired?.from ? new Date(guess.aired.from).getFullYear() : 0);
    if (targetYear && guessYear) {
        if (targetYear === guessYear) comparison.release_match = true;
        else comparison.release_direction = targetYear > guessYear ? '↑' : '↓';
    }

    // Source
    if (target.source && guess.source && target.source === guess.source) {
        comparison.source_match = true;
    }

    // Genres
    const targetGenres = (target.genres || []).map(g => g.name);
    const guessGenres = (guess.genres || []).map(g => g.name);

    comparison.genres_details.correct = guessGenres.filter(g => targetGenres.includes(g));
    comparison.genres_details.wrong = guessGenres.filter(g => !targetGenres.includes(g));
    comparison.genres_match.correct = comparison.genres_details.correct.length;

    // Tags (Jikan -> Themes/Demographics)
    const getTags = (a) => [
        ...(a.themes || []).map(t => t.name),
        ...(a.demographics || []).map(d => d.name)
    ];
    const targetTags = getTags(target);
    const guessTags = getTags(guess);

    // Simple intersection for client side Jikan
    comparison.tags_details.primary = guessTags.filter(t => targetTags.includes(t));
    comparison.tags_match.primary = comparison.tags_details.primary.length;

    return comparison;
}

// Submit a guess
async function submitGuess() {
    if (gameState.gameOver || gameState.tries <= 0) return;

    const input = document.getElementById('guess-input');
    const guessId = input.dataset.selectedId;
    let guessName = input.value.trim();

    if (!guessName && !guessId) return;

    // Disable input
    input.disabled = true;
    document.getElementById('guess-btn').disabled = true;

    try {
        let guessAnime = null;

        // If we have an ID, fetch details directly
        if (guessId) {
            const res = await fetch(`https://api.jikan.moe/v4/anime/${guessId}/full`);
            if (res.ok) {
                const data = await res.json();
                guessAnime = data.data;
            }
        }

        // Fallback or no ID: search type safety
        if (!guessAnime) {
            const searchRes = await searchAnime(guessName);
            if (searchRes.length > 0) {
                guessAnime = searchRes[0]; // Take top result
            }
        }

        if (!guessAnime) {
            alert("Could not find anime details. Please select from the dropdown.");
            input.disabled = false;
            document.getElementById('guess-btn').disabled = false;
            return;
        }

        // Compare
        const comparison = compareAnime(gameState.targetAnime, guessAnime);
        const isCorrect = (gameState.targetAnime.mal_id === guessAnime.mal_id);

        // Update State
        gameState.tries--;
        document.getElementById('tries-count').textContent = gameState.tries;
        gameState.guesses.push({
            name: guessAnime.title,
            comparison: comparison,
            correct: isCorrect
        });

        displayGuessResult({
            guessed_anime: guessAnime,
            comparison: comparison,
            correct: isCorrect
        });

        checkHints();
        updateSkipCost();

        if (isCorrect) endGame(true);
        else if (gameState.tries <= 0) endGame(false);
        else {
            // Clear input
            input.value = '';
            input.dataset.selectedId = '';
            input.disabled = false;
            document.getElementById('guess-btn').disabled = false;
            input.focus();
            
            // Save game state after guess
            saveAnidleGameState();
        }

    } catch (err) {
        console.error("Guess Error", err);
        alert("Error verifying guess.");
        input.disabled = false;
        document.getElementById('guess-btn').disabled = false;
    }
}

// Display guess result in history
function displayGuessResult(result) {
    const historyContainer = document.getElementById('guess-history');
    const guessedAnime = result.guessed_anime;
    const comparison = result.comparison;

    const item = document.createElement('div');
    item.className = 'history-item';
    if (result.correct) item.classList.add('close');

    // Build comparison tags
    let tagsHtml = '';

    // Score
    tagsHtml += `<span class="comparison-tag ${comparison.score_match ? 'match' : 'miss'}">
        Score: ${guessedAnime.score || 'N/A'} ${comparison.score_direction || ''}
    </span>`;

    // Studio
    const studios = (guessedAnime.studios || []).map(s => s.name).join(', ') || 'Unknown';
    tagsHtml += `<span class="comparison-tag ${comparison.studio_match ? 'match' : 'miss'}">
        Studio: ${studios}
    </span>`;

    // Release
    const year = guessedAnime.year || (guessedAnime.aired?.from ? new Date(guessedAnime.aired.from).getFullYear() : 'Unknown');
    tagsHtml += `<span class="comparison-tag ${comparison.release_match ? 'match' : 'miss'}">
        Release: ${year} ${comparison.release_direction || ''}
    </span>`;

    // Source
    tagsHtml += `<span class="comparison-tag ${comparison.source_match ? 'match' : 'miss'}">
        Source: ${guessedAnime.source || 'Unknown'}
    </span>`;

    // Genres
    tagsHtml += `<span class="comparison-tag ${comparison.genres_match.correct > 0 ? 'match' : 'miss'}">
        Genres: ${comparison.genres_match.correct}
    </span>`;

    item.innerHTML = `
        <div class="anime-name">${escapeHtml(guessedAnime.title)}</div>
        <div class="comparison-tags">${tagsHtml}</div>
    `;

    historyContainer.insertBefore(item, historyContainer.firstChild);
    updateAccumulatedClues(comparison);
}

// Update accumulated clues based on guess
function updateAccumulatedClues(comparison) {
    if (!gameState.targetAnime) return;
    const anime = gameState.targetAnime;

    // Reveal Score if match, or show direction hint if not
    const scoreEl = document.getElementById('clue-score');
    if (comparison.score_match) {
        scoreEl.textContent = anime.score ? anime.score.toFixed(2) : 'N/A';
    } else if (comparison.score_direction && scoreEl.textContent === '?') {
        // Show direction hint (e.g., "↑" means target score is higher)
        scoreEl.textContent = comparison.score_direction;
    }

    // Reveal Studio if match
    if (comparison.studio_match) {
        const studios = (anime.studios || []).map(s => s.name).join(', ');
        document.getElementById('clue-studio').textContent = studios || 'Unknown';
    }

    // Reveal Release if match, or show direction hint if not
    const releaseEl = document.getElementById('clue-release');
    if (comparison.release_match) {
        const year = anime.year || (anime.aired?.from ? new Date(anime.aired.from).getFullYear() : 'Unknown');
        releaseEl.textContent = year;
    } else if (comparison.release_direction && releaseEl.textContent === '?') {
        // Show direction hint (e.g., "↑" means target year is later)
        releaseEl.textContent = comparison.release_direction;
    }

    // Reveal Source if match
    if (comparison.source_match) {
        document.getElementById('clue-source').textContent = anime.source || 'Unknown';
    }

    // Reveal Genres (Correct & Wrong)
    if (comparison.genres_details) {
        const container = document.getElementById('clue-genres');
        if (container.textContent.trim() === '?') container.innerHTML = '';

        // Add correct genres
        (comparison.genres_details.correct || []).forEach(genre => {
            const exists = Array.from(container.children).some(c => c.textContent === genre && c.classList.contains('correct'));
            if (!exists) {
                const tag = document.createElement('span');
                tag.className = 'tag correct';
                tag.textContent = genre;
                container.appendChild(tag);
            }
        });

        // Add wrong genres
        (comparison.genres_details.wrong || []).forEach(genre => {
            const exists = Array.from(container.children).some(c => c.textContent === genre && c.classList.contains('wrong'));
            if (!exists) {
                const tag = document.createElement('span');
                tag.className = 'tag wrong';
                tag.textContent = genre;
                container.appendChild(tag);
            }
        });
    }

    // Reveal Tags (Themes/Demographics) as Yellow Tags
    if (comparison.tags_details && comparison.tags_details.primary) {
        const container = document.getElementById('clue-tags');
        if (container.textContent.trim() === '?') container.innerHTML = '';

        comparison.tags_details.primary.forEach(t => {
            const exists = Array.from(container.children).some(c => c.textContent === t);
            if (!exists) {
                const tag = document.createElement('span');
                tag.className = 'tag partial'; // Yellow
                tag.textContent = t;
                container.appendChild(tag);
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
        document.getElementById('hint-cover').style.display = 'block';
        const coverImg = document.getElementById('anime-cover');
        coverImg.src = gameState.targetAnime.image || gameState.targetAnime.images?.jpg?.large_image_url || gameState.targetAnime.images?.jpg?.image_url || '/src/assets/imgs/const.png';
        coverImg.onerror = function () { this.src = '/src/assets/imgs/const.png'; };


        // Show synopsis at try 15
        if (triesUsed >= 15) {
            document.getElementById('hint-synopsis').style.display = 'block';
            const synopsisRaw = gameState.targetAnime.synopsis || 'No synopsis available.';
            document.getElementById('anime-synopsis').innerHTML = formatText(synopsisRaw);
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

// Rich Text Formatter (Math, Colors, Newlines)
function formatText(text) {
    if (!text) return '';

    // 1. Render Math ($$ formula $$) using KaTeX if available
    if (window.katex) {
        text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
            try {
                // Formatting: Replace newlines with LaTeX line breaks (\\) for intuitive rendering
                // Only if not already ending in \\
                let formattedFormula = formula.replace(/([^\\])\n/g, '$1 \\\\ ');

                return katex.renderToString(formattedFormula, {
                    displayMode: true,
                    throwOnError: false,
                    fleqn: false // Center by default
                });
            } catch (e) {
                console.error("KaTeX Error:", e);
                return match; // Fallback
            }
        });
    }

    // 2. Custom Color Tags ({color:red}text{/color})
    text = text.replace(/\{color:([a-zA-Z0-9#]+)\}([\s\S]*?)\{\/color\}/g, (match, color, content) => {
        return `<span style="color:${color}">${content}</span>`;
    });

    // 3. Newlines to <br> (for regular text)
    text = text.replace(/\n/g, '<br>');

    return text;
}

// End the game
function endGame(won) {
    gameState.gameOver = true;
    gameState.won = won;
    stopTimer();
    
    // Clear saved game state
    clearSavedAnidleState(gameState.mode);

    // Reveal all clues
    revealAllClues();

    // Disable input
    document.getElementById('guess-input').disabled = true;
    document.getElementById('guess-btn').disabled = true;
    document.getElementById('skip-btn').disabled = true;

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
    document.getElementById('result-cover').src = gameState.targetAnime.image || gameState.targetAnime.images?.jpg?.image_url || '/src/assets/imgs/const.png';
    const title = gameState.targetAnime.title || gameState.targetAnime.name;
    const titleEng = gameState.targetAnime.title_english;
    document.getElementById('result-name').innerHTML = `${title} <br><small style="color:#888; font-size:0.8em">${titleEng && titleEng !== title ? titleEng : ''}</small>`;

    const details = `${gameState.targetAnime.studio || 'Unknown Studio'} • ${gameState.targetAnime.year || (gameState.targetAnime.aired?.from ? new Date(gameState.targetAnime.aired.from).getFullYear() : 'Unknown')}`;
    const scoreDisplay = gameState.targetAnime.score ? `<div id="result-score-tag">MAL Score: ${gameState.targetAnime.score}</div>` : '';

    document.getElementById('result-details').innerHTML = `${details} ${scoreDisplay}`;

    // Show score
    document.getElementById('final-score').textContent = score;
    document.getElementById('tries-used').innerHTML = `${gameState.maxTries - gameState.tries}<br><span>Tries</span>`;

    const mins = Math.floor(gameState.elapsedSeconds / 60);
    const secs = gameState.elapsedSeconds % 60;
    document.getElementById('time-taken').innerHTML = `${mins}:${secs.toString().padStart(2, '0')}<br><span>Time</span>`;

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

// Skip to next hint logic
function skipToHint() {
    if (gameState.gameOver || gameState.tries <= 1) return;

    const triesUsed = gameState.maxTries - gameState.tries;
    let nextThreshold = 21; // Default (lose all if no hints left)

    // Thresholds: 10 (Cover), 15 (Synopsis), 20 (Character)
    if (triesUsed < 10) nextThreshold = 10;
    else if (triesUsed < 15) nextThreshold = 15;
    else if (triesUsed < 20) nextThreshold = 20;

    const cost = nextThreshold - triesUsed;

    if (gameState.tries - cost < 0) {
        alert("Not enough tries to skip!");
        return;
    }

    if (confirm(`Skip to next hint? This will cost ${cost} tries.`)) {
        gameState.tries -= cost;
        gameState.skippedTries += cost;
        document.getElementById('tries-count').textContent = gameState.tries;
        checkHints();
        updateSkipCost();

        // Check game over
        if (gameState.tries <= 0) {
            endGame(false);
        } else {
            // Save state after skip
            saveAnidleGameState();
        }
    }
}

function updateSkipCost() {
    const triesUsed = gameState.maxTries - gameState.tries;
    let nextThreshold = 21;
    if (triesUsed < 10) nextThreshold = 10;
    else if (triesUsed < 15) nextThreshold = 15;
    else if (triesUsed < 20) nextThreshold = 20;

    const cost = nextThreshold - triesUsed;
    const btn = document.getElementById('skip-btn');
    const costSpan = document.getElementById('skip-cost');

    if (triesUsed >= 20) {
        btn.disabled = true;
        btn.textContent = "No more hints";
    } else {
        btn.disabled = false;
        costSpan.textContent = cost;
        btn.innerHTML = `Skip to Hint (-<span id="skip-cost">${cost}</span> Tries)`;
    }
}
