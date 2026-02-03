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
    DIFFERENT_GENRE: 'different_genre',
    SAME_STUDIO: 'same_studio',
    DIFFERENT_STUDIO: 'different_studio',
    SAME_TAG: 'same_tag',
    SAME_SOURCE: 'same_source',
    DIFFERENT_SOURCE: 'different_source',
    SAME_YEAR: 'same_year',
    EARLIER_YEAR: 'earlier_year',
    LATER_YEAR: 'later_year',
    WITHIN_YEAR_RANGE: 'within_year_range',
    HAS_GENRE: 'has_genre',
    HAS_TAG: 'has_tag',
    SCORE_RANGE: 'score_range',
    MULTIPLE_GENRES: 'multiple_genres',
    MORE_EPISODES: 'more_episodes',
    FEWER_EPISODES: 'fewer_episodes'
};

// User info
const storedUser = localStorage.getItem('discord_user');
const user = storedUser ? JSON.parse(storedUser) : { username: "Anonymous" };

// Autocomplete state
let selectedAutocompleteIndex = -1;

// Helper function to extract year from release_date
function getYear(release_date) {
    if (!release_date) return null;
    // Works for both "2020" and "2020-01-15" formats
    return parseInt(release_date);
}

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
    document.getElementById('score-count').innerText = '0';
    document.getElementById('used-count').innerText = '0';
    document.getElementById('used-anime-list').innerHTML = '';
    document.getElementById('guess-input').value = '';
    document.getElementById('result-screen').style.display = 'none';
    document.getElementById('submit-btn').disabled = false;
    
    // Hide anime cover initially
    const coverImg = document.getElementById('anime-cover');
    if (coverImg) {
        coverImg.style.display = 'none';
    }

    // Load anime cache
    await loadAnimeCache();

    // Start first round
    await startNewRound();
}

