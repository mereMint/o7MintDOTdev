// AniCom Game Logic

// Game State
let gameState = {
    currentAnime: null,
    currentChallenge: null,
    usedAnimeIds: new Set(),
    roundsCompleted: 0,
    score: 0,
    gameOver: false,
    animeCache: []
};

// Challenge types
const CHALLENGE_TYPES = {
    HIGHER_SCORE: 'higher_score',
    LOWER_SCORE: 'lower_score',
    SAME_GENRE: 'same_genre',
    SAME_STUDIO: 'same_studio',
    SAME_TAG: 'same_tag',
    HIGHER_POPULARITY: 'higher_popularity',
    LOWER_POPULARITY: 'lower_popularity'
};

// User info
const storedUser = localStorage.getItem('discord_user');
const user = storedUser ? JSON.parse(storedUser) : { username: "Anonymous" };

// Autocomplete state
let selectedAutocompleteIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('user-display').innerText = `Player: ${user.username}`;
    startGame();
    setupAutocomplete();
});

// Start new game
async function startGame() {
    console.log('Starting new game...');
    
    // Reset game state
    gameState = {
        currentAnime: null,
        currentChallenge: null,
        usedAnimeIds: new Set(),
        roundsCompleted: 0,
        score: 0,
        gameOver: false,
        animeCache: []
    };

    // Reset UI
    document.getElementById('round-count').innerText = '0';
    document.getElementById('score-count').innerText = '0';
    document.getElementById('used-count').innerText = '0';
    document.getElementById('used-anime-list').innerHTML = '';
    document.getElementById('guess-input').value = '';
    document.getElementById('result-screen').style.display = 'none';
    document.getElementById('submit-btn').disabled = false;

    // Load anime cache
    await loadAnimeCache();

    // Start first round
    await startNewRound();
}

// Load anime list from server
async function loadAnimeCache() {
    try {
        console.log('Loading anime cache...');
        const response = await fetch('/api/anidle/anime-list');
        if (!response.ok) throw new Error('Failed to load anime list');
        
        const data = await response.json();
        gameState.animeCache = data;
        console.log(`Loaded ${gameState.animeCache.length} anime`);
    } catch (error) {
        console.error('Error loading anime cache:', error);
        alert('Failed to load anime data. Please refresh the page.');
    }
}

// Start a new round
async function startNewRound() {
    if (gameState.animeCache.length === 0) {
        console.error('No anime in cache');
        return;
    }

    // Select a random anime that hasn't been used
    let randomAnime = null;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
        const randomIndex = Math.floor(Math.random() * gameState.animeCache.length);
        const candidate = gameState.animeCache[randomIndex];
        
        if (!gameState.usedAnimeIds.has(candidate.mal_id)) {
            randomAnime = candidate;
            break;
        }
        attempts++;
    }

    if (!randomAnime) {
        // No more unused anime available
        endGame('No more anime available! Amazing run!');
        return;
    }

    // Fetch full details for the anime
    try {
        const response = await fetch(`https://api.jikan.moe/v4/anime/${randomAnime.mal_id}/full`);
        if (!response.ok) throw new Error('Failed to fetch anime details');
        
        const data = await response.json();
        gameState.currentAnime = data.data;
        gameState.usedAnimeIds.add(gameState.currentAnime.mal_id);

        // Generate a random challenge
        generateChallenge();

        // Update UI
        updateUI();
    } catch (error) {
        console.error('Error fetching anime details:', error);
        // Try another anime
        await startNewRound();
    }
}

