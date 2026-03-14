const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// --- CONFIG ---
const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const MEALIE_TOKEN = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/)[1].trim();
const MEALIE_URL = "http://127.0.0.1:9925";
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';
const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
});

async function matchHistoric() {
    const calendar = google.calendar({ version: 'v3', auth });
    
    // 1. Get existing recipes from Mealie
    console.log("📚 Fetching Mealie recipe library...");
    const libRes = await axios.get(`${MEALIE_URL}/api/recipes?per_page=1000`, { headers });
    const recipes = libRes.data.items || [];

    // 2. Fetch Calendar Events
    const res = await calendar.events.list({ calendarId: CALENDAR_ID, orderBy: 'startTime', singleEvents: true });
    
    // LIMIT TO 2 FOR SAFETY
    const events = (res.data.items || []).slice(0, 2); 
    
    for (const event of events) {
        const mealDate = event.start.date || event.start.dateTime.split('T')[0];
        const desc = event.description || "";
        const urlMatch = desc.match(/https?:\/\/[^\s"<>]+/);
        let recipeUrl = urlMatch ? urlMatch[0] : null;

        if (recipeUrl) {
            // Unwrap if it's a google redirect
            if (recipeUrl.includes('google.com/url?q=')) {
                recipeUrl = new URL(recipeUrl).searchParams.get('q').split('&')[0];
            }

            // Match URL against Mealie Library
            const existingRecipe = recipes.find(r => r.recipeSource === recipeUrl);

            if (existingRecipe) {
                console.log(`✅ MATCH: ${event.summary} -> ${existingRecipe.name}`);
                
                await axios.post(`${MEALIE_URL}/api/households/mealplans`, {
                    date: mealDate,
                    recipeId: existingRecipe.id,
                    entryType: "dinner"
                }, { headers });
            } else {
                console.log(`❌ NO MATCH: Could not find ${recipeUrl} in library.`);
            }
        }
    }
}

matchHistoric().catch(console.error);
