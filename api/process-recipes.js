import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    DELAY_BETWEEN_RECIPES_MS: 5000,  // 5 seconds
    MAX_RECIPES_PER_RUN: 25,         // 50 API calls / 2 = 25 recipes
    MAX_RETRIES: 2,
    TIMEOUT_MS: 30000,
};

// ============================================================
// Helper: Sleep
// ============================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// STEP 1: Fetch recipe from Spoonacular
// ============================================================

async function fetchRecipeData(recipeId, apiKey, retryCount = 0) {
    try {
        const [infoResponse, instructionsResponse] = await Promise.all([
            axios.get(
                `https://api.spoonacular.com/recipes/${recipeId}/information`,
                {
                    params: { apiKey },
                    timeout: CONFIG.TIMEOUT_MS
                }
            ),
            axios.get(
                `https://api.spoonacular.com/recipes/${recipeId}/analyzedInstructions`,
                {
                    params: { apiKey },
                    timeout: CONFIG.TIMEOUT_MS
                }
            )
        ]);

        return {
            info: infoResponse.data,
            instructions: instructionsResponse.data
        };

    } catch (error) {
        if (error.response?.status === 404) {
            return null;  // Recipe doesn't exist
        }

        if (error.response?.status === 429 && retryCount < CONFIG.MAX_RETRIES) {
            await sleep(60000);  // Wait 1 minute
            return fetchRecipeData(recipeId, apiKey, retryCount + 1);
        }

        throw error;
    }
}

// ============================================================
// HELPER: Guess cuisine from recipe title (fallback)
// ============================================================

function guessCuisineFromTitle(title) {
    const titleLower = title.toLowerCase();
    const cuisineKeywords = {
        'Italian': ['pasta', 'pizza', 'lasagna', 'risotto', 'carbonara', 'pesto', 'parmesan', 'mozzarella', 'tiramisu'],
        'Mexican': ['taco', 'burrito', 'quesadilla', 'enchilada', 'salsa', 'guacamole', 'tortilla', 'fajita'],
        'Chinese': ['stir fry', 'wonton', 'dumpling', 'fried rice', 'chow mein', 'szechuan', 'kung pao'],
        'Indian': ['curry', 'tandoori', 'masala', 'biryani', 'naan', 'samosa', 'tikka'],
        'Japanese': ['sushi', 'ramen', 'tempura', 'teriyaki', 'miso', 'udon', 'sashimi'],
        'Thai': ['pad thai', 'green curry', 'red curry', 'tom yum', 'massaman'],
        'French': ['croissant', 'baguette', 'quiche', 'crepe', 'soufflé', 'ratatouille'],
        'Greek': ['gyro', 'souvlaki', 'moussaka', 'tzatziki', 'feta', 'baklava'],
        'Korean': ['kimchi', 'bibimbap', 'bulgogi', 'korean bbq'],
        'American': ['burger', 'hot dog', 'bbq', 'mac and cheese', 'fried chicken'],
        'Mediterranean': ['hummus', 'falafel', 'couscous', 'kebab'],
        'Spanish': ['paella', 'tapas', 'gazpacho', 'churro']
    };

    for (const [cuisine, keywords] of Object.entries(cuisineKeywords)) {
        for (const keyword of keywords) {
            if (titleLower.includes(keyword)) {
                return [cuisine];
            }
        }
    }

    return ['American'];  // Default fallback
}

// ============================================================
// STEP 2: Estimate times with AI
// ============================================================