// Generate a random challenge based on current anime
function generateChallenge() {
    const anime = gameState.currentAnime;
    const possibleChallenges = [];

    // Score challenges (if anime has a score)
    if (anime.score) {
        possibleChallenges.push({
            type: CHALLENGE_TYPES.HIGHER_SCORE,
            text: `Choose an anime with a HIGHER MAL score than ${anime.score.toFixed(2)}`,
            validator: (selectedAnime) => selectedAnime.score > anime.score
        });
        
        possibleChallenges.push({
            type: CHALLENGE_TYPES.LOWER_SCORE,
            text: `Choose an anime with a LOWER MAL score than ${anime.score.toFixed(2)}`,
            validator: (selectedAnime) => selectedAnime.score < anime.score
        });
    }

    // Genre challenge (if anime has genres)
    if (anime.genres && anime.genres.length > 0) {
        const randomGenre = anime.genres[Math.floor(Math.random() * anime.genres.length)];
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_GENRE,
            text: `Choose an anime with the genre: ${randomGenre.name}`,
            validator: (selectedAnime) => {
                return selectedAnime.genres && selectedAnime.genres.some(g => g.mal_id === randomGenre.mal_id);
            },
            genre: randomGenre
        });
    }

    // Studio challenge (if anime has studios)
    if (anime.studios && anime.studios.length > 0) {
        const randomStudio = anime.studios[Math.floor(Math.random() * anime.studios.length)];
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_STUDIO,
            text: `Choose an anime made by: ${randomStudio.name}`,
            validator: (selectedAnime) => {
                return selectedAnime.studios && selectedAnime.studios.some(s => s.mal_id === randomStudio.mal_id);
            },
            studio: randomStudio
        });
    }

    // Tag/Theme challenge (using themes array from full endpoint)
    if (anime.themes && anime.themes.length > 0) {
        const randomTheme = anime.themes[Math.floor(Math.random() * anime.themes.length)];
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_TAG,
            text: `Choose an anime with the theme: ${randomTheme.name}`,
            validator: (selectedAnime) => {
                return selectedAnime.themes && selectedAnime.themes.some(t => t.mal_id === randomTheme.mal_id);
            },
            theme: randomTheme
        });
    }

    // Popularity challenge (using members count as popularity metric)
    if (anime.members) {
        possibleChallenges.push({
            type: CHALLENGE_TYPES.HIGHER_POPULARITY,
            text: `Choose an anime that is MORE POPULAR (members: ${anime.members.toLocaleString()})`,
            validator: (selectedAnime) => selectedAnime.members > anime.members
        });
        
        possibleChallenges.push({
            type: CHALLENGE_TYPES.LOWER_POPULARITY,
            text: `Choose an anime that is LESS POPULAR (members: ${anime.members.toLocaleString()})`,
            validator: (selectedAnime) => selectedAnime.members < anime.members
        });
    }

    // Select a random challenge from possible ones
    if (possibleChallenges.length === 0) {
        // Fallback: just pick any anime
        gameState.currentChallenge = {
            type: 'any',
            text: 'Choose any anime to continue',
            validator: () => true
        };
    } else {
        const randomIndex = Math.floor(Math.random() * possibleChallenges.length);
        gameState.currentChallenge = possibleChallenges[randomIndex];
    }
}

// Update UI with current game state
function updateUI() {
    const anime = gameState.currentAnime;
    
    // Update stats
    document.getElementById('round-count').innerText = gameState.roundsCompleted;
    document.getElementById('score-count').innerText = gameState.score;

    // Update current anime display
    document.getElementById('anime-name').innerText = anime.title || anime.title_english || 'Unknown';
    
    // Build details string
    let details = [];
    if (anime.score) details.push(`<span class="detail-item"><span class="detail-label">Score:</span> <span class="detail-value">${anime.score.toFixed(2)}</span></span>`);
    if (anime.members) details.push(`<span class="detail-item"><span class="detail-label">Members:</span> <span class="detail-value">${anime.members.toLocaleString()}</span></span>`);
    if (anime.genres && anime.genres.length > 0) {
        const genreNames = anime.genres.map(g => g.name).join(', ');
        details.push(`<span class="detail-item"><span class="detail-label">Genres:</span> <span class="detail-value">${genreNames}</span></span>`);
    }
    if (anime.studios && anime.studios.length > 0) {
        const studioNames = anime.studios.map(s => s.name).join(', ');
        details.push(`<span class="detail-item"><span class="detail-label">Studio:</span> <span class="detail-value">${studioNames}</span></span>`);
    }
    
    document.getElementById('anime-details').innerHTML = details.join('');

    // Update challenge text
    document.getElementById('challenge-text').innerText = gameState.currentChallenge.text;

    // Update used anime list
    document.getElementById('used-count').innerText = gameState.usedAnimeIds.size;
    updateUsedAnimeList();
}

