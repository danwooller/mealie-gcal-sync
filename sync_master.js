const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dns = require('node:dns');
const https = require('node:https');

// --- NETWORK HARDENING ---
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const ipv4Agent = new https.Agent({ family: 4, keepAlive: true });
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

async function retryCall(fn, label, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); } catch (err) {
            if (err.code === 'ENETUNREACH' || err.message.includes('ENETUNREACH')) {
                console.log(`⚠️ [${label}] Network unreachable. Retry ${i+1}/${maxRetries} in 15s...`);
                await sleep(15000);
            } else { throw err; }
        }
    }
    throw new Error(`Failed ${label} after ${maxRetries} retries.`);
}

async function syncMaster() {
    console.log("🔄 Master Sync: Anti-Duplicate Mode");
    const calendar = google.calendar({ version: 'v3', auth });
    const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

    const plans = await retryCall(async () => {
        const res = await axios.get(`${MEALIE_URL}/api/households/mealplans`, { headers });
        return res.data.items || [];
    }, "Mealie API");

    const gRes = await retryCall(async () => {
        return await calendar.events.list({ 
            calendarId: CALENDAR_ID, 
            singleEvents: true, 
            timeMin: new Date().toISOString() 
        });
    }, "Google Calendar API");
    
    let gEvents = gRes.data.items || [];

    for (const plan of plans) {
        const planDate = plan.date.split('T')[0];
        const planName = plan.recipe?.name || plan.title || plan.note;
        if (!planName || planName === "Unnamed Meal") continue;

        // CRITICAL CHECK: Does this ID or this Name/Date combo already exist in the list we fetched?
        const existing = gEvents.find(g => {
            const gDate = g.start.date || g.start.dateTime?.split('T')[0];
            const matchId = g.description?.includes(`MEALIE_ID: ${plan.id}`);
            const matchName = (gDate === planDate && g.summary === planName);
            return matchId || matchName;
        });

        const description = `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}`;

        if (existing) {
            // Just update the description to ensure the ID is there for next time
            if (!existing.description?.includes(`MEALIE_ID: ${plan.id}`)) {
                try {
                    console.log(`📝 Adopting: ${planName}`);
                    await calendar.events.patch({
                        calendarId: CALENDAR_ID,
                        eventId: existing.id,
                        resource: { description }
                    });
                    await sleep(3000);
                } catch (e) { console.error(`⚠️ Patch failed: ${e.message}`); }
            } else {
                console.log(`⏭️ Skipping (Already exists): ${planName}`);
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
                        description
                    }
                });
                // Add to our local list so if we loop back, we don't create it again
                gEvents.push({ summary: planName, start: { date: planDate }, description });
                await sleep(4000); // Higher delay to keep the network stable
            } catch (e) { console.error(`⚠️ Insert failed: ${e.message}`); }
        }
    }
    console.log("✨ Sync Finished.");
}

syncMaster().catch(err => {
    console.error("❌ Fatal Process Error:", err.message);
    process.exit(1);
});
