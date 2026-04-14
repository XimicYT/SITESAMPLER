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

// Persistent Memory File
const MEMORY_FILE = path.join(__dirname, 'spider_memory.json');

// Session target
const TARGET_SITES = 2500; 

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
        `🕷️ Spider deployed! Session target: ${TARGET_SITES} domains.`, 
        `🧠 Loaded previous memory: ${memory.totalSitesScraped} all-time sites scraped.`
    ];

    let queue = [];

    // ==========================================
    // PHASE 1: Dictionary Domain Generation
    // ==========================================
    crawlLogs.push("🌍 Generating unbiased domains from dictionary base...");
    try {
        // Fetch common English words from a reliable repo
        const response = await fetch('https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt');
        if (!response.ok) throw new Error("API returned " + response.status);
        
        const text = await response.text();
        const words = text.split('\n').filter(w => w.length > 4); // Skip tiny words
        words.sort(() => 0.5 - Math.random()); // Shuffle them
        
        const extensions = ['.com', '.org', '.net', '.io', '.co'];
        // Generate 4,000 URLs to guarantee we have enough fuel for 2,500 successful scrapes
        words.slice(0, 4000).forEach((word, i) => {
            const ext = extensions[i % extensions.length];
            queue.push(`https://${word.trim()}${ext}`);
        });
        
        crawlLogs.push(`✅ Instantly loaded 4000 random root domains.`);
    } catch (err) {
        crawlLogs.push(`❌ Domain fetch failed. Relying strictly on CertStream.`);
    }

    // ==========================================
    // PHASE 2: CertStream with Escape Hatch
    // ==========================================
    crawlLogs.push(`📡 Tapping live certificate logs (Waiting for new domains)...`);
    
    await new Promise((resolve) => {
        let liveCount = 0;

        // ESCAPE HATCH: If blocked by host, force start after 12 seconds
        const failSafe = setTimeout(() => {
            crawlLogs.push("⚠️ CertStream websocket blocked/timed out! Activating Escape Hatch. Releasing spider early...");
            resolve();
        }, 12000); 

        try {
            const client = new CertStreamClient(function(message) {
                if (message.message_type === "certificate_update") {
                    const newDomain = message.data.leaf_cert.all_domains[0];
                    
                    if (newDomain && !newDomain.startsWith('*.')) {
                        queue.push(`https://${newDomain}`);
                        liveCount++;
                        
                        crawlLogs.push(`📡 Caught live domain: ${newDomain}`);
                        if (crawlLogs.length > 200) crawlLogs.shift();
                    }
                }

                // If it works, grab up to 500 live domains to mix into the queue
                if (liveCount >= 500) {
                    clearTimeout(failSafe);
                    crawlLogs.push("✅ Live domain harvesting complete!");
                    resolve(); 
                }
            });
            client.connect();
        } catch (e) {
            clearTimeout(failSafe);
            crawlLogs.push("⚠️ CertStream failed to connect. Skipping to dictionary domains...");
            resolve();
        }
    });

    if (queue.length === 0) {
        crawlLogs.push("❌ Queue is empty! Check your server's outbound network connections.");
        isCrawling = false;
        return;
    }

    crawlLogs.push(`🚀 Queue locked and loaded with ${queue.length} URLs. Starting the scrape engine...`);

    // ==========================================
    // PHASE 3: Process Queue
    // ==========================================
    for (const url of queue) {
        if (sessionSites >= TARGET_SITES) break;

        try {
            const controller = new AbortController();
            // Drop dead sites fast (3 seconds max)
            const timeoutId = setTimeout(() => controller.abort(), 3000); 
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) continue;

            const htmlText = await response.text();
            const tagMatches = htmlText.match(/<[^>]+>/g) || [];
            
            // Skip pages that are virtually empty (likely holding pages or errors)
            if (tagMatches.length < 5) continue; 

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
            
            crawlLogs.push(`🕸️ Scraped [${sessionSites}/${TARGET_SITES}]: ${url}`);
            if (crawlLogs.length > 200) crawlLogs.shift();

        } catch (error) {
            // Silently skip domains that don't exist
            continue;
        }
    }

    saveMemory(memory);
    crawlLogs.push(`💾 Progress saved to spider_memory.json. All-time scraped: ${memory.totalSitesScraped}`);
    crawlLogs.push("🕷️ Crawling finished! Applying Cross-Pollination Filtering...");

    // ==========================================
    // PHASE 4: Generate Dictionary 
    // ==========================================
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