async function estimateTimesWithAI(recipeInfo, openRouterKey, retryCount = 0) {
    const prompt = `You are a professional chef assistant. Analyze the following recipe and provide time estimates and cuisine classification.

Recipe: ${recipeInfo.title}
Total Time: ${recipeInfo.readyInMinutes} minutes
Ingredients: ${recipeInfo.extendedIngredients?.map(ing => ing.name).join(', ') || 'N/A'}

Instructions:
${recipeInfo.instructions}

Important rules:
1. Prep time = chopping, mixing, marinating, assembling (active work before heat)
2. Cook time = boiling, baking, simmering, frying (actual cooking)
3. Prep + Cook should approximately equal Total Time (${recipeInfo.readyInMinutes} mins)
4. Classify the cuisine(s) based on recipe title, ingredients, and cooking methods
5. Select 1-3 most relevant cuisines from this EXACT list (use exact spelling):
   African, American, British, Cajun, Caribbean, Chinese, Eastern European, European, French, German, Greek, Indian, Irish, Italian, Japanese, Jewish, Korean, Latin American, Mediterranean, Mexican, Middle Eastern, Nordic, Southern, Spanish, Thai, Vietnamese
6. Return ONLY a valid JSON object, no additional text or markdown

Return format:
{
  "prepTimeMinutes": <number>,
  "cookTimeMinutes": <number>,
  "cuisines": ["<cuisine1>", "<cuisine2>"],
  "reasoning": "<brief 1-sentence explanation for time and cuisine>"
}`;

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'tngtech/deepseek-r1t2-chimera:free',
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': `Bearer ${openRouterKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://salt-app.vercel.app',
                    'X-Title': 'Salt Recipe Processor'
                },
                timeout: CONFIG.TIMEOUT_MS
            }
        );

        const aiResponseText = response.data.choices[0].message.content;
        const cleanedResponse = aiResponseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const aiData = JSON.parse(cleanedResponse);

        console.log('🤖 AI Response:', JSON.stringify(aiData, null, 2));

        if (!aiData.prepTimeMinutes || !aiData.cookTimeMinutes) {
            throw new Error('AI response missing required fields');
        }

        if (!aiData.cuisines || aiData.cuisines.length === 0) {
            console.warn('⚠️ AI returned empty cuisines array for recipe:', recipeInfo.title);
        }

        const totalEstimate = aiData.prepTimeMinutes + aiData.cookTimeMinutes;
        const actualTotal = recipeInfo.readyInMinutes || totalEstimate;
        const diff = Math.abs(totalEstimate - actualTotal);
        const diffPercent = actualTotal > 0 ? (diff / actualTotal) * 100 : 0;

        const confidence = diffPercent <= 10 ? 'high' : diffPercent <= 25 ? 'medium' : 'low';

        // Fallback: guess cuisines from recipe title if AI returned empty
        let cuisines = Array.isArray(aiData.cuisines) && aiData.cuisines.length > 0
            ? aiData.cuisines
            : guessCuisineFromTitle(recipeInfo.title);

        if (cuisines.length === 0) {
            console.warn('⚠️ Could not determine cuisine for:', recipeInfo.title);
        }

        return {
            prepTimeMinutes: aiData.prepTimeMinutes,
            cookTimeMinutes: aiData.cookTimeMinutes,
            cuisines: cuisines,
            reasoning: aiData.reasoning,
            confidence: confidence
        };

    } catch (error) {
        if (error.response?.status === 429 && retryCount < CONFIG.MAX_RETRIES) {
            await sleep(30000);
            return estimateTimesWithAI(recipeInfo, openRouterKey, retryCount + 1);
        }

        // Fallback
        const totalTime = recipeInfo.readyInMinutes || 30;
        return {
            prepTimeMinutes: Math.round(totalTime * 0.25),
            cookTimeMinutes: Math.round(totalTime * 0.75),
            cuisines: [],
            reasoning: 'Fallback heuristic (AI failed)',
            confidence: 'low'
        };
    }
}

// ============================================================
// STEP 3: Save to Supabase
// ============================================================

// Helper: Upgrade Spoonacular image URLs to highest quality
function upgradeImageQuality(imageUrl) {
    if (!imageUrl) return imageUrl;

    // Spoonacular image URL patterns:
    // https://spoonacular.com/recipeImages/641-312x231.jpg
    // Replace with largest available size: 636x393
    return imageUrl
        .replace(/-90x90\./, '-636x393.')
        .replace(/-240x150\./, '-636x393.')
        .replace(/-312x150\./, '-636x393.')
        .replace(/-312x231\./, '-636x393.')
        .replace(/-480x360\./, '-636x393.')
        .replace(/-556x370\./, '-636x393.');
}

