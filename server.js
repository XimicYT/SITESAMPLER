const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

let isCrawling = false;
let successfulSites = 0;
let crawlLogs = [];
let scrapedUrlsList = []; // NEW: The Captain's Log
let finalDictionary = null;

const seedUrls = [
    "https://news.ycombinator.com/",
    "https://www.reddit.com",
    "https://github.com",
    "https://dev.to",
    "https://en.wikipedia.org/wiki/Main_Page"
];

const badExtensions = /\.(js|css|pdf|png|jpe?g|gif|svg|ico|xml|json|zip|mp3|mp4)$/i;

// NEW: Root Domain Extractor
function getBaseDomain(hostname) {
    const parts = hostname.split('.');
    // Handle things like .co.uk or .com.au
    if (parts.length > 2 && (parts[parts.length - 2] === 'co' || parts[parts.length - 2] === 'com' || parts[parts.length - 2] === 'org')) {
        return parts.slice(-3).join('.'); 
    }
    return parts.slice(-2).join('.'); // Turns en.wikipedia.org into wikipedia.org
}

async function startSpider(targetCount = 150) {
    isCrawling = true;
    successfulSites = 0;
    crawlLogs = ["Initializing spider..."];
    scrapedUrlsList = []; // Clear previous logs
    finalDictionary = null;

    const queue = [...seedUrls];
    const visitedRootDomains = new Set(); // UPGRADED: Tracks root domains, not hostnames
    const visitedUrls = new Set([...seedUrls]); 
    const tagData = {};

    while (queue.length > 0 && successfulSites < targetCount) {
        const currentUrl = queue.shift();
        
        let urlObj;
        try { urlObj = new URL(currentUrl); } 
        catch (e) { continue; }

        // Extract the root domain to avoid subdomain traps
        const rootDomain = getBaseDomain(urlObj.hostname);
        
        if (visitedRootDomains.has(rootDomain)) continue;
        visitedRootDomains.add(rootDomain);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(currentUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                // If it fails, remove it from the root domain list so we can try another link from that domain later
                visitedRootDomains.delete(rootDomain);
                continue;
            }
            
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) {
                visitedRootDomains.delete(rootDomain);
                continue;
            }

            const htmlText = await response.text();

            const linkMatches = htmlText.match(/href="https?:\/\/[^"]+"/g) || [];
            
            linkMatches.forEach(link => {
                const cleanLink = link.replace('href="', '').replace('"', '');
                
                try {
                    const parsedLink = new URL(cleanLink);
                    const parsedRootDomain = getBaseDomain(parsedLink.hostname);
                    
                    if (parsedRootDomain === rootDomain) return; // Stranger danger
                    if (badExtensions.test(parsedLink.pathname)) return;

                    if (!visitedUrls.has(cleanLink)) {
                        visitedUrls.add(cleanLink);
                        queue.push(cleanLink);
                    }
                } catch (e) {}
            });

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
            scrapedUrlsList.push(currentUrl); // NEW: Save to our master list
            
            if (successfulSites % 10 === 0) {
                crawlLogs.push(`Scraped ${successfulSites}/${targetCount} domains... (Latest: ${rootDomain})`);
            }

        } catch (error) {
            visitedRootDomains.delete(rootDomain);
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
    // NEW: We are now sending the scrapedUrls array to the frontend
    res.json({ 
        isCrawling, 
        sitesProcessed: successfulSites, 
        logs: crawlLogs, 
        dictionary: finalDictionary,
        scrapedUrls: scrapedUrlsList 
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});