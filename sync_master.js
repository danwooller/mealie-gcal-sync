const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function robustApiCall(apiFn, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiFn();
        } catch (err) {
            if (err.code === 'ENETUNREACH' && i < retries - 1) {
                console.log(`⚠️ Network unreachable. Retrying in 5 seconds...`);
                await delay(5000);
                continue;
            }
            throw err;
        }
    }
}

// --- CONFIGURATION ---
const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const MEALIE_TOKEN = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/)[1].trim();
const MEALIE_URL = "http://127.0.0.1:9925";
const MEALIE_PUBLIC_URL = "http://mealie.wooller.com";
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';

const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/calendar']
});

async function syncMaster() {
    console.log("🔄 Master Sync Starting...");
    const calendar = google.calendar({ version: 'v3', auth });
    const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

    // 1. Fetch current Meal Plan from Mealie
    const planRes = await axios.get(`${MEALIE_URL}/api/households/mealplans`, { headers });
    const plans = planRes.data.items || [];

    // 2. Fetch Google Calendar Events
    const gRes = await calendar.events.list({ calendarId: CALENDAR_ID, singleEvents: true, timeMin: new Date().toISOString() });
    const gEvents = gRes.data.items || [];
    const processedGCalIds = new Set();

    for (const plan of plans) {
        const planDate = plan.date.split('T')[0];
        const planName = plan.recipe?.name || plan.title || plan.note || "Unnamed Meal";
        
        // Find existing event (Look for ID, or adopt via Name/Date)
        const existingGCalEvent = gEvents.find(g => {
            const gDate = g.start.date || g.start.dateTime?.split('T')[0];
            const hasId = g.description?.includes(`MEALIE_ID: ${plan.id}`);
            const isSameDayAndName = (gDate === planDate && g.summary === planName);
            return hasId || isSameDayAndName;
        });

        if (existingGCalEvent) {
            processedGCalIds.add(existingGCalEvent.id);
            // Adopt/Update if description is missing ID
            if (!existingGCalEvent.description?.includes(`MEALIE_ID: ${plan.id}`)) {
                console.log(`📝 Adopting: ${planName}`);
                await calendar.events.patch({
                    calendarId: CALENDAR_ID,
                    eventId: existingGCalEvent.id,
                    resource: { 
                        description: `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}`
                    }
                });
            }
        } else {
            console.log(`➕ Creating: ${planName}`);
            await calendar.events.insert({
                calendarId: CALENDAR_ID,
                resource: {
                    summary: planName,
                    start: { date: planDate },
                    end: { date: planDate },
                    description: `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}`
                }
            });
        }
    }
    console.log("✨ Sync Finished.");
}

syncMaster().catch(err => console.error("FATAL ERROR:", err.message));