async function saveRecipeToSupabase(supabase, recipeInfo, analyzedInstructions, aiEstimate) {
    const extractDescription = (htmlSummary) => {
        if (!htmlSummary) return '';
        const text = htmlSummary
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        const sentences = text.split('. ').slice(0, 2);
        return sentences.join('. ') + (sentences.length > 0 ? '.' : '');
    };

    const ingredients = recipeInfo.extendedIngredients.map(ing => ({
        id: ing.id,
        name: ing.name,
        nameClean: ing.nameClean || ing.name,
        amount: ing.amount,
        unit: ing.unit,
        original: ing.original,
        image: ing.image,
        measures: ing.measures ? {
            us: { amount: ing.measures.us.amount, unit: ing.measures.us.unitShort },
            metric: { amount: ing.measures.metric.amount, unit: ing.measures.metric.unitShort }
        } : null
    }));

    const instructions = analyzedInstructions && analyzedInstructions.length > 0
        ? analyzedInstructions[0].steps.map(step => ({
            number: step.number,
            instruction: step.step,
            ingredients: step.ingredients.map(ing => ({ id: ing.id, name: ing.name, image: ing.image })),
            equipment: step.equipment.map(eq => ({ id: eq.id, name: eq.name, image: eq.image })),
            lengthMinutes: step.length?.number || null
        }))
        : [];

    const recipe = {
        id: recipeInfo.id,
        title: recipeInfo.title,
        description: extractDescription(recipeInfo.summary),
        image_url: recipeInfo.image,
        source_url: recipeInfo.sourceUrl,
        source_name: recipeInfo.sourceName,
        total_time_minutes: recipeInfo.readyInMinutes,
        prep_time_minutes: aiEstimate.prepTimeMinutes,
        cook_time_minutes: aiEstimate.cookTimeMinutes,
        servings: recipeInfo.servings,
        vegetarian: recipeInfo.vegetarian || false,
        vegan: recipeInfo.vegan || false,
        gluten_free: recipeInfo.glutenFree || false,
        dairy_free: recipeInfo.dairyFree || false,
        very_healthy: recipeInfo.veryHealthy || false,
        cheap: recipeInfo.cheap || false,
        sustainable: recipeInfo.sustainable || false,
        health_score: recipeInfo.healthScore || null,
        price_per_serving: recipeInfo.pricePerServing || null,
        cuisines: aiEstimate.cuisines || [],
        dish_types: recipeInfo.dishTypes || [],
        diets: recipeInfo.diets || [],
        occasions: recipeInfo.occasions || [],
        ingredients: ingredients,
        ingredient_count: ingredients.length,
        instructions: instructions,
        notes: '',
        ai_confidence: aiEstimate.confidence,
        ai_reasoning: aiEstimate.reasoning
    };

    const { error } = await supabase
        .from('recipes')
        .upsert(recipe, { onConflict: 'id' });

    if (error) throw error;
}

// ============================================================
// STEP 4: Log activity
// ============================================================

async function logActivity(supabase, recipeId, status, errorMessage = null, processingTime = 0) {
    await supabase.from('parsing_log').insert({
        recipe_id: recipeId,
        status: status,
        error_message: errorMessage,
        api_calls_used: status === 'skipped' ? 2 : (status === 'success' ? 3 : 2),
        processing_time_ms: processingTime
    });
}

// ============================================================
// STEP 5: Update state
// ============================================================

async function updateState(supabase, recipeId, status, apiCalls = 2) {
    await supabase.rpc('update_parsing_state', {
        p_recipe_id: recipeId,
        p_status: status,
        p_api_calls: apiCalls
    });
}

// ============================================================
// MAIN: Process single recipe
// ============================================================

