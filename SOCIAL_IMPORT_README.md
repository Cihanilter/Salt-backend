# Social Media Recipe Import

This module allows importing recipes from social media platforms (TikTok, Instagram, YouTube, etc.) using yt-dlp and OpenRouter AI.

## How It Works

1. **URL Detection**: The iOS app detects if a URL is from a social media platform
2. **Video Metadata Extraction**: Uses `yt-dlp` to extract video title and description
3. **AI Recipe Parsing**: OpenRouter AI (deepseek-r1t2-chimera:free) parses the content into a structured recipe
4. **Recipe Preview**: User reviews the parsed recipe before saving
5. **Save to Database**: Recipe is saved to Supabase user_recipes table

## Supported Platforms

- TikTok (tiktok.com, vm.tiktok.com)
- Instagram (instagram.com, instagr.am)
- YouTube (youtube.com, youtu.be)
- Facebook (facebook.com, fb.watch)

## Local Development Setup

### Prerequisites

1. **yt-dlp** - Install Python tool for video metadata extraction:
   ```bash
   # Using pip
   pip install yt-dlp

   # Or using Homebrew (macOS)
   brew install yt-dlp
   ```

2. **Node.js** - v18 or later

3. **Environment Variables** - Create `.env` file:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-xxxxx
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your_service_role_key
   ```

### Testing Locally

```bash
# Navigate to backend directory
cd Salt-backend

# Install dependencies
npm install

# Start the server
npm start
```

## Deployment Options

### Option 1: Railway (Recommended)

Railway supports Docker deployments with custom dependencies like yt-dlp:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Option 2: Local/VPS Server

Since yt-dlp requires a Python binary, the easiest deployment is on a VPS:

```bash
# On your server (Ubuntu/Debian)
apt update
apt install python3-pip nodejs npm
pip3 install yt-dlp

# Clone and setup
cd /opt
git clone your-repo
cd Salt-backend
npm install

# Run with PM2
npm install -g pm2
pm2 start "node server.js" --name salt-api
```

### Option 3: Docker Deployment

The included Dockerfile handles all dependencies:

```bash
docker build -t salt-backend .
docker run -p 3001:3001 --env-file .env salt-backend
```

## API Endpoint

### POST /api/import-social-recipe

**Request:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123",
  "saveToDatabase": false
}
```

**Success Response:**
```json
{
  "success": true,
  "isRecipe": true,
  "recipe": {
    "id": -1702134567890,
    "title": "Homemade Pasta",
    "description": "Quick and easy fresh pasta recipe",
    "imageUrl": "https://...",
    "prepTimeMinutes": 20,
    "cookTimeMinutes": 15,
    "totalTimeMinutes": 35,
    "servings": "4",
    "ingredients": ["2 cups flour", "3 eggs", "1 tsp salt"],
    "instructions": ["Mix flour and salt", "Add eggs", "Knead dough"],
    "cuisines": ["Italian"],
    "dishTypes": ["Main Course"],
    "notes": "Let dough rest for 30 minutes",
    "sourceUrl": "https://...",
    "sourceName": "TikTok - @user"
  },
  "videoMetadata": {
    "title": "Original video title",
    "platform": "TikTok",
    "uploader": "username",
    "thumbnail": "https://..."
  },
  "saved": false,
  "savedId": null
}
```

**Not a Recipe Response:**
```json
{
  "success": false,
  "isRecipe": false,
  "reason": "Video appears to be a restaurant review, not a recipe",
  "videoMetadata": {
    "title": "...",
    "platform": "TikTok",
    "uploader": "..."
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to extract video metadata: ..."
}
```

## iOS Integration

The iOS app (`RecipeImportService.swift`) automatically detects social media URLs and routes them to this API:

```swift
// Automatic detection
let recipe = try await RecipeImportService.shared.importRecipe(from: url)

// Supports both:
// - Social media: https://tiktok.com/@user/video/123
// - Regular websites: https://allrecipes.com/recipe/123
```

## OpenRouter AI Configuration

- **Model**: `tngtech/deepseek-r1t2-chimera:free`
- **Temperature**: 0.3 (for consistent parsing)
- **Purpose**: Parse video title/description into structured recipe JSON

The AI handles:
- Recipe name extraction
- Ingredient parsing (with quantities when available)
- Instruction generation (expanded from brief descriptions)
- Time estimation
- Cuisine classification
- Recipe vs non-recipe detection

## Troubleshooting

### yt-dlp fails to extract
```bash
# Update yt-dlp (fixes most issues)
pip install -U yt-dlp

# Or with --no-check-certificate for SSL issues
yt-dlp --no-check-certificate "URL"
```

### Rate limiting
- OpenRouter: Automatic retry with 30s delay
- yt-dlp: Some platforms limit requests; wait before retrying

### Not detecting as recipe
- AI may classify videos as non-recipes if they're reviews, eating videos, etc.
- Check video description for recipe-like content

## Future Improvements

1. **User recipe saves**: Connect to `user_recipes` table
2. **Recipe editing**: Allow users to edit AI-parsed recipes before saving
3. **Better ingredient parsing**: Use NLP for quantity/unit extraction
4. **Video screenshot extraction**: Use video frames as recipe images
5. **Multiple recipes per video**: Handle videos with multiple recipes
