import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    TIMEOUT_MS: 60000,  // 60 second timeout
    MAX_RETRIES: 2,
    AI_MODEL: 'google/gemini-2.0-flash-001'
};

// ============================================================
// Helper: Sleep
// ============================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// STEP 1: Extract video metadata using yt-dlp
// ============================================================

async function extractVideoMetadata(url) {
    try {
        // Use yt-dlp to get video metadata in JSON format
        const { stdout } = await execAsync(
            `yt-dlp --dump-json --no-download --force-ipv4 --no-warnings "${url}"`,
            { timeout: CONFIG.TIMEOUT_MS }
        );

        const metadata = JSON.parse(stdout);

        return {
            title: metadata.title || metadata.fulltitle || '',
            description: metadata.description || '',
            uploader: metadata.uploader || metadata.channel || '',
            uploaderUrl: metadata.uploader_url || metadata.channel_url || '',
            thumbnail: metadata.thumbnail || '',
            duration: metadata.duration || 0,
            platform: metadata.extractor || detectPlatform(url),
            originalUrl: url
        };

    } catch (error) {
        console.error('yt-dlp extraction failed:', error.message);

        // Fallback: try alternative extraction methods
        const platform = detectPlatform(url);

        if (platform === 'tiktok') {
            return await extractTikTokFallback(url);
        }

        throw new Error(`Failed to extract video metadata: ${error.message}`);
    }
}

// ============================================================
// Platform detection
// ============================================================

function detectPlatform(url) {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('tiktok.com') || urlLower.includes('vm.tiktok')) {
        return 'tiktok';
    }
    if (urlLower.includes('instagram.com') || urlLower.includes('instagr.am')) {
        return 'instagram';
    }
    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
        return 'youtube';
    }
    if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) {
        return 'facebook';
    }

    return 'unknown';
}

// ============================================================
// TikTok fallback extraction (if yt-dlp fails)
// ============================================================

async function extractTikTokFallback(url) {
    // TikTok API extraction - basic fallback
    // This is a simplified fallback; production may need a more robust solution
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15'
        },
        timeout: CONFIG.TIMEOUT_MS
    });

    const html = response.data;

    // Try to extract from JSON embedded in page
    const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);

    if (jsonMatch) {
        try {
            const data = JSON.parse(jsonMatch[1]);
            const videoData = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct;

            if (videoData) {
                return {
                    title: videoData.desc || '',
                    description: videoData.desc || '',
                    uploader: videoData.author?.nickname || videoData.author?.uniqueId || '',
                    uploaderUrl: `https://tiktok.com/@${videoData.author?.uniqueId}`,
                    thumbnail: videoData.video?.cover || '',
                    duration: videoData.video?.duration || 0,
                    platform: 'tiktok',
                    originalUrl: url
                };
            }
        } catch (e) {
            console.error('TikTok JSON parse failed:', e.message);
        }
    }

    throw new Error('Could not extract TikTok metadata');
}

// ============================================================
// STEP 2: Parse recipe using AI
// ============================================================