// Update the list of used anime
function updateUsedAnimeList() {
    const container = document.getElementById('used-anime-list');
    const usedAnime = Array.from(gameState.usedAnimeIds);
    
    // Only show the most recent 20 to avoid cluttering
    const displayCount = Math.min(20, usedAnime.length);
    const recentAnime = usedAnime.slice(-displayCount);
    
    container.innerHTML = '';
    recentAnime.forEach(animeId => {
        const anime = gameState.animeCache.find(a => a.mal_id === animeId);
        if (anime) {
            const item = document.createElement('div');
            item.className = 'used-anime-item';
            item.innerText = anime.title;
            container.appendChild(item);
        }
    });

    if (usedAnime.length > displayCount) {
        const more = document.createElement('div');
        more.className = 'used-anime-item';
        more.innerText = `+${usedAnime.length - displayCount} more...`;
        more.style.fontStyle = 'italic';
        container.appendChild(more);
    }
}

// Submit guess
async function submitGuess() {
    const input = document.getElementById('guess-input');
    const guessText = input.value.trim();

    if (!guessText) {
        alert('Please enter an anime name');
        return;
    }

    // Find the anime in cache
    const guessedAnime = gameState.animeCache.find(a => 
        a.title.toLowerCase() === guessText.toLowerCase() ||
        (a.title_english && a.title_english.toLowerCase() === guessText.toLowerCase())
    );

    if (!guessedAnime) {
        alert('Anime not found. Please select from the autocomplete suggestions.');
        return;
    }

    // Check if anime was already used
    if (gameState.usedAnimeIds.has(guessedAnime.mal_id)) {
        alert('This anime has already been used! Choose a different one.');
        return;
    }

    // Disable button while processing
    document.getElementById('submit-btn').disabled = true;
    input.disabled = true;

    // Fetch full details for validation
    try {
        const response = await fetch(`https://api.jikan.moe/v4/anime/${guessedAnime.mal_id}/full`);
        if (!response.ok) throw new Error('Failed to fetch anime details');
        
        const data = await response.json();
        const selectedAnime = data.data;

        // Validate the guess
        const isValid = gameState.currentChallenge.validator(selectedAnime);

        if (isValid) {
            // Correct answer!
            gameState.roundsCompleted++;
            gameState.score += 100; // Base score per round
            
            // Update stats immediately
            document.getElementById('round-count').innerText = gameState.roundsCompleted;
            document.getElementById('score-count').innerText = gameState.score;

            // Clear input
            input.value = '';
            input.disabled = false;
            
            // Use the selected anime as the next target
            gameState.currentAnime = selectedAnime;
            gameState.usedAnimeIds.add(selectedAnime.mal_id);

            // Generate new challenge
            generateChallenge();

            // Update UI
            updateUI();

            // Re-enable button
            document.getElementById('submit-btn').disabled = false;

            // Check for achievements
            checkAchievements();
        } else {
            // Wrong answer - game over
            const reason = getFailureReason(selectedAnime);
            endGame(`Incorrect! ${reason}`);
        }
    } catch (error) {
        console.error('Error validating guess:', error);
        alert('Error processing your guess. Please try again.');
        document.getElementById('submit-btn').disabled = false;
        input.disabled = false;
    }
}

// Get failure reason message
function getFailureReason(selectedAnime) {
    const challenge = gameState.currentChallenge;
    const current = gameState.currentAnime;

    switch (challenge.type) {
        case CHALLENGE_TYPES.HIGHER_SCORE:
            return `${selectedAnime.title} has a score of ${selectedAnime.score?.toFixed(2) || 'N/A'}, which is not higher than ${current.score.toFixed(2)}.`;
        case CHALLENGE_TYPES.LOWER_SCORE:
            return `${selectedAnime.title} has a score of ${selectedAnime.score?.toFixed(2) || 'N/A'}, which is not lower than ${current.score.toFixed(2)}.`;
        case CHALLENGE_TYPES.SAME_GENRE:
            return `${selectedAnime.title} does not have the required genre.`;
        case CHALLENGE_TYPES.SAME_STUDIO:
            return `${selectedAnime.title} is not made by the required studio.`;
        case CHALLENGE_TYPES.SAME_TAG:
            return `${selectedAnime.title} does not have the required theme/tag.`;
        case CHALLENGE_TYPES.HIGHER_POPULARITY:
            return `${selectedAnime.title} has ${selectedAnime.members?.toLocaleString() || 'N/A'} members, which is not more popular.`;
        case CHALLENGE_TYPES.LOWER_POPULARITY:
            return `${selectedAnime.title} has ${selectedAnime.members?.toLocaleString() || 'N/A'} members, which is not less popular.`;
        default:
            return 'The selected anime does not meet the challenge requirements.';
    }
}

