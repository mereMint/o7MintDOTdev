
window.addEventListener('scroll', () => {
    document.body.style.setProperty('--scroll-position', window.scrollY);
});

// Utility for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTypewriter() {
    const element = document.getElementById("txt");
    if (!element) return;

    const fullText = element.innerText;

    // Helper for random typing speed
    const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

    while (true) {
        // Backspace effect (keep first 2 chars "o7") - with cursor
        for (let i = fullText.length; i > 2; i--) {
            element.innerText = fullText.substring(0, i) + "|";
            await sleep(randomDelay(30, 80));
        }

        // Ensure it ends at "o7|"
        element.innerText = fullText.substring(0, 2) + "|";

        // Blink Cursor while waiting
        for (let b = 0; b < 3; b++) {
            await sleep(400);
            element.innerText = fullText.substring(0, 2); // Cursor off
            await sleep(400);
            element.innerText = fullText.substring(0, 2) + "|"; // Cursor on
        }

        // Remove cursor and wait 3 seconds
        element.innerText = fullText.substring(0, 2);
        await sleep(3000);

        // Retype effect - variable speed with persistent cursor
        for (let i = 2; i <= fullText.length; i++) {
            element.innerText = fullText.substring(0, i) + "|";
            await sleep(randomDelay(50, 250));
            // Cursor stays until next char overwrites it
        }

        // Remove cursor briefly for clean full text? 
        // Or jump straight to the full blinking loop below.
        // The original code had a separate blink loop for the end.
        element.innerText = fullText;

        // Blink cursor at the end
        for (let i = 0; i < 3; i++) {
            element.innerText = fullText + "|";
            await sleep(400);
            element.innerText = fullText;
            await sleep(400);
        }

        await sleep(3000);
    }
}

// Ensure DOM is ready before running
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runTypewriter);
} else {
    runTypewriter();
}