// api/claude.js - Two-Stage AI Search Implementation
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { sheetId, sheetRange, materialInput } = req.body;

        if (!sheetId || !materialInput) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const claudeApiKey = process.env.CLAUDE_API_KEY;
        if (!claudeApiKey) {
            return res.status(500).json({ error: 'Claude API key not configured' });
        }

        // Fetch Google Sheets data
        console.log('📊 Fetching Google Sheets data for sheet:', sheetId);
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        
        const sheetsResponse = await fetch(csvUrl);
        
        if (!sheetsResponse.ok) {
            console.error('Google Sheets fetch failed:', sheetsResponse.status, sheetsResponse.statusText);
            throw new Error(`Failed to fetch sheet: ${sheetsResponse.status} ${sheetsResponse.statusText}`);
        }

        const csvData = await sheetsResponse.text();
        console.log('Successfully fetched CSV data, total length:', csvData.length);

        // STAGE 1: AI identifies what to search for
        console.log('🔍 Stage 1: AI analyzing materials for search terms...');
        const searchTerms = await getSearchTerms(materialInput, claudeApiKey);
        console.log('AI identified search terms:', searchTerms);
        
        // STAGE 2: Filter database using AI-generated terms
        console.log('🎯 Stage 2: Filtering database with AI terms...');
        const relevantData = filterDatabaseByTerms(csvData, searchTerms);
        console.log(`Filtered database from ${csvData.length} to ${relevantData.length} characters`);
        
        // STAGE 3: Convert to GBID using filtered data
        console.log('🤖 Stage 3: Converting to GBID format...');
        const result = await convertToGBID(relevantData, materialInput, claudeApiKey);
        
        return res.status(200).json({
            result,
            debug: {
                originalDbSize: csvData.length,
                filteredDbSize: relevantData.length,
                searchTermsUsed: searchTerms,
                reductionPercentage: Math.round((1 - relevantData.length / csvData.length) * 100)
            }
        });

    } catch (error) {
        console.error('Error in Claude function:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}

// Stage 1: AI determines what to search for
async function getSearchTerms(materialInput, apiKey) {
    const searchPrompt = `Analyze this electrical/construction material request and extract search terms for a product database.

Material request: "${materialInput}"

Extract search terms for:
- Product types (wire, conduit, fitting, box, panel, etc.)
- Sizes/gauges (#12, #1/0, 2", 3/4", etc.)
- Materials (copper, aluminum, PVC, steel, EMT, etc.)
- Colors (black, red, white, green, blue, etc.)
- Quantities/measurements (cuts, rolls, feet, etc.)

Return only the most important search terms, comma-separated:`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Cheap model for search term extraction
            max_tokens: 4000,
            messages: [{ role: 'user', content: searchPrompt }]
        })
    });

    if (!response.ok) {
        console.error('Search terms extraction failed, using fallback');
        return extractBasicTerms(materialInput);
    }

    const data = await response.json();
    const terms = data.content[0].text
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 1);
    
    return terms.length > 0 ? terms : extractBasicTerms(materialInput);
}

// Fallback term extraction if AI fails
function extractBasicTerms(materialInput) {
    const text = materialInput.toLowerCase();
    const terms = [];
    
    // Extract wire gauges
    const wireGauges = text.match(/#?\d+\/?\d*\s*(awg|gauge)?/g) || [];
    terms.push(...wireGauges.map(g => g.replace(/\s/g, '')));
    
    // Extract sizes
    const sizes = text.match(/\d+\/?\d*\s*["']/g) || [];
    terms.push(...sizes.map(s => s.replace(/\s/g, '')));
    
    // Extract common electrical terms
    const commonTerms = text.match(/\b(copper|aluminum|steel|pvc|emt|rigid|flex|wire|cable|conduit|pipe|fitting|connector|box|panel|black|red|white|green|blue|yellow)\b/g) || [];
    terms.push(...commonTerms);
    
    return [...new Set(terms)];
}

// Stage 2: Filter database using AI-generated terms
function filterDatabaseByTerms(csvData, searchTerms) {
    const rows = csvData.trim().split('\n');
    const header = rows[0];
    const dataRows = rows.slice(1);
    
    if (searchTerms.length === 0) {
        // If no terms, return first 150 rows
        return [header, ...dataRows.slice(0, 150)].join('\n');
    }
    
    console.log(`Searching ${dataRows.length} rows for terms:`, searchTerms);
    
    // Score each row based on term matches
    const scoredRows = dataRows.map((row, index) => {
        const rowText = row.toLowerCase();
        let score = 0;
        
        searchTerms.forEach(term => {
            if (rowText.includes(term)) {
                // Boost score for exact matches
                score += term.length > 2 ? 2 : 1;
            }
        });
        
        return { row, score, index };
    });
    
    // Get rows with matches, sorted by relevance
    const relevantRows = scoredRows
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 200) // Top 200 matches
        .map(item => item.row);
    
    // If too few matches, add some common items from the beginning
    if (relevantRows.length < 50) {
        const additionalRows = dataRows
            .slice(0, 100 - relevantRows.length)
            .filter(row => !relevantRows.includes(row));
        relevantRows.push(...additionalRows);
    }
    
    console.log(`Found ${relevantRows.length} relevant rows`);
    return [header, ...relevantRows].join('\n');
}

// Stage 3: Convert to GBID with filtered data
async function convertToGBID(filteredData, materialInput, apiKey) {
    const convertPrompt = `Database: ${filteredData}

Convert to GBID format. OUTPUT ONLY THE GBID LIST - NO EXPLANATIONS OR DATABASE CONTENT.

Rules:
- Footage = qty (200' = 200)
- Cuts × length = qty (2 cuts × 400' = 800)
- Not found = NO BID, qty 1

ONLY OUTPUT THIS FORMAT:
GBID    QTY
GBID    QTY

Materials: ${materialInput}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4000, // Reduced since we only want GBID output
            messages: [{ role: 'user', content: convertPrompt }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude conversion failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.content[0].text;
}
