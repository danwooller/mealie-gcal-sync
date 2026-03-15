const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dns = require('node:dns');
const https = require('node:https');

// --- NETWORK HARDENING ---
//dns.setDefaultResultOrder('ipv4first');
//dns.setServers(['8.8.8.8', '8.8.4.4']);
//const ipv4Agent = new https.Agent({ family: 4, keepAlive: true });
//axios.defaults.httpsAgent = ipv4Agent;

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
    // Define the Window: 30 days back, 180 days forward
    const now = new Date();
    const timeMin = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const timeMax = new Date(now.getTime() + (180 * 24 * 60 * 60 * 1000));

    console.log(`🔄 Master Sync: Rolling Window (${timeMin.toISOString().split('T')[0]} to ${timeMax.toISOString().split('T')[0]})`);
    
    const calendar = google.calendar({ version: 'v3', auth });
    const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

    // 1. Fetch plans from Mealie for the window
    const plans = await retryCall(async () => {
        const res = await axios.get(`${MEALIE_URL}/api/households/mealplans?start_date=${timeMin.toISOString().split('T')[0]}&end_date=${timeMax.toISOString().split('T')[0]}`, { headers });
        return res.data.items || [];
    }, "Mealie API");

    // 2. Fetch GCal events for the same window
    const gRes = await retryCall(async () => {
        return await calendar.events.list({ 
            calendarId: CALENDAR_ID, 
            singleEvents: true, 
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            maxResults: 1000 
        });
    }, "Google Calendar API");
    
    let gEvents = gRes.data.items || [];
    console.log(`📅 Loaded ${gEvents.length} events for the current period.`);

    for (const plan of plans) {
        const planDate = plan.date.split('T')[0];
        const planName = (plan.recipe?.name || plan.title || plan.note || "").trim();
        
        // Strict Filter
        if (!planName || planName.toLowerCase() === "unnamed meal") continue;

        const existing = gEvents.find(g => {
            const gDate = g.start.date || g.start.dateTime?.split('T')[0];
            const matchId = g.description?.includes(`MEALIE_ID: ${plan.id}`);
            const matchName = (gDate === planDate && g.summary === planName);
            return matchId || matchName;
        });

        const description = `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}`;

        if (existing) {
            if (!existing.description?.includes(`MEALIE_ID: ${plan.id}`)) {
                try {
                    console.log(`📝 Adopting: [${planDate}] ${planName}`);
                    await calendar.events.patch({
                        calendarId: CALENDAR_ID,
                        eventId: existing.id,
                        resource: { description }
                    });
                    await sleep(1000); 
                } catch (e) { console.error(`⚠️ Patch failed: ${e.message}`); }
            }
        } else {
            try {
                console.log(`➕ Creating: [${planDate}] ${planName}`);
                await calendar.events.insert({
                    calendarId: CALENDAR_ID,
                    resource: {
                        summary: planName,
                        start: { date: planDate },
                        end: { date: planDate },
                        description
                    }
                });
                gEvents.push({ summary: planName, start: { date: planDate }, description });
                await sleep(2000); 
            } catch (e) { console.error(`⚠️ Insert failed: ${e.message}`); }
        }
    }
    console.log("✨ Sync Finished.");
}

syncMaster().catch(err => {
    console.error("❌ Fatal Process Error:", err.message);
    process.exit(1);
});