// End game
function endGame(reason) {
    gameState.gameOver = true;
    
    // Show result screen
    document.getElementById('result-title').innerText = 'Game Over!';
    document.getElementById('final-rounds').innerText = gameState.roundsCompleted;
    document.getElementById('final-score').innerText = gameState.score;
    document.getElementById('result-reason').innerText = reason;
    document.getElementById('result-screen').style.display = 'flex';

    // Submit score to server
    submitScore();
}

// Submit score to server
async function submitScore() {
    try {
        const response = await fetch('/api/score', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: user.username,
                game_id: 'anicom',
                board_id: 'high_score',
                score: gameState.score,
                metadata: {
                    rounds: gameState.roundsCompleted
                }
            })
        });

        if (response.ok) {
            console.log('Score submitted successfully');
        } else {
            console.error('Failed to submit score');
        }
    } catch (error) {
        console.error('Error submitting score:', error);
    }
}

// Check and award achievements
async function checkAchievements() {
    const rounds = gameState.roundsCompleted;
    const achievementsToAward = [];

    if (rounds === 1) achievementsToAward.push('first_round');
    if (rounds === 5) achievementsToAward.push('round_5');
    if (rounds === 10) achievementsToAward.push('round_10');
    if (rounds === 20) achievementsToAward.push('round_20');

    for (const achievementId of achievementsToAward) {
        try {
            await fetch('/api/achievements', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: user.username,
                    game_id: 'anicom',
                    achievement_id: achievementId
                })
            });
        } catch (error) {
            console.error('Error awarding achievement:', error);
        }
    }
}

// Play again
function playAgain() {
    startGame();
}

// Setup autocomplete
function setupAutocomplete() {
    const input = document.getElementById('guess-input');
    const autocompleteList = document.getElementById('autocomplete-list');

    input.addEventListener('input', function() {
        const value = this.value.toLowerCase().trim();
        
        // Close any already open lists
        autocompleteList.innerHTML = '';
        selectedAutocompleteIndex = -1;

        if (!value || value.length < 2) {
            return;
        }

        // Filter anime that match the input and haven't been used
        const matches = gameState.animeCache
            .filter(anime => {
                if (gameState.usedAnimeIds.has(anime.mal_id)) return false;
                
                const title = (anime.title || '').toLowerCase();
                const titleEng = (anime.title_english || '').toLowerCase();
                return title.includes(value) || titleEng.includes(value);
            })
            .slice(0, 10); // Limit to 10 results

        matches.forEach(anime => {
            const div = document.createElement('div');
            const displayTitle = anime.title_english || anime.title;
            div.innerHTML = displayTitle;
            div.addEventListener('click', function() {
                input.value = anime.title;
                autocompleteList.innerHTML = '';
            });
            autocompleteList.appendChild(div);
        });
    });

    // Handle keyboard navigation
    input.addEventListener('keydown', function(e) {
        const items = autocompleteList.getElementsByTagName('div');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
            updateAutocompleteSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
            updateAutocompleteSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
                items[selectedAutocompleteIndex].click();
            } else {
                submitGuess();
            }
        } else if (e.key === 'Escape') {
            autocompleteList.innerHTML = '';
            selectedAutocompleteIndex = -1;
        }
    });

    // Close autocomplete when clicking outside
    document.addEventListener('click', function(e) {
        if (e.target !== input) {
            autocompleteList.innerHTML = '';
            selectedAutocompleteIndex = -1;
        }
    });
}

// Update autocomplete selection styling
function updateAutocompleteSelection(items) {
    for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('autocomplete-active');
    }
    if (selectedAutocompleteIndex >= 0 && items[selectedAutocompleteIndex]) {
        items[selectedAutocompleteIndex].classList.add('autocomplete-active');
        items[selectedAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    }
}
