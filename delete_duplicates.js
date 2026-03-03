const axios = require('axios');
const fs = require('fs');

// --- CONFIGURATION ---
const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const tokenMatch = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/);
const MEALIE_TOKEN = tokenMatch ? tokenMatch[1].trim() : null;
const MEALIE_URL = "http://127.0.0.1:9925";
const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

async function deleteDuplicates() {
    console.log("🔍 Fetching library to find duplicates ending in (1)...");
    
    try {
        // Fetch up to 500 recipes to ensure we see the whole library
        const res = await axios.get(`${MEALIE_URL}/api/recipes?per_page=500`, { headers });
        const recipes = res.data.items || [];
        
        // Filter for names that end with "(1)"
        const targets = recipes.filter(r => r.name.trim().endsWith('(1)'));

        if (targets.length === 0) {
            console.log("✅ No recipes found ending in (1). Library is clean!");
            return;
        }

        console.log(`🧨 Found ${targets.length} duplicates. Starting deletion...`);

        for (const recipe of targets) {
            try {
                await axios.delete(`${MEALIE_URL}/api/recipes/${recipe.slug}`, { headers });
                console.log(`🗑️  Deleted: ${recipe.name}`);
            } catch (err) {
                console.error(`❌ Failed to delete ${recipe.name}: ${err.message}`);
            }
        }

        console.log("✨ Cleanup complete.");
    } catch (err) {
        console.error("Error connecting to Mealie:", err.message);
    }
}

deleteDuplicates();