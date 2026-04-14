const express = require('express');
const path = require('path');
const certstream = require('certstream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

let isCrawling = false;
let successfulSites = 0;
let crawlLogs = [];
let scrapedUrlsList = []; 
let finalDictionary = null;

// Target parameters for our unbiased queue
const TARGET_API_DOMAINS = 100; 
const TARGET_LIVE_DOMAINS = 50; 

async function startSpider(targetCount = 150) {
    isCrawling = true;
    successfulSites = 0;
    crawlLogs = ["Initializing unbiased spider..."];
    scrapedUrlsList = []; 
    finalDictionary = null;

    let queue = [];
    const tagData = {};

    // ==========================================
    // PHASE 1: Build the Unbiased Queue
    // ==========================================
    crawlLogs.push("🌍 Fetching established random domains from API...");
    try {
        const response = await fetch('https://raw.githubusercontent.com/statscounter/random-domains/main/sample.txt');
        const text = await response.text();
        const apiDomains = text.split('\n').filter(Boolean).slice(0, TARGET_API_DOMAINS);
        
        apiDomains.forEach(domain => queue.push(`https://${domain.trim()}`));
        crawlLogs.push(`✅ Added ${apiDomains.length} established domains.`);
    } catch (err) {
        crawlLogs.push("❌ Failed to fetch API domains. Falling back to CertStream only.");
    }

    crawlLogs.push("📡 Tapping into live certificate logs (Waiting for new websites)...");
    
    // Wrap CertStream in a Promise so we halt execution until we catch our quota
    await new Promise((resolve) => {
        let liveCount = 0;

        const client = certstream.client(function(message) {
            if (liveCount >= TARGET_LIVE_DOMAINS) return; // Stop processing once target is met

            if (message.message_type === "certificate_update") {
                const newDomain = message.data.leaf_cert.all_domains[0];
                
                if (newDomain && !newDomain.startsWith('*.')) {
                    queue.push(`https://${newDomain}`);
                    liveCount++;
                    
                    // Only push log every 10 domains so we don't spam the frontend UI
                    if (liveCount % 10 === 0) {
                        crawlLogs.push(`Caught live domain ${liveCount}/${TARGET_LIVE_DOMAINS}: ${newDomain}`);
                    }
                }
            }

            if (liveCount >= TARGET_LIVE_DOMAINS) {
                crawlLogs.push("✅ Live domain harvesting complete!");
                resolve(); 
            }
        });
    });

    crawlLogs.push(`🚀 Queue locked and loaded with ${queue.length} totally unbiased URLs. Releasing the spider...`);

    // ==========================================
    // PHASE 2: Process Queue (No Link Hopping!)
    // ==========================================
    for (const url of queue) {
        if (successfulSites >= targetCount) break; // Stop if we hit our max

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) continue;

            const htmlText = await response.text();
            const tagMatches = htmlText.match(/<[^>]+>/g) || [];
            const seenOnThisSite = new Set();

            tagMatches.forEach(tag => {
                const cleanTag = tag.toLowerCase().trim();
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
            scrapedUrlsList.push(url); 
            
            if (successfulSites % 10 === 0) {
                let urlObj = new URL(url);
                crawlLogs.push(`Scraped ${successfulSites}/${targetCount} domains... (Latest: ${urlObj.hostname})`);
            }

        } catch (error) {
            // Silently skip domains that timeout or don't have hosting set up yet
            continue;
        }
    }

    crawlLogs.push("🕷️ Crawling finished! Applying Cross-Pollination Filtering...");

    // ==========================================
    // PHASE 3: Generate Dictionary
    // ==========================================
    const threshold = Math.max(2, Math.floor(successfulSites * 0.05)); 
    
    const universalTags = Object.keys(tagData)
        .map(tag => ({ 
            tag: tag, 
            count: tagData[tag].totalCount, 
            sites: tagData[tag].sitesAppearedOn 
        }))
        .filter(item => item.sites >= threshold) 
        .sort((a, b) => {
            if (b.sites !== a.sites) return b.sites - a.sites; 
            return b.count - a.count;      
        })
        .slice(0, 254);

    const dictionary = {};
    universalTags.forEach((item, index) => {
        // Starts hex at 00, formats properly for your dashboard
        let hexCoord = index.toString(16).toUpperCase().padStart(2, '0');
        dictionary[hexCoord] = item.tag;
    });

    finalDictionary = dictionary;
    crawlLogs.push("🎉 Dictionary successfully generated!");
    isCrawling = false;
}

// API Endpoints
app.post('/api/start', (req, res) => {
    if (!isCrawling) startSpider(150); 
    res.json({ message: "Spider deployed." });
});

app.get('/api/status', (req, res) => {
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