async function parseRecipeWithAI(videoMetadata, openRouterKey, retryCount = 0) {
    const prompt = `You are a professional chef and recipe parser. Extract recipe information from the following video metadata.

VIDEO TITLE: ${videoMetadata.title}

VIDEO DESCRIPTION:
${videoMetadata.description}

CREATOR: ${videoMetadata.uploader}
PLATFORM: ${videoMetadata.platform}

Your task:
1. Extract the recipe name from the title/description
2. Identify all ingredients mentioned (with quantities if available)
3. Extract cooking instructions/steps
4. Estimate prep time and cook time in minutes
5. Determine servings if mentioned
6. Classify the cuisine type from this list: African, American, British, Cajun, Caribbean, Chinese, Eastern European, European, French, German, Greek, Indian, Irish, Italian, Japanese, Jewish, Korean, Latin American, Mediterranean, Mexican, Middle Eastern, Nordic, Southern, Spanish, Thai, Ukrainian, Vietnamese
7. Classify dish types from: Appetizers, Beverages, Breakfast, Brunch, Desserts, Dinner, Finger Food, Lunch, Main Course, Main Dish, Salads, Side Dish, Snacks, Soups, Starter

If the video is NOT a recipe (e.g., just an eating video, review, or unrelated content), return:
{"isRecipe": false, "reason": "explanation"}

If it IS a recipe, return a JSON object with this EXACT structure:
{
    "isRecipe": true,
    "title": "Recipe Name",
    "description": "Brief description of the dish",
    "ingredients": ["ingredient 1 with quantity", "ingredient 2 with quantity"],
    "instructions": ["Step 1 instruction", "Step 2 instruction"],
    "prepTimeMinutes": <number>,
    "cookTimeMinutes": <number>,
    "totalTimeMinutes": <number>,
    "servings": "<number as string, e.g. '4'>",
    "cuisines": ["cuisine1"],
    "dishTypes": ["dish type1"],
    "notes": "Any tips or variations mentioned"
}

IMPORTANT:
- Return ONLY valid JSON, no markdown or additional text
- If ingredients or instructions are unclear, do your best to infer from context
- Set reasonable time estimates based on the recipe type
- For social media recipes, instructions are often brief - expand them into clear steps
- SERVINGS IS REQUIRED: If servings are not mentioned, estimate based on recipe type (default to "2" for small recipes, "4" for typical meals)`;

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: CONFIG.AI_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3  // Lower temperature for more consistent parsing
            },
            {
                headers: {
                    'Authorization': `Bearer ${openRouterKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://salt-app.vercel.app',
                    'X-Title': 'Salt Social Recipe Importer'
                },
                timeout: CONFIG.TIMEOUT_MS
            }
        );

        const aiResponseText = response.data.choices[0].message.content;

        // Clean response from markdown code blocks
        const cleanedResponse = aiResponseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .replace(/<think>[\s\S]*?<\/think>/g, '')  // Remove thinking tags
            .trim();

        // Find JSON object in response
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
        }

        const aiData = JSON.parse(jsonMatch[0]);

        console.log('🤖 AI Recipe Parse Result:', JSON.stringify(aiData, null, 2));

        return aiData;

    } catch (error) {
        if (error.response?.status === 429 && retryCount < CONFIG.MAX_RETRIES) {
            console.log('⏳ Rate limited, waiting 30s before retry...');
            await sleep(30000);
            return parseRecipeWithAI(videoMetadata, openRouterKey, retryCount + 1);
        }

        throw new Error(`AI parsing failed: ${error.message}`);
    }
}

// ============================================================
// STEP 3: Format recipe for database
// ============================================================

function formatRecipeForDatabase(parsedRecipe, videoMetadata) {
    // Generate a unique ID for imported recipes (negative to avoid Spoonacular ID conflicts)
    const uniqueId = -Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 1000);

    // Format ingredients as array of objects (matching existing schema)
    const ingredients = (parsedRecipe.ingredients || []).map((ing, index) => ({
        id: index + 1,
        name: ing,
        nameClean: ing.toLowerCase(),
        amount: null,
        unit: null,
        original: ing,
        image: null,
        measures: null
    }));

    // Format instructions as array of objects
    const instructions = (parsedRecipe.instructions || []).map((step, index) => ({
        number: index + 1,
        instruction: step,
        ingredients: [],
        equipment: [],
        lengthMinutes: null
    }));

    return {
        id: uniqueId,
        title: parsedRecipe.title,
        description: parsedRecipe.description || `Recipe imported from ${videoMetadata.platform}`,
        image_url: videoMetadata.thumbnail || null,
        source_url: videoMetadata.originalUrl,
        source_name: `${videoMetadata.platform} - ${videoMetadata.uploader}`,
        total_time_minutes: parsedRecipe.totalTimeMinutes ||
            (parsedRecipe.prepTimeMinutes || 0) + (parsedRecipe.cookTimeMinutes || 0),
        prep_time_minutes: parsedRecipe.prepTimeMinutes || null,
        cook_time_minutes: parsedRecipe.cookTimeMinutes || null,
        servings: parseInt(parsedRecipe.servings) || 2,  // Default to 2 if not provided
        servings_text: parsedRecipe.servings || "2",
        vegetarian: false,
        vegan: false,
        gluten_free: false,
        dairy_free: false,
        very_healthy: false,
        cheap: false,
        sustainable: false,
        health_score: null,
        price_per_serving: null,
        cuisines: parsedRecipe.cuisines || [],
        dish_types: parsedRecipe.dishTypes || [],
        diets: [],
        occasions: [],
        ingredients: ingredients,
        ingredient_count: ingredients.length,
        instructions: instructions,
        notes: parsedRecipe.notes || '',
        ai_confidence: 'medium',
        ai_reasoning: `Imported from ${videoMetadata.platform} video: "${videoMetadata.title}"`
    };
}

// ============================================================
// STEP 4: Save to Supabase
// ============================================================

async function saveRecipeToSupabase(supabase, recipe) {
    const { data, error } = await supabase
        .from('recipes')
        .upsert(recipe, { onConflict: 'id' })
        .select()
        .single();

    if (error) throw error;

    return data;
}

// ============================================================
// VERCEL SERVERLESS HANDLER
// ============================================================

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, saveToDatabase = false } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log('🚀 Starting social recipe import for:', url);

    try {
        // Step 1: Extract video metadata
        console.log('📥 Extracting video metadata...');
        const videoMetadata = await extractVideoMetadata(url);
        console.log('✅ Video metadata extracted:', videoMetadata.title);

        // Step 2: Parse recipe with AI
        console.log('🤖 Parsing recipe with AI...');
        const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

        if (!openRouterKey) {
            return res.status(500).json({ error: 'OpenRouter API key not configured' });
        }

        const parsedRecipe = await parseRecipeWithAI(videoMetadata, openRouterKey);

        // Check if it's actually a recipe
        if (!parsedRecipe.isRecipe) {
            return res.status(200).json({
                success: false,
                isRecipe: false,
                reason: parsedRecipe.reason || 'Video does not appear to contain a recipe',
                videoMetadata: {
                    title: videoMetadata.title,
                    platform: videoMetadata.platform,
                    uploader: videoMetadata.uploader
                }
            });
        }

        // Step 3: Format for database
        console.log('📝 Formatting recipe data...');
        const formattedRecipe = formatRecipeForDatabase(parsedRecipe, videoMetadata);

        // Step 4: Optionally save to database
        let savedRecipe = null;
        if (saveToDatabase) {
            console.log('💾 Saving to database...');
            const supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY
            );
            savedRecipe = await saveRecipeToSupabase(supabase, formattedRecipe);
            console.log('✅ Recipe saved with ID:', savedRecipe.id);
        }

        // Return result
        return res.status(200).json({
            success: true,
            isRecipe: true,
            recipe: {
                id: formattedRecipe.id,
                title: formattedRecipe.title,
                description: formattedRecipe.description,
                imageUrl: formattedRecipe.image_url,
                prepTimeMinutes: formattedRecipe.prep_time_minutes,
                cookTimeMinutes: formattedRecipe.cook_time_minutes,
                totalTimeMinutes: formattedRecipe.total_time_minutes,
                servings: formattedRecipe.servings_text,
                ingredients: parsedRecipe.ingredients,
                instructions: parsedRecipe.instructions,
                cuisines: formattedRecipe.cuisines,
                dishTypes: formattedRecipe.dish_types,
                notes: formattedRecipe.notes,
                sourceUrl: formattedRecipe.source_url,
                sourceName: formattedRecipe.source_name
            },
            videoMetadata: {
                title: videoMetadata.title,
                platform: videoMetadata.platform,
                uploader: videoMetadata.uploader,
                thumbnail: videoMetadata.thumbnail
            },
            saved: saveToDatabase,
            savedId: savedRecipe?.id || null
        });

    } catch (error) {
        console.error('❌ Import failed:', error);

        // User-friendly error messages
        let userMessage = 'Failed to import recipe. Please try again.';

        if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
            userMessage = 'Service temporarily unavailable. Please try again later.';
        } else if (error.message?.includes('429') || error.message?.includes('rate limit')) {
            userMessage = 'Too many requests. Please wait a moment and try again.';
        } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
            userMessage = 'Request timed out. Please check your connection and try again.';
        } else if (error.message?.includes('yt-dlp') || error.message?.includes('extract')) {
            userMessage = 'Could not access this video. Please check the URL and try again.';
        } else if (error.message?.includes('not a recipe') || error.message?.includes('isRecipe')) {
            userMessage = 'This video does not appear to contain a recipe.';
        } else if (error.message?.includes('network') || error.message?.includes('ENOTFOUND')) {
            userMessage = 'Network error. Please check your connection.';
        }

        return res.status(500).json({
            success: false,
            error: userMessage
        });
    }
}
