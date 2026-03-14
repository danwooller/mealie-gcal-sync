const axios = require('axios');
const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');
const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

// --- CONFIG ---
const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const tokenMatch = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/);
const MEALIE_TOKEN = tokenMatch ? tokenMatch[1].trim() : null;
const MEALIE_URL = "http://127.0.0.1:9925"; // Internal API calls
const MEALIE_PUBLIC_URL = "https://mealie.wooller.com"; // Public GCal links
const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

const KEYFILEPATH = path.join(__dirname, 'credentials.json');
const auth = new google.auth.GoogleAuth({ 
    keyFile: KEYFILEPATH, 
    scopes: ['https://www.googleapis.com/auth/calendar'] 
});
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';

// Helper to prevent ENETUNREACH / Rate Limits
const delay = ms => new Promise(res => setTimeout(res, ms));

async function syncMaster() {
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const end = new Date();
    end.setDate(now.getDate() + 14);

    const startStr = now.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    console.log(`🔄 Master Sync: ${startStr} to ${endStr}`);

    // --- FETCH DATA ---
    const mealieRes = await axios.get(`${MEALIE_URL}/api/households/mealplans`, {
        params: { start_date: startStr, end_date: endStr }, headers
    });
    const mealiePlans = mealieRes.data.items || [];

    const gRes = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: new Date(startStr).toISOString(),
        timeMax: new Date(endStr).toISOString(),
        singleEvents: true
    });
    const gEvents = gRes.data.items || [];
    const processedGCalIds = new Set();

    // --- STEP 1: MATCHING & UPDATING ---
    for (const plan of mealiePlans) {
        try {
            const planDate = plan.date; 
            let planName = plan.recipe?.name || plan.title || plan.note;
            if (!planName) {
                console.log(`⚠️ Skipping plan ${plan.id}: No name found.`);
                continue; // Skip this iteration
            }
            
            const existingGCalEvent = gEvents.find(g => {
                const gDate = g.start.date || g.start.dateTime?.split('T')[0];
                const hasId = g.description?.includes(`MEALIE_ID: ${plan.id}`);
                
                // Normalize names to ignore (1), casing, and spaces
                const cleanGSummary = normalize(g.summary || "");
                const cleanPlanName = normalize(planName);
                const isSameDayAndName = (gDate === planDate && cleanGSummary === cleanPlanName);
                
                return hasId || isSameDayAndName;
            });

            if (existingGCalEvent) {
                processedGCalIds.add(existingGCalEvent.id);
                if (existingGCalEvent.summary !== planName) {
                    console.log(`📝 Updating GCal title: ${planName}`);
                    await calendar.events.patch({
                        calendarId: CALENDAR_ID,
                        eventId: existingGCalEvent.id,
                        resource: { summary: planName }
                    });
                    await delay(200);
                }
            } else if (planName) {
                console.log(`⬆️  Pushing new entry to GCal: ${planName} (${planDate})`);
                const newEv = await calendar.events.insert({
                    calendarId: CALENDAR_ID,
                    resource: {
                        summary: planName,
                        // FIXED URL PATH HERE:
                        description: `MEALIE_ID: ${plan.id}\n${plan.recipe ? MEALIE_PUBLIC_URL + '/g/home/r/' + plan.recipe.slug : ''}`,
                        start: { date: planDate },
                        end: { date: planDate }
                    }
                });
                processedGCalIds.add(newEv.data.id);
                await delay(200); // 🛑 Prevents ENETUNREACH
            }
        } catch (e) {
            console.error(`⚠️ Error processing Mealie Plan ${plan.id}: ${e.message}`);
        }
    }

    // --- STEP 2: CLEANUP ORPHANS ---
    for (const gEv of gEvents) {
        try {
            if (processedGCalIds.has(gEv.id)) continue;
            const mealieIdMatch = gEv.description?.match(/MEALIE_ID: ([a-z0-9-]+)/);
            if (mealieIdMatch) {
                console.log(`🗑️  Removing orphaned GCal event: ${gEv.summary}`);
                await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: gEv.id });
                await delay(200);
            }
        } catch (e) {
            console.error(`⚠️ Error deleting event ${gEv.id}: ${e.message}`);
        }
    }

    // --- STEP 3: DOWNLOAD (GCal -> Mealie) ---
    for (const gEv of gEvents) {
        try {
            if (processedGCalIds.has(gEv.id)) continue;
            
            const gDate = gEv.start.date || gEv.start.dateTime?.split('T')[0];
            const isFromMealie = gEv.description?.includes("MEALIE_ID:");
            const alreadyInMealie = mealiePlans.find(p => p.date === gDate);

            if (!isFromMealie && !alreadyInMealie) {
                console.log(`⬇️  Partner added: "${gEv.summary}". Importing to Mealie...`);
                
                const desc = gEv.description || "";
                const urlMatch = desc.match(/https?:\/\/[^\s"<>]+/);
                let recipeUrl = urlMatch ? urlMatch[0] : null;

                if (recipeUrl?.includes('google.com/url?q=')) {
                    recipeUrl = new URL(recipeUrl).searchParams.get('q').split('&')[0];
                }

                let payload = { date: gDate, entryType: "dinner" };

                if (recipeUrl) {
                    const libRes = await axios.get(`${MEALIE_URL}/api/recipes?per_page=500`, { headers });
                    const existing = libRes.data.items.find(r => r.recipeSource === recipeUrl);

                    if (existing) {
                        payload.recipeId = existing.id;
                    } else {
                        try {
                            const scrapeRes = await axios.post(`${MEALIE_URL}/api/recipes/create/url`, { url: recipeUrl }, { headers });
                            await delay(2000); 
                            const details = await axios.get(`${MEALIE_URL}/api/recipes/${scrapeRes.data}`, { headers });
                            payload.recipeId = details.data.id;
                        } catch (e) {
                            payload.title = gEv.summary;
                            payload.note = `Source: ${recipeUrl}`;
                        }
                    }
                } else {
                    payload.title = gEv.summary;
                    payload.note = "Added via GCal";
                }

                await axios.post(`${MEALIE_URL}/api/households/mealplans`, payload, { headers });
                await delay(200);
            }
        } catch (e) {
            console.error(`⚠️ Error importing GCal event to Mealie: ${e.message}`);
        }
    }

    console.log("✨ Sync Finished.");
}

syncMaster().catch(console.error)