// Load anime list from server (full details for comparison)
async function loadAnimeCache() {
    try {
        console.log('Loading anime cache...');
        const response = await fetch('/api/anidle/anime-full-list');
        if (!response.ok) throw new Error('Failed to load anime list');
        
        const data = await response.json();
        gameState.animeCache = data;
        console.log(`Loaded ${gameState.animeCache.length} anime with full details`);
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

    // Use the anime from cache (already has full details)
    gameState.currentAnime = randomAnime;
    gameState.usedAnimeIds.add(gameState.currentAnime.mal_id);

    // Generate a random challenge
    generateChallenge();

    // Update UI
    updateUI();
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
            validator: (selectedAnime) => selectedAnime.score && selectedAnime.score > anime.score
        });
        
        possibleChallenges.push({
            type: CHALLENGE_TYPES.LOWER_SCORE,
            text: `Choose an anime with a LOWER MAL score than ${anime.score.toFixed(2)}`,
            validator: (selectedAnime) => selectedAnime.score && selectedAnime.score < anime.score
        });

        // Score range challenge
        const lowerBound = Math.max(1, anime.score - 0.5);
        const upperBound = Math.min(10, anime.score + 0.5);
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SCORE_RANGE,
            text: `Choose an anime with a score between ${lowerBound.toFixed(2)} and ${upperBound.toFixed(2)}`,
            validator: (selectedAnime) => selectedAnime.score && selectedAnime.score >= lowerBound && selectedAnime.score <= upperBound
        });
    }

    // Genre challenges (if anime has genres)
    if (anime.genres && anime.genres.length > 0) {
        // Same genre challenge
        const randomGenre = anime.genres[Math.floor(Math.random() * anime.genres.length)];
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_GENRE,
            text: `Choose an anime with the genre: ${randomGenre}`,
            validator: (selectedAnime) => {
                return selectedAnime.genres && selectedAnime.genres.includes(randomGenre);
            },
            genre: randomGenre
        });

        // Different genre challenge (no genres in common)
        possibleChallenges.push({
            type: CHALLENGE_TYPES.DIFFERENT_GENRE,
            text: `Choose an anime that does NOT have any of these genres: ${anime.genres.join(', ')}`,
            validator: (selectedAnime) => {
                if (!selectedAnime.genres) return false;
                return !selectedAnime.genres.some(g => anime.genres.includes(g));
            }
        });

        // Has specific genre challenge
        possibleChallenges.push({
            type: CHALLENGE_TYPES.HAS_GENRE,
            text: `Choose an anime that HAS the genre: ${randomGenre}`,
            validator: (selectedAnime) => {
                return selectedAnime.genres && selectedAnime.genres.includes(randomGenre);
            }
        });

        // Multiple genres challenge (has at least 2 matching genres)
        if (anime.genres.length >= 2) {
            possibleChallenges.push({
                type: CHALLENGE_TYPES.MULTIPLE_GENRES,
                text: `Choose an anime that shares at least TWO genres with ${anime.title}`,
                validator: (selectedAnime) => {
                    if (!selectedAnime.genres) return false;
                    const matchingGenres = selectedAnime.genres.filter(g => anime.genres.includes(g));
                    return matchingGenres.length >= 2;
                }
            });
        }
    }

    // Studio challenges (if anime has studio)
    if (anime.studio) {
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_STUDIO,
            text: `Choose an anime made by: ${anime.studio}`,
            validator: (selectedAnime) => {
                return selectedAnime.studio === anime.studio;
            },
            studio: anime.studio
        });

        possibleChallenges.push({
            type: CHALLENGE_TYPES.DIFFERENT_STUDIO,
            text: `Choose an anime NOT made by: ${anime.studio}`,
            validator: (selectedAnime) => {
                return selectedAnime.studio && selectedAnime.studio !== anime.studio;
            }
        });
    }

    // Tag/Theme challenges (using tags array)
    if (anime.tags && anime.tags.length > 0) {
        const randomTag = anime.tags[Math.floor(Math.random() * anime.tags.length)];
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_TAG,
            text: `Choose an anime with the tag: ${randomTag.name}`,
            validator: (selectedAnime) => {
                return selectedAnime.tags && selectedAnime.tags.some(t => t.name === randomTag.name);
            },
            tag: randomTag
        });

        possibleChallenges.push({
            type: CHALLENGE_TYPES.HAS_TAG,
            text: `Choose an anime that HAS the tag: ${randomTag.name}`,
            validator: (selectedAnime) => {
                return selectedAnime.tags && selectedAnime.tags.some(t => t.name === randomTag.name);
            }
        });
    }

    // Source challenges (if anime has source)
    if (anime.source) {
        possibleChallenges.push({
            type: CHALLENGE_TYPES.SAME_SOURCE,
            text: `Choose an anime with the same source material: ${anime.source}`,
            validator: (selectedAnime) => {
                return selectedAnime.source === anime.source;
            }
        });

        possibleChallenges.push({
            type: CHALLENGE_TYPES.DIFFERENT_SOURCE,
            text: `Choose an anime with a DIFFERENT source than: ${anime.source}`,
            validator: (selectedAnime) => {
                return selectedAnime.source && selectedAnime.source !== anime.source;
            }
        });
    }

    // Release year challenges (if anime has release_date)
    if (anime.release_date) {
        const year = getYear(anime.release_date);
        
        if (year) {
            possibleChallenges.push({
                type: CHALLENGE_TYPES.SAME_YEAR,
                text: `Choose an anime released in the SAME YEAR: ${year}`,
                validator: (selectedAnime) => {
                    return getYear(selectedAnime.release_date) === year;
                }
            });

            possibleChallenges.push({
                type: CHALLENGE_TYPES.EARLIER_YEAR,
                text: `Choose an anime released BEFORE ${year}`,
                validator: (selectedAnime) => {
                    const selectedYear = getYear(selectedAnime.release_date);
                    return selectedYear && selectedYear < year;
                }
            });

            possibleChallenges.push({
                type: CHALLENGE_TYPES.LATER_YEAR,
                text: `Choose an anime released AFTER ${year}`,
                validator: (selectedAnime) => {
                    const selectedYear = getYear(selectedAnime.release_date);
                    return selectedYear && selectedYear > year;
                }
            });

            // Within year range challenge
            const rangeLower = year - 2;
            const rangeUpper = year + 2;
            possibleChallenges.push({
                type: CHALLENGE_TYPES.WITHIN_YEAR_RANGE,
                text: `Choose an anime released between ${rangeLower} and ${rangeUpper}`,
                validator: (selectedAnime) => {
                    const selectedYear = getYear(selectedAnime.release_date);
                    return selectedYear && selectedYear >= rangeLower && selectedYear <= rangeUpper;
                }
            });
        }
    }

    // Episode challenges (if anime has episode count)
    if (anime.episodes && anime.episodes > 0) {
        possibleChallenges.push({
            type: CHALLENGE_TYPES.MORE_EPISODES,
            text: `Choose an anime with MORE episodes than ${anime.episodes}`,
            validator: (selectedAnime) => {
                return selectedAnime.episodes && selectedAnime.episodes > anime.episodes;
            }
        });

        possibleChallenges.push({
            type: CHALLENGE_TYPES.FEWER_EPISODES,
            text: `Choose an anime with FEWER episodes than ${anime.episodes}`,
            validator: (selectedAnime) => {
                return selectedAnime.episodes && selectedAnime.episodes < anime.episodes;
            }
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
    
    // Update score (same as rounds)
    document.getElementById('score-count').innerText = gameState.roundsCompleted;

    // Update current anime display
    document.getElementById('anime-name').innerText = anime.title_english || anime.title || 'Unknown';
    
    // Display anime cover if available
    const coverImg = document.getElementById('anime-cover');
    if (coverImg && anime.image) {
        coverImg.src = anime.image;
        coverImg.alt = `${anime.title_english || anime.title} cover`;
        coverImg.style.display = 'block';
        
        // Handle image load errors
        coverImg.onerror = function() {
            coverImg.style.display = 'none';
        };
    }
    
    // Build details string
    let details = [];
    if (anime.score) details.push(`<span class="detail-item"><span class="detail-label">Score:</span> <span class="detail-value">${anime.score.toFixed(2)}</span></span>`);
    if (anime.genres && anime.genres.length > 0) {
        const genreNames = anime.genres.join(', ');
        details.push(`<span class="detail-item"><span class="detail-label">Genres:</span> <span class="detail-value">${genreNames}</span></span>`);
    }
    if (anime.studio) {
        details.push(`<span class="detail-item"><span class="detail-label">Studio:</span> <span class="detail-value">${anime.studio}</span></span>`);
    }
    if (anime.release_date) {
        details.push(`<span class="detail-item"><span class="detail-label">Year:</span> <span class="detail-value">${anime.release_date}</span></span>`);
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

    // Use cached data - the guessedAnime already has full details
    const selectedAnime = guessedAnime;

    // Validate the guess
    const isValid = gameState.currentChallenge.validator(selectedAnime);

    if (isValid) {
        // Correct answer!
        gameState.roundsCompleted++;
        gameState.score = gameState.roundsCompleted; // Score equals rounds
        
        // Update score display immediately
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
}

// Get failure reason message
function getFailureReason(selectedAnime) {
    const challenge = gameState.currentChallenge;
    const current = gameState.currentAnime;

    switch (challenge.type) {
        case CHALLENGE_TYPES.HIGHER_SCORE:
            if (!selectedAnime.score) {
                return `${selectedAnime.title} has an unknown score, required: higher than ${current.score.toFixed(2)}.`;
            }
            return `${selectedAnime.title} has a score of ${selectedAnime.score.toFixed(2)}, not higher than ${current.score.toFixed(2)}.`;
        case CHALLENGE_TYPES.LOWER_SCORE:
            if (!selectedAnime.score) {
                return `${selectedAnime.title} has an unknown score, required: lower than ${current.score.toFixed(2)}.`;
            }
            return `${selectedAnime.title} has a score of ${selectedAnime.score.toFixed(2)}, not lower than ${current.score.toFixed(2)}.`;
        case CHALLENGE_TYPES.SCORE_RANGE:
            if (!selectedAnime.score) {
                return `${selectedAnime.title} has an unknown score.`;
            }
            // Score range is ±0.5 from current anime's score, bounded by MAL's 1-10 scale
            const lowerBound = Math.max(1, current.score - 0.5);
            const upperBound = Math.min(10, current.score + 0.5);
            return `${selectedAnime.title} has a score of ${selectedAnime.score.toFixed(2)}, not between ${lowerBound.toFixed(2)} and ${upperBound.toFixed(2)}.`;
        case CHALLENGE_TYPES.SAME_GENRE:
        case CHALLENGE_TYPES.HAS_GENRE:
            const requiredGenre = challenge.genre || 'the required genre';
            const selectedGenres = selectedAnime.genres && selectedAnime.genres.length > 0 
                ? selectedAnime.genres.join(', ') 
                : 'no genres';
            return `${selectedAnime.title} has genres: ${selectedGenres}, not ${requiredGenre}.`;
        case CHALLENGE_TYPES.DIFFERENT_GENRE:
            const currentGenresStr = current.genres && current.genres.length > 0 
                ? current.genres.join(', ') 
                : 'unknown';
            const sharedGenres = selectedAnime.genres && current.genres
                ? selectedAnime.genres.filter(g => current.genres.includes(g))
                : [];
            // Validator should ensure sharedGenres.length > 0 when this is called
            const sharedGenresList = sharedGenres.length > 0 ? sharedGenres.join(', ') : 'unknown genres';
            return `${selectedAnime.title} shares genre(s): ${sharedGenresList} with ${current.title}.`;
        case CHALLENGE_TYPES.MULTIPLE_GENRES:
            const animeGenresList = selectedAnime.genres && selectedAnime.genres.length > 0 
                ? selectedAnime.genres.join(', ') 
                : 'no genres';
            const matchingGenres = selectedAnime.genres && current.genres
                ? selectedAnime.genres.filter(g => current.genres.includes(g))
                : [];
            if (matchingGenres.length === 0) {
                return `${selectedAnime.title} has genres: ${animeGenresList}, but shares no genres with ${current.title} (required: at least 2).`;
            }
            return `${selectedAnime.title} has genres: ${animeGenresList}, only ${matchingGenres.length} genre(s) match with ${current.title} (required: at least 2).`;
        case CHALLENGE_TYPES.SAME_STUDIO:
            const requiredStudio = challenge.studio || current.studio;
            const selectedStudio = selectedAnime.studio || 'unknown studio';
            return `${selectedAnime.title} is made by ${selectedStudio}, not ${requiredStudio}.`;
        case CHALLENGE_TYPES.DIFFERENT_STUDIO:
            return `${selectedAnime.title} is made by ${selectedAnime.studio || 'unknown'}, same as ${current.title} (${current.studio}).`;
        case CHALLENGE_TYPES.SAME_TAG:
        case CHALLENGE_TYPES.HAS_TAG:
            const requiredTag = challenge.tag ? challenge.tag.name : 'the required tag';
            const selectedTags = selectedAnime.tags && selectedAnime.tags.length > 0 
                ? selectedAnime.tags.map(t => t.name).join(', ') 
                : 'no tags';
            return `${selectedAnime.title} has tags: ${selectedTags}, not ${requiredTag}.`;
        case CHALLENGE_TYPES.SAME_SOURCE:
            const selectedSource = selectedAnime.source || 'Unknown';
            const requiredSource = current.source || 'Unknown';
            return `${selectedAnime.title} has source: ${selectedSource}, not ${requiredSource}.`;
        case CHALLENGE_TYPES.DIFFERENT_SOURCE:
            return `${selectedAnime.title} has source: ${selectedAnime.source || 'Unknown'}, same as ${current.title} (${current.source}).`;
        case CHALLENGE_TYPES.SAME_YEAR:
            if (!selectedAnime.release_date) {
                return `${selectedAnime.title} has an unknown release date, required year: ${current.release_date}.`;
            }
            return `${selectedAnime.title} was released in ${selectedAnime.release_date}, not ${current.release_date}.`;
        case CHALLENGE_TYPES.EARLIER_YEAR:
            if (!selectedAnime.release_date) {
                return `${selectedAnime.title} has an unknown release date, required: before ${current.release_date}.`;
            }
            return `${selectedAnime.title} was released in ${selectedAnime.release_date}, not before ${current.release_date}.`;
        case CHALLENGE_TYPES.LATER_YEAR:
            if (!selectedAnime.release_date) {
                return `${selectedAnime.title} has an unknown release date, required: after ${current.release_date}.`;
            }
            return `${selectedAnime.title} was released in ${selectedAnime.release_date}, not after ${current.release_date}.`;
        case CHALLENGE_TYPES.WITHIN_YEAR_RANGE:
            if (!selectedAnime.release_date) {
                return `${selectedAnime.title} has an unknown release date.`;
            }
            return `${selectedAnime.title} was released in ${selectedAnime.release_date}, not in the required year range.`;
        case CHALLENGE_TYPES.MORE_EPISODES:
            if (!selectedAnime.episodes) {
                return `${selectedAnime.title} has an unknown episode count, required: more than ${current.episodes}.`;
            }
            return `${selectedAnime.title} has ${selectedAnime.episodes} episodes, not more than ${current.episodes}.`;
        case CHALLENGE_TYPES.FEWER_EPISODES:
            if (!selectedAnime.episodes) {
                return `${selectedAnime.title} has an unknown episode count, required: fewer than ${current.episodes}.`;
            }
            return `${selectedAnime.title} has ${selectedAnime.episodes} episodes, not fewer than ${current.episodes}.`;
        default:
            return 'The selected anime does not meet the challenge requirements.';
    }
}

// End game
function endGame(reason) {
    gameState.gameOver = true;
    
    // Show result screen
    document.getElementById('result-title').innerText = 'Game Over!';
    document.getElementById('final-score').innerText = gameState.score;
    document.getElementById('result-reason').innerText = reason;
    document.getElementById('result-screen').style.display = 'flex';

    // Submit score to server
    submitScore();
    
    // Load leaderboard
    loadLeaderboard();
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
            await fetch('/api/achievements/unlock', {
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

// Search anime using API (similar to Anidle)
async function searchAnime(query) {
    try {
        // Use Jikan API for anime search
        const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=15&sfw`);
        if (!res.ok) return [];
        const data = await res.json();
        const results = data.data || [];

        // Filter to only TV and Movie types
        return results.filter(a => {
            if (a.type !== 'TV' && a.type !== 'Movie') return false;
            // Filter out already used anime
            if (gameState.usedAnimeIds.has(a.mal_id)) return false;
            return true;
        });
    } catch (err) {
        console.error('Jikan API Error:', err);
        // Fallback to cache search
        return gameState.animeCache
            .filter(anime => {
                if (gameState.usedAnimeIds.has(anime.mal_id)) return false;
                const title = (anime.title || '').toLowerCase();
                const titleEng = (anime.title_english || '').toLowerCase();
                return title.includes(query.toLowerCase()) || titleEng.includes(query.toLowerCase());
            })
            .slice(0, 10);
    }
}

// Setup autocomplete
function setupAutocomplete() {
    const input = document.getElementById('guess-input');
    const autocompleteList = document.getElementById('autocomplete-list');
    let debounceTimer;

    input.addEventListener('input', function() {
        const value = this.value.trim();
        
        // Close any already open lists
        autocompleteList.innerHTML = '';
        selectedAutocompleteIndex = -1;

        clearTimeout(debounceTimer);

        if (!value || value.length < 2) {
            return;
        }

        // Debounce search to avoid too many API calls
        debounceTimer = setTimeout(async () => {
            const matches = await searchAnime(value);

            if (matches.length === 0) {
                return;
            }

            matches.forEach(anime => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                
                // Use title from API response or cache
                const displayTitle = anime.title_english || anime.title;
                div.textContent = displayTitle;
                
                div.addEventListener('click', function() {
                    input.value = displayTitle;
                    autocompleteList.innerHTML = '';
                });
                autocompleteList.appendChild(div);
            });
        }, 300); // 300ms debounce delay
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

// Load and display leaderboard
async function loadLeaderboard() {
    const leaderboardList = document.getElementById('result-leaderboard-list');
    
    try {
        leaderboardList.innerHTML = '<div class="leaderboard-loading">Loading top scores...</div>';
        
        // Fetch top scores from API
        const response = await fetch('/api/scores?game=anicom&board=high_score&limit=10');
        
        if (!response.ok) {
            if (response.status === 404) {
                leaderboardList.innerHTML = '<div class="leaderboard-loading">No scores yet. Be the first!</div>';
                return;
            }
            throw new Error('Failed to fetch leaderboard');
        }
        
        const scores = await response.json();
        
        if (!scores || scores.length === 0) {
            leaderboardList.innerHTML = '<div class="leaderboard-loading">No scores yet. Be the first!</div>';
            return;
        }
        
        // Build leaderboard HTML
        leaderboardList.innerHTML = '';
        scores.forEach((score, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            
            // Highlight current user
            if (user && score.username === user.username) {
                item.classList.add('current-user');
            }
            
            const rank = index + 1;
            const rankClass = `rank-${rank}`;
            
            // Create elements safely to prevent XSS
            const rankSpan = document.createElement('span');
            rankSpan.className = `leaderboard-rank ${rankClass}`;
            rankSpan.textContent = `#${rank}`;
            
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'leaderboard-username';
            usernameSpan.textContent = score.username;
            
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'leaderboard-score';
            scoreSpan.textContent = score.score;
            
            item.appendChild(rankSpan);
            item.appendChild(usernameSpan);
            item.appendChild(scoreSpan);
            
            leaderboardList.appendChild(item);
        });
        
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        leaderboardList.innerHTML = '<div class="leaderboard-loading">Failed to load leaderboard</div>';
    }
}
