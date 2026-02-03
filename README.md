# Salt Recipe API

Backend server for the Salt iOS Recipe Keeper app. Provides recipe processing and social media recipe import functionality.

## Features

- **Social Media Recipe Import**: Extract recipes from TikTok, Instagram, YouTube, and Facebook videos using AI
- **Recipe Processing**: Process and enrich recipes from Spoonacular API with AI-powered time estimates and cuisine classification

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenRouter API (DeepSeek model)
- **Video Extraction**: yt-dlp

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and available endpoints.

### Import Social Recipe
```
POST /api/import-social-recipe
```
Import a recipe from a social media video URL.

**Request Body:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123456",
  "saveToDatabase": false
}
```

**Response:**
```json
{
  "success": true,
  "isRecipe": true,
  "recipe": {
    "title": "Recipe Name",
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["Step 1", "Step 2"],
    "prepTimeMinutes": 15,
    "cookTimeMinutes": 30,
    "servings": "4",
    "cuisines": ["Italian"]
  },
  "videoMetadata": {
    "title": "Video Title",
    "platform": "tiktok",
    "uploader": "username"
  }
}
```

### Process Recipes (Legacy)
```
POST /api/process-recipes
GET /api/process-recipes
```
Process recipes from Spoonacular API with AI enrichment.

## Deployment to Railway

### Prerequisites

1. Railway account ([railway.app](https://railway.app))
2. Railway CLI installed: `npm install -g @railway/cli`

### Deploy Steps

1. **Login to Railway:**
   ```bash
   railway login
   ```

2. **Initialize project:**
   ```bash
   railway init
   ```

3. **Add environment variables:**

   In Railway dashboard, add these variables:
   - `SPOONACULAR_API_KEY` - Your Spoonacular API key
   - `OPENROUTER_API_KEY` - Your OpenRouter API key
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_KEY` - Your Supabase service role key

4. **Deploy:**
   ```bash
   railway up
   ```

Railway will automatically detect the Dockerfile and build the container with all dependencies (Node.js, Python, yt-dlp).

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SPOONACULAR_API_KEY` | API key for Spoonacular recipe data | Yes (for process-recipes) |
| `OPENROUTER_API_KEY` | API key for OpenRouter AI | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `PORT` | Server port (auto-set by Railway) | No |

## Local Development

### Prerequisites

- Node.js 18+
- Python 3 with pip
- yt-dlp (`pip install yt-dlp`)

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd Salt-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create environment file:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

Server will run at `http://localhost:3001`

### Docker (Local)

```bash
# Build
docker build -t salt-backend .

# Run
docker run -p 3001:3001 --env-file .env salt-backend
```

## Project Structure

```
Salt-backend/
├── api/
│   ├── import-social-recipe.js  # Social media recipe import
│   └── process-recipes.js       # Spoonacular recipe processing
├── .env.example                 # Environment variables template
├── .gitignore
├── Dockerfile                   # Docker configuration for Railway
├── package.json
├── railway.json                 # Railway deployment config
├── README.md
├── server.js                    # Express server entry point
└── SOCIAL_IMPORT_README.md      # Detailed social import docs
```

## Security Notes

- Never commit `.env` files to version control
- Use Railway environment variables for production secrets
- The Supabase service key has full database access - keep it secure

## License

Private - Salt Recipe App