async function processRecipe(recipeId, apiKeys, supabase) {
    const startTime = Date.now();

    try {
        const recipeData = await fetchRecipeData(recipeId, apiKeys.spoonacular);

        if (!recipeData) {
            await logActivity(supabase, recipeId, 'skipped', 'Recipe not found (404)', Date.now() - startTime);
            await updateState(supabase, recipeId, 'skipped', 2);
            return { status: 'skipped', recipeId };
        }

        // Skip recipes with no instructions
        if (!recipeData.instructions || recipeData.instructions.length === 0 ||
            (recipeData.instructions[0] && recipeData.instructions[0].steps.length === 0)) {
            await logActivity(supabase, recipeId, 'skipped', 'No instructions available', Date.now() - startTime);
            await updateState(supabase, recipeId, 'skipped', 2);
            return { status: 'skipped', recipeId, reason: 'no_instructions' };
        }

        const aiEstimate = await estimateTimesWithAI(recipeData.info, apiKeys.openRouter);
        await saveRecipeToSupabase(supabase, recipeData.info, recipeData.instructions, aiEstimate);

        const processingTime = Date.now() - startTime;
        await logActivity(supabase, recipeId, 'success', null, processingTime);
        await updateState(supabase, recipeId, 'success', 3);

        return { status: 'success', recipeId, title: recipeData.info.title };

    } catch (error) {
        const processingTime = Date.now() - startTime;
        await logActivity(supabase, recipeId, 'failed', error.message, processingTime);
        await updateState(supabase, recipeId, 'failed', 2);

        return { status: 'failed', recipeId, error: error.message };
    }
}

// ============================================================
// VERCEL SERVERLESS HANDLER
// ============================================================

export default async function handler(req, res) {
    // Security: Verify cron secret (optional but recommended)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers['x-vercel-cron-secret'] !== cronSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🚀 Starting recipe processing...');

    try {
        // Initialize clients
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const apiKeys = {
            spoonacular: process.env.SPOONACULAR_API_KEY,
            openRouter: process.env.OPENROUTER_API_KEY
        };

        // Reset daily quota if new day (before checking quota!)
        const today = new Date().toISOString().split('T')[0];
        const { data: currentState } = await supabase
            .from('parsing_state')
            .select('last_quota_reset_date')
            .eq('id', 1)
            .single();

        if (currentState && currentState.last_quota_reset_date < today) {
            console.log('🔄 New day detected! Resetting quota from', currentState.last_quota_reset_date, 'to', today);
            await supabase
                .from('parsing_state')
                .update({
                    daily_api_calls: 0,
                    last_quota_reset_date: today
                })
                .eq('id', 1);
            console.log('✅ Quota reset to 50 for new day');
        } else {
            console.log('ℹ️ Same day, quota not reset. Last reset:', currentState?.last_quota_reset_date);
        }

        // Get current state
        const { data: stats } = await supabase.rpc('get_parsing_stats');
        const state = stats[0];

        console.log('📊 Current state:', {
            lastId: state.last_processed_id,
            quotaRemaining: state.daily_quota_remaining
        });

        // Check quota
        const recipesCanProcess = Math.floor(state.daily_quota_remaining / 3);

        if (recipesCanProcess <= 0) {
            return res.status(200).json({
                success: true,
                message: 'Daily quota exhausted',
                processed: 0,
                successful: 0,
                failed: 0,
                skipped: 0,
                recipes: [],
                state: {
                    lastProcessedId: state.last_processed_id,
                    quotaRemaining: state.daily_quota_remaining
                }
            });
        }

        const recipesToProcess = Math.min(recipesCanProcess, CONFIG.MAX_RECIPES_PER_RUN);

        // Process recipes
        const results = [];
        let currentId = state.last_processed_id + 1;

        for (let i = 0; i < recipesToProcess; i++) {
            console.log(`Processing recipe ${currentId}...`);

            const result = await processRecipe(currentId, apiKeys, supabase);
            results.push(result);

            currentId++;

            if (i < recipesToProcess - 1) {
                await sleep(CONFIG.DELAY_BETWEEN_RECIPES_MS);
            }
        }

        // Summary
        const successful = results.filter(r => r.status === 'success').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const skipped = results.filter(r => r.status === 'skipped').length;

        // Get final state
        const { data: finalStats } = await supabase.rpc('get_parsing_stats');
        const finalState = finalStats[0];

        console.log('✅ Processing complete:', { successful, failed, skipped });

        return res.status(200).json({
            success: true,
            processed: results.length,
            successful,
            failed,
            skipped,
            recipes: results.filter(r => r.status === 'success').map(r => ({
                id: r.recipeId,
                title: r.title
            })),
            state: {
                lastProcessedId: finalState.last_processed_id,
                quotaRemaining: finalState.daily_quota_remaining
            }
        });

    } catch (error) {
        console.error('❌ Processing failed:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
