const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

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
    
    console.log("📚 Fetching Mealie recipe library...");
    const libRes = await axios.get(`${MEALIE_URL}/api/recipes?per_page=1000`, { headers });
    const recipes = libRes.data.items || [];

    // Helper: Normalize strings for easier matching
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    console.log("🔍 Fetching Calendar events...");
    const res = await calendar.events.list({ calendarId: CALENDAR_ID, orderBy: 'startTime', singleEvents: true });
    const events = (res.data.items || []).slice(0, 5); // Testing 5 now
    
    for (const event of events) {
        const mealDate = event.start.date || event.start.dateTime.split('T')[0];
        const calendarName = event.summary || "";
        
        // Match by normalizing the names
        const normalizedCalName = normalize(calendarName);
        const existingRecipe = recipes.find(r => normalize(r.name) === normalizedCalName);

        if (existingRecipe) {
            console.log(`✅ MATCH: '${calendarName}' -> Found '${existingRecipe.name}'`);
            
            try {
                await axios.post(`${MEALIE_URL}/api/households/mealplans`, {
                    date: mealDate,
                    recipeId: existingRecipe.id,
                    entryType: "dinner"
                }, { headers });
            } catch (err) {
                console.log(`   ⚠️ Could not add to plan (maybe already exists?): ${err.message}`);
            }
        } else {
            console.log(`❌ NO MATCH: Could not find recipe titled '${calendarName}' in library.`);
        }
    }
}

matchHistoric().catch(console.error);
