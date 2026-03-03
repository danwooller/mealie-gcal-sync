const axios = require('axios');
const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

// --- CONFIG ---
const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const tokenMatch = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/);
const MEALIE_TOKEN = tokenMatch ? tokenMatch[1].trim() : null;
const MEALIE_URL = "http://127.0.0.1:9925";
const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

const KEYFILEPATH = path.join(__dirname, 'credentials.json');
// Note: Scope changed to 'calendar' (read/write) instead of 'calendar.readonly'
const auth = new google.auth.GoogleAuth({ 
    keyFile: KEYFILEPATH, 
    scopes: ['https://www.googleapis.com/auth/calendar'] 
});
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';

async function syncBothWays() {
    const calendar = google.calendar({ version: 'v3', auth });
    const todayStr = new Date().toISOString().split('T')[0];
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    console.log(`🔄 Syncing window: ${todayStr} to ${nextWeekStr}`);

    // --- 1. FETCH DATA FROM BOTH SIDES ---
    const mealiePlansRes = await axios.get(`${MEALIE_URL}/api/households/mealplans`, {
        params: { start_date: todayStr, end_date: nextWeekStr }, headers
    });
    const mealiePlans = mealiePlansRes.data.items || [];

    const gRes = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: new Date().toISOString(),
        timeMax: nextWeek.toISOString(),
        singleEvents: true
    });
    const gEvents = gRes.data.items || [];

    // --- 2. GOOGLE -> MEALIE (Download) ---
    for (const gEv of gEvents) {
        const gDate = gEv.start.date || gEv.start.dateTime.split('T')[0];
        if (!mealiePlans.find(p => p.date === gDate)) {
            console.log(`⬇️ Pulling from GCal: ${gEv.summary} on ${gDate}`);
            // [Insert your existing Import logic here]
        }
    }

    // --- 3. MEALIE -> GOOGLE (Upload) ---
    for (const plan of mealiePlans) {
        const planDate = plan.date;
        const planName = plan.recipe?.name || plan.title;

        // Check if GCal already has an event on this day
        const existsInGCal = gEvents.find(g => (g.start.date || g.start.dateTime.split('T')[0]) === planDate);

        if (!existsInGCal && planName) {
            console.log(`⬆️ Pushing to GCal: ${planName} on ${planDate}`);
            
            const eventBody = {
                summary: planName,
                description: plan.recipe ? `${MEALIE_URL}/recipe/${plan.recipe.slug}` : "Added via Mealie",
                start: { date: planDate },
                end: { date: planDate },
            };

            await calendar.events.insert({
                calendarId: CALENDAR_ID,
                resource: eventBody
            });
        }
    }
    console.log("✨ Bidirectional Sync Complete.");
}

syncBothWays().catch(console.error);