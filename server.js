/**
 * Local development server for Salt Recipe API
 *
 * Usage:
 *   node server.js
 *
 * Endpoints:
 *   POST /api/import-social-recipe - Import recipe from social media
 *   POST /api/process-recipes - Process recipes from Spoonacular (legacy)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import handlers
import importSocialRecipeHandler from './api/import-social-recipe.js';
import processRecipesHandler from './api/process-recipes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Wrap Vercel handler for Express
function wrapHandler(handler) {
    return async (req, res) => {
        // Add setHeader method compatibility
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
            originalSetHeader(name, value);
            return res;
        };

        try {
            await handler(req, res);
        } catch (error) {
            console.error('Handler error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    };
}

// Routes
app.post('/api/import-social-recipe', wrapHandler(importSocialRecipeHandler));
app.get('/api/import-social-recipe', (req, res) => {
    res.json({
        endpoint: '/api/import-social-recipe',
        method: 'POST',
        body: {
            url: 'string (required) - TikTok, Instagram, YouTube, or other video URL',
            saveToDatabase: 'boolean (optional) - Whether to save the recipe to Supabase'
        }
    });
});

app.post('/api/process-recipes', wrapHandler(processRecipesHandler));
app.get('/api/process-recipes', wrapHandler(processRecipesHandler));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        endpoints: [
            'POST /api/import-social-recipe',
            'POST /api/process-recipes'
        ]
    });
});

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'Salt Recipe API',
        version: '1.0.0',
        endpoints: {
            '/api/import-social-recipe': 'Import recipes from social media (TikTok, YouTube, etc.)',
            '/api/process-recipes': 'Process recipes from Spoonacular (legacy)',
            '/health': 'Health check'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log('═'.repeat(60));
    console.log('🍳 Salt Recipe API Server');
    console.log('═'.repeat(60));
    console.log(`🌐 Server running at http://localhost:${PORT}`);
    console.log('');
    console.log('📍 Endpoints:');
    console.log(`   POST http://localhost:${PORT}/api/import-social-recipe`);
    console.log(`   POST http://localhost:${PORT}/api/process-recipes`);
    console.log(`   GET  http://localhost:${PORT}/health`);
    console.log('');
    console.log('🔑 Environment:');
    console.log(`   OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
    console.log(`   SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log('═'.repeat(60));
});
