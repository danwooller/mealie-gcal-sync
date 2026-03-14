const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dns = require('node:dns');
const https = require('node:https');

// --- NETWORK FIXES ---
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const ipv4Agent = new https.Agent({ family: 4 });
axios.defaults.httpsAgent = ipv4Agent;

const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const MEALIE_TOKEN = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/)[1].trim();
const MEALIE_URL = "http://127.0.0.1:9925";
const MEALIE_PUBLIC_URL = "http://mealie.wooller.com";
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';

const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/calendar']
});

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function syncMaster() {
    console.log("🔄 Master Sync Starting (Resilient Mode)...");
    const calendar = google.calendar({ version: 'v3', auth });
    const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

    const planRes = await axios.get(`${MEALIE_URL}/api/households/mealplans`, { headers });
    const plans = planRes.data.items || [];

    // Re-fetch calendar inside the loop or use a fresh list to prevent duplicates
    const gRes = await calendar.events.list({ calendarId: CALENDAR_ID, singleEvents: true, timeMin: new Date().toISOString() });
    let gEvents = gRes.data.items || [];

    for (const plan of plans) {
        const planDate = plan.date.split('T')[0];
        const planName = plan.recipe?.name || plan.title || plan.note || "Unnamed Meal";
        if (planName === "Unnamed Meal") continue; // Skip junk from Mealie side

        const existing = gEvents.find(g => {
            const gDate = g.start.date || g.start.dateTime?.split('T')[0];
            return (g.description?.includes(`MEALIE_ID: ${plan.id}`)) || (gDate === planDate && g.summary === planName);
        });

        if (existing) {
            if (!existing.description?.includes(`MEALIE_ID: ${plan.id}`)) {
                try {
                    console.log(`📝 Adopting: ${planName}`);
                    await calendar.events.patch({
                        calendarId: CALENDAR_ID,
                        eventId: existing.id,
                        resource: { description: `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}` }
                    });
                    await sleep(3000); 
                } catch (e) { console.error(`⚠️ Network glitch on patch: ${planName}`); await sleep(5000); }
            }
        } else {
            try {
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
                await sleep(3000); // 3 seconds is safer for your network
            } catch (e) {
                console.error(`⚠️ Network glitch on insert: ${planName}. Skipping...`);
                await sleep(5000); // Wait longer if it hits a wall
            }
        }
    }
    console.log("✨ Sync Finished.");
}

syncMaster().catch(err => console.error("FATAL ERROR:", err.message));
