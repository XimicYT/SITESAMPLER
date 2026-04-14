const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

let isCrawling = false;
let successfulSites = 0;
let crawlLogs = [];
let finalDictionary = null;

const seedUrls = [
    "https://news.ycombinator.com/",
    "https://www.reddit.com",
    "https://github.com",
    "https://dev.to",
    "https://en.wikipedia.org/wiki/Main_Page"
];

// List of file extensions we DO NOT want to scrape
const badExtensions = /\.(js|css|pdf|png|jpe?g|gif|svg|ico|xml|json|zip|mp3|mp4)$/i;

async function startSpider(targetCount = 150) {
    isCrawling = true;
    successfulSites = 0;
    crawlLogs = ["Initializing spider..."];
    finalDictionary = null;

    const queue = [...seedUrls];
    const visitedDomains = new Set();
    
    // SAFEGUARD 1: The Global Memory Bank (Prevents infinite A -> B -> A loops)
    const visitedUrls = new Set([...seedUrls]); 
    const tagData = {};

    while (queue.length > 0 && successfulSites < targetCount) {
        const currentUrl = queue.shift();
        
        let urlObj;
        try { urlObj = new URL(currentUrl); } 
        catch (e) { continue; }

        const currentDomain = urlObj.hostname;
        
        if (visitedDomains.has(currentDomain)) continue;
        visitedDomains.add(currentDomain);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(currentUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            
            // Check Content-Type to make sure it's actually HTML
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) continue;

            const htmlText = await response.text();

            // --- UPGRADED SPIDER LOGIC ---
            const linkMatches = htmlText.match(/href="https?:\/\/[^"]+"/g) || [];
            
            linkMatches.forEach(link => {
                const cleanLink = link.replace('href="', '').replace('"', '');
                
                try {
                    const parsedLink = new URL(cleanLink);
                    
                    // SAFEGUARD 2: Stranger Danger (Must be a different domain)
                    if (parsedLink.hostname === currentDomain) return;
                    
                    // SAFEGUARD 3: Asset Bouncer (Must not be a file format)
                    if (badExtensions.test(parsedLink.pathname)) return;

                    // Apply Safeguard 1 (Never queue the same exact URL twice)
                    if (!visitedUrls.has(cleanLink)) {
                        visitedUrls.add(cleanLink);
                        queue.push(cleanLink);
                    }
                } catch (e) {
                    // Ignore malformed links
                }
            });
            // -----------------------------

            const tagMatches = htmlText.match(/<[^>]+>/g) || [];
            const seenOnThisSite = new Set();

            tagMatches.forEach(tag => {
                const cleanTag = tag.toLowerCase();
                if (!tagData[cleanTag]) {
                    tagData[cleanTag] = { totalCount: 0, sitesAppearedOn: 0 };
                }
                tagData[cleanTag].totalCount += 1;
                
                if (!seenOnThisSite.has(cleanTag)) {
                    tagData[cleanTag].sitesAppearedOn += 1;
                    seenOnThisSite.add(cleanTag);
                }
            });

            successfulSites++;
            
            if (successfulSites % 10 === 0) {
                crawlLogs.push(`Scraped ${successfulSites}/${targetCount} domains... (Latest: ${currentDomain})`);
            }

        } catch (error) {
            continue;
        }
    }

    crawlLogs.push("Crawling finished! Applying Cross-Pollination Filtering...");

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

    const dictionary = {};
    universalTags.forEach((item, index) => {
        let hexCoord = (index + 1).toString(16).toUpperCase().padStart(2, '0');
        dictionary[hexCoord] = item.tag;
    });

    finalDictionary = dictionary;
    crawlLogs.push("Dictionary successfully generated!");
    isCrawling = false;
}

app.post('/api/start', (req, res) => {
    if (!isCrawling) startSpider(150); 
    res.json({ message: "Spider deployed." });
});

app.get('/api/status', (req, res) => {
    res.json({ isCrawling, sitesProcessed: successfulSites, logs: crawlLogs, dictionary: finalDictionary });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});