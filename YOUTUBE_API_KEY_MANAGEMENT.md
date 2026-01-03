# YouTube API Key Management

## Current API Key

**Status:** ✅ Active and Working  
**Key:** `AIzaSyDHwTm9Fw80vVfpaZwuzBAUJF4ZNfi-SDk`  
**Location:** `youtube-api.js` (line 4)  
**Type:** Demo Key (public)  
**Quota:** 10,000 units/day  

## API Key Options

### Option 1: Use Existing Demo Key (Current)
**Pros:**
- ✅ Already working
- ✅ Quick to test
- ✅ No setup required

**Cons:**
- ❌ Shared quota (may be limited by other users)
- ❌ Not suitable for production
- ❌ No custom rate limits

**Best for:** Testing, development, internal use

---

### Option 2: Create Your Own Google Cloud API Key

#### Step-by-Step Instructions:

**1. Go to Google Cloud Console**
```
https://console.cloud.google.com/
```

**2. Create a New Project**
- Click "Select a Project" dropdown
- Click "New Project"
- Project name: `sdkaraoke`
- Click "Create"
- Wait for project to initialize

**3. Enable YouTube Data API v3**
- In search bar at top, search: "YouTube Data API v3"
- Click the result
- Click "Enable"
- Wait for activation

**4. Create API Key**
- Click on "Credentials" in left menu
- Click "Create Credentials" dropdown
- Select "API Key"
- Copy your new key
- Your key will look like: `AIzaSy...`

**5. (Optional) Restrict API Key**
For better security:
- Click on the newly created key
- Under "Application restrictions" → Select "HTTP referrers (web sites)"
- Add your domain: `https://sdkaraoke.vercel.app`
- Save

**6. Update Your Code**
- Open `youtube-api.js`
- Find line 4: `API_KEY: 'AIzaSy...'`
- Replace with your new key
- Save file

**7. Deploy**
```bash
git add youtube-api.js
git commit -m "Update YouTube API key"
vercel --prod
```

---

### Option 3: Use Environment Variables (Recommended for Production)

**Benefits:**
- ✅ Secure (key not in source code)
- ✅ Different keys per environment
- ✅ Easy to rotate keys
- ✅ Production-ready

#### Setup with Vercel:

**1. In Vercel Dashboard:**
- Go to Project Settings → Environment Variables
- Add new variable: `YOUTUBE_API_KEY`
- Value: `AIzaSy...`
- Apply to: Production, Preview, Development

**2. Update youtube-api.js:**
```javascript
// Get API key from environment or use fallback
const YOUTUBE_CONFIG = {
    API_KEY: process.env.YOUTUBE_API_KEY || 'AIzaSyDHwTm9Fw80vVfpaZwuzBAUJF4ZNfi-SDk'
};
```

**3. Deploy:**
```bash
git add youtube-api.js
git commit -m "Use environment variables for API key"
vercel --prod
```

---

### Option 4: Use Backend API (Most Secure)

Create a backend server to handle YouTube API calls:

#### Example Backend (Node.js + Express):

**backend/server.js:**
```javascript
const express = require('express');
const fetch = require('node-fetch');
const app = express();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.append('key', YOUTUBE_API_KEY);
    url.searchParams.append('q', `${query} karaoke`);
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('maxResults', '15');
    url.searchParams.append('type', 'video');
    
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data.items.map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium.url
    })));
});

app.listen(3001);
```

**Frontend (singer.js):**
```javascript
async function performSearch(query) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    return response.json();
}
```

**Deploy:** Use Vercel Functions or Heroku, Railway, etc.

---

## Monitoring API Usage

### Check Your Quota

**In Google Cloud Console:**
1. Go to project dashboard
2. Click "Quotas" or "Metrics"
3. View "YouTube Data API v3"
4. Check daily usage graph

### Set Up Alerts

**1. Enable Billing (if not already)**
- Upgrade to paid account (if needed)
- No charges for free tier quota

**2. Create Alert Policy**
- Google Cloud Console → Monitoring → Alerting
- Create policy for "API calls"
- Set threshold (e.g., 8,000 units/day)
- Add email notification

### Optimize Usage

**Reduce API Calls:**
```javascript
// Cache results
const songCache = {};

async function searchWithCache(query) {
    if (songCache[query]) {
        return songCache[query];
    }
    const results = await searchYouTubeKaraoke(query);
    songCache[query] = results;
    return results;
}
```

**Use Batch Operations:**
```javascript
// Get multiple video details in one request
async function getMultipleVideoDetails(videoIds) {
    const url = 'https://www.googleapis.com/youtube/v3/videos';
    // Get details for up to 50 videos with 1 API call
}
```

---

## API Key Security Checklist

- [ ] API key created in Google Cloud
- [ ] YouTube Data API v3 enabled
- [ ] API key restrictions applied (if using public)
- [ ] Key rotated regularly
- [ ] Usage monitored and logged
- [ ] Key never committed to public repos
- [ ] Environment variables configured
- [ ] Backend proxy implemented (if production)
- [ ] Rate limiting added (if production)
- [ ] Error handling for quota exceeded

---

## Comparison Table

| Feature | Demo Key | Personal Key | Env Variable | Backend |
|---------|----------|--------------|--------------|---------|
| Setup Time | Instant | 5-10 min | 10 min | 30+ min |
| Cost | Free | Free | Free | Free |
| Quota | Shared | Dedicated | Dedicated | Dedicated |
| Security | Low | Medium | High | Very High |
| Production Ready | ❌ | ⚠️ | ✅ | ✅ |
| Scalability | ❌ | ⚠️ | ✅ | ✅ |
| Recommended For | Testing | Small projects | Production | Enterprise |

---

## Troubleshooting

### "API Quota Exceeded"
- Wait until quota resets (daily at midnight PT)
- Create personal API key with higher limits
- Implement caching to reduce calls
- Use backend proxy to batch requests

### "Invalid API Key"
- Check key is copied correctly
- Verify YouTube Data API v3 is enabled
- Check key hasn't expired
- Check firewall/proxy isn't blocking requests

### "Video Not Found" (Error 100)
- Video may be private or deleted
- Try different search terms
- Check video is publicly available

### "403 Forbidden"
- API key may be restricted to wrong domain
- Check domain restrictions in Google Cloud
- Try removing domain restrictions temporarily
- Whitelist your Vercel domain

---

## Best Practices

### For Development
```javascript
// Use environment variable with fallback
const API_KEY = process.env.YOUTUBE_API_KEY || 'demo-key-for-testing';
```

### For Production
```javascript
// Use backend only, never expose key
// Frontend calls /api/search
// Backend handles YouTube API
```

### For Caching
```javascript
// Cache popular searches
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function searchYouTubeWithCache(query) {
    const cached = cache.get(query);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }
    
    const data = await searchYouTubeKaraoke(query);
    cache.set(query, { data, time: Date.now() });
    return data;
}
```

---

## Summary

**Current Status:** ✅ Using demo key (working)

**Recommended Next Steps:**
1. Short-term: Test with current key
2. Mid-term: Create personal API key
3. Long-term: Implement backend proxy for production

The YouTube API is operational and ready to use! 🎬
