const axios = require('axios');
const fs = require('fs');

const env = fs.readFileSync('/usr/local/bin/common_keys.txt', 'utf8');
const tokenMatch = env.match(/MEALIE_API_KEY=["']?([^"'\s]+)["']?/);
const MEALIE_TOKEN = tokenMatch[1].trim();
const MEALIE_URL = "http://127.0.0.1:9925";

const headers = { 'Authorization': `Bearer ${MEALIE_TOKEN}` };

async function wipeClean() {
    try {
        // 1. CLEAR MEAL PLANS
        let plansRemaining = true;
        while (plansRemaining) {
            console.log("📅 Checking for Meal Plans...");
            const planRes = await axios.get(`${MEALIE_URL}/api/households/mealplans?per_page=100`, { headers });
            const plans = planRes.data.items || planRes.data;

            if (Array.isArray(plans) && plans.length > 0) {
                console.log(`🗑️ Deleting a batch of ${plans.length} meal plan entries...`);
                for (const plan of plans) {
                    await axios.delete(`${MEALIE_URL}/api/households/mealplans/${plan.id}`, { headers });
                }
            } else {
                console.log("✅ All Meal Plans wiped.");
                plansRemaining = false;
            }
        }

        // 2. CLEAR RECIPES
        let recipesRemaining = true;
        while (recipesRemaining) {
            console.log("📖 Checking for Recipes...");
            const recipeRes = await axios.get(`${MEALIE_URL}/api/recipes?per_page=100`, { headers });
            const recipes = recipeRes.data.items || recipeRes.data;

            if (Array.isArray(recipes) && recipes.length > 0) {
                console.log(`🗑️ Deleting a batch of ${recipes.length} recipes...`);
                for (const recipe of recipes) {
                    await axios.delete(`${MEALIE_URL}/api/recipes/${recipe.slug}`, { headers });
                }
            } else {
                console.log("✅ Recipe Library wiped.");
                recipesRemaining = false;
            }
        }

    } catch (err) {
        console.error("❌ Cleanup failed:", err.response?.data || err.message);
    }
}

wipeClean();