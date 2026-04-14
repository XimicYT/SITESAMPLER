const express = require('express');
const path = require('path');
const CertStreamClient = require('certstream');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

let isCrawling = false;
let sessionSites = 0;
let crawlLogs = [];
let scrapedUrlsList = []; 
let finalDictionary = null;

// NEW: Persistent Memory File
const MEMORY_FILE = path.join(__dirname, 'spider_memory.json');

// NEW: Scale up to 2500 domains per run
const TARGET_API_DOMAINS = 500; 
const TARGET_LIVE_DOMAINS = 2000; 
const TOTAL_TARGET = TARGET_API_DOMAINS + TARGET_LIVE_DOMAINS;

// Load previous runs if they exist
function loadMemory() {
    if (fs.existsSync(MEMORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
        } catch (e) {
            return { totalSitesScraped: 0, tagData: {} };
        }
    }
    return { totalSitesScraped: 0, tagData: {} };
}

// Save current state so we can accumulate later
function saveMemory(data) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

async function startSpider() {
    isCrawling = true;
    sessionSites = 0;
    scrapedUrlsList = []; 
    finalDictionary = null;
    
    let memory = loadMemory();
    crawlLogs = [
        `🕷️ Spider deployed! Session target: ${TOTAL_TARGET} domains.`, 
        `🧠 Loaded previous memory: ${memory.totalSitesScraped} all-time sites scraped.`
    ];

    let queue = [];

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
        crawlLogs.push("❌ API fetch failed. Falling back to 100% CertStream.");
    }

    crawlLogs.push(`📡 Tapping into live certificate logs (Waiting for ${TARGET_LIVE_DOMAINS} new websites)...`);
    
    await new Promise((resolve) => {
        let liveCount = 0;

        const client = new CertStreamClient(function(message) {
            if (liveCount >= TARGET_LIVE_DOMAINS) return; 

            if (message.message_type === "certificate_update") {
                const newDomain = message.data.leaf_cert.all_domains[0];
                
                if (newDomain && !newDomain.startsWith('*.')) {
                    queue.push(`https://${newDomain}`);
                    liveCount++;
                    
                    // Shows EVERY captured live domain
                    crawlLogs.push(`📡 Caught live domain [${liveCount}/${TARGET_LIVE_DOMAINS}]: ${newDomain}`);
                    
                    // Keep log box from crashing the browser by capping live lines
                    if (crawlLogs.length > 200) crawlLogs.shift();
                }
            }

            if (liveCount >= TARGET_LIVE_DOMAINS) {
                crawlLogs.push("✅ Live domain harvesting complete!");
                resolve(); 
            }
        });
        
        client.connect();
    });

    crawlLogs.push(`🚀 Queue locked and loaded. Starting the scrape engine...`);

    // ==========================================
    // PHASE 2: Process Queue
    // ==========================================
    for (const url of queue) {
        if (sessionSites >= TOTAL_TARGET) break;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000); 
            
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
                if (!memory.tagData[cleanTag]) {
                    memory.tagData[cleanTag] = { totalCount: 0, sitesAppearedOn: 0 };
                }
                memory.tagData[cleanTag].totalCount += 1;
                
                if (!seenOnThisSite.has(cleanTag)) {
                    memory.tagData[cleanTag].sitesAppearedOn += 1;
                    seenOnThisSite.add(cleanTag);
                }
            });

            sessionSites++;
            memory.totalSitesScraped++;
            scrapedUrlsList.push(url); 
            
            // Logs EVERY scraped site directly to the frontend
            crawlLogs.push(`🕸️ Scraped [${sessionSites}]: ${url}`);

            if (crawlLogs.length > 200) {
                crawlLogs.shift();
            }

        } catch (error) {
            continue;
        }
    }

    // Save the memory globally so the next run adds to it!
    saveMemory(memory);
    crawlLogs.push(`💾 Progress saved to spider_memory.json. All-time scraped: ${memory.totalSitesScraped}`);
    crawlLogs.push("🕷️ Crawling finished! Applying Cross-Pollination Filtering...");

    // ==========================================
    // PHASE 3: Generate Dictionary (Using ALL-TIME Data)
    // ==========================================
    // A tag MUST appear on 5% of all historical domains combined
    const threshold = Math.max(2, Math.floor(memory.totalSitesScraped * 0.05)); 
    
    const universalTags = Object.keys(memory.tagData)
        .map(tag => ({ 
            tag: tag, 
            count: memory.tagData[tag].totalCount, 
            sites: memory.tagData[tag].sitesAppearedOn 
        }))
        .filter(item => item.sites >= threshold) 
        .sort((a, b) => {
            if (b.sites !== a.sites) return b.sites - a.sites; 
            return b.count - a.count;      
        })
        .slice(0, 254);

    const dictionary = {};
    universalTags.forEach((item, index) => {
        let hexCoord = index.toString(16).toUpperCase().padStart(2, '0');
        dictionary[hexCoord] = item.tag;
    });

    finalDictionary = dictionary;
    crawlLogs.push("🎉 Dictionary successfully generated!");
    isCrawling = false;
}

// API Endpoints
app.post('/api/start', (req, res) => {
    if (!isCrawling) startSpider(); 
    res.json({ message: "Spider deployed." });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        isCrawling, 
        sitesProcessed: sessionSites, 
        logs: crawlLogs, 
        dictionary: finalDictionary,
        scrapedUrls: scrapedUrlsList 
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});