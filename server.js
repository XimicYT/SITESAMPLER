const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the index.html file
app.use(express.static(path.join(__dirname)));

// Global state variables so the frontend can check progress
let isCrawling = false;
let successfulSites = 0;
let crawlLogs = [];
let finalDictionary = null;

// The Seed URLs: The spider starts here and branches out
const seedUrls = [
    "https://news.ycombinator.com/",
    "https://www.reddit.com",
    "https://github.com",
    "https://dev.to",
    "https://en.wikipedia.org/wiki/Main_Page"
];

async function startSpider(targetCount = 150) {
    isCrawling = true;
    successfulSites = 0;
    crawlLogs = ["Initializing spider..."];
    finalDictionary = null;

    const queue = [...seedUrls];
    const visitedDomains = new Set();
    const tagData = {};

    // Keep crawling until we hit our target OR run out of links
    while (queue.length > 0 && successfulSites < targetCount) {
        const currentUrl = queue.shift();
        
        let urlObj;
        try {
            urlObj = new URL(currentUrl);
        } catch (e) { continue; } // Skip malformed URLs

        const domain = urlObj.hostname;
        
        // Ensure we only visit ONE page per domain to maximize diversity
        if (visitedDomains.has(domain)) continue;
        visitedDomains.add(domain);

        try {
            // 5-second timeout so the spider doesn't get stuck on slow servers
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(currentUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            const htmlText = await response.text();

            // 1. SPIDER LOGIC: Find new links to add to the queue
            const linkMatches = htmlText.match(/href="https?:\/\/[^"]+"/g) || [];
            linkMatches.forEach(link => {
                const cleanLink = link.replace('href="', '').replace('"', '');
                queue.push(cleanLink);
            });

            // 2. DICTIONARY LOGIC: Extract and count HTML tags
            const tagMatches = htmlText.match(/<[^>]+>/g) || [];
            const seenOnThisSite = new Set();

            tagMatches.forEach(tag => {
                const cleanTag = tag.toLowerCase();
                if (!tagData[cleanTag]) {
                    tagData[cleanTag] = { totalCount: 0, sitesAppearedOn: 0 };
                }
                tagData[cleanTag].totalCount += 1;
                
                // Cross-pollination tracking
                if (!seenOnThisSite.has(cleanTag)) {
                    tagData[cleanTag].sitesAppearedOn += 1;
                    seenOnThisSite.add(cleanTag);
                }
            });

            successfulSites++;
            
            // Log progress every 10 sites
            if (successfulSites % 10 === 0) {
                crawlLogs.push(`Scraped ${successfulSites}/${targetCount} domains... (Latest: ${domain})`);
            }

        } catch (error) {
            // If a site blocks us or times out, silently skip it
            continue;
        }
    }

    crawlLogs.push("Crawling finished! Applying Cross-Pollination Filtering...");

    // A tag MUST appear on at least 5% of the unique domains we visited
    const threshold = Math.max(2, Math.floor(successfulSites * 0.05)); 
    
    const universalTags = Object.keys(tagData)
        .map(tag => ({ 
            tag: tag, 
            count: tagData[tag].totalCount, 
            sites: tagData[tag].sitesAppearedOn 
        }))
        .filter(item => item.sites >= threshold) 
        .sort((a, b) => b.count - a.count)
        .slice(0, 253);

    // Build the final JSON dictionary
    const dictionary = {};
    universalTags.forEach((item, index) => {
        let hexCoord = (index + 1).toString(16).toUpperCase().padStart(2, '0');
        dictionary[hexCoord] = item.tag;
    });

    finalDictionary = dictionary;
    crawlLogs.push("Dictionary successfully generated!");
    isCrawling = false;
}

// --- API ENDPOINTS ---

// Trigger the spider
app.post('/api/start', (req, res) => {
    if (!isCrawling) {
        startSpider(150); // Target number of unique domains
    }
    res.json({ message: "Spider deployed." });
});

// Let the frontend poll for live updates
app.get('/api/status', (req, res) => {
    res.json({
        isCrawling: isCrawling,
        sitesProcessed: successfulSites,
        logs: crawlLogs,
        dictionary: finalDictionary
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});