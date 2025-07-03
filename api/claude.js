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
        const { materialInput } = req.body;

        if (!materialInput) {
            return res.status(400).json({ error: 'Material input is required' });
        }

        // Get API keys from environment
        const claudeApiKey = process.env.CLAUDE_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeEnvironment = process.env.PINECONE_ENVIRONMENT;
        const pineconeIndex = process.env.PINECONE_INDEX || 'gbid-database';

        if (!claudeApiKey || !openaiApiKey || !pineconeApiKey) {
            return res.status(500).json({ error: 'API keys not configured' });
        }

        console.log('🔍 Starting semantic search for:', materialInput);

        // Step 1: Convert material input to embedding
        const queryEmbedding = await getEmbedding(materialInput, openaiApiKey);
        
        // Step 2: Search Pinecone for similar items
        const searchResults = await searchPinecone(
            queryEmbedding, 
            pineconeApiKey, 
            pineconeEnvironment, 
            pineconeIndex
        );

        console.log(`📊 Found ${searchResults.length} relevant items`);

        // Step 3: Convert search results back to CSV format for Claude
        const relevantData = convertSearchResultsToCSV(searchResults);

        // Step 4: Use Claude to convert to GBID format
        const claudePrompt = `Relevant database entries:
${relevantData}

Convert materials to GBID format:
- Footage = qty (no symbols: 200' = 200)
- Cuts/rolls: multiply × length (2 cuts × 400' = qty 800)
- Check alternate names, special notes
- Not found = GBID: NO BID, QTY: 1

Format: GBID[tab]QTY

Materials: ${materialInput}`;

        console.log('🤖 Calling Claude for GBID conversion...');

        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: claudePrompt
                }]
            })
        });

        if (!claudeResponse.ok) {
            const errorText = await claudeResponse.text();
            throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
        }

        const claudeData = await claudeResponse.json();
        
        return res.status(200).json({
            result: claudeData.content[0].text,
            debug: {
                itemsFound: searchResults.length,
                searchScores: searchResults.map(r => r.score)
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}

// Get embedding from OpenAI
async function getEmbedding(text, apiKey) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            input: text,
            model: 'text-embedding-ada-002'
        })
    });
    
    if (!response.ok) {
        throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data[0].embedding;
}

// Search Pinecone for similar vectors
async function searchPinecone(queryVector, apiKey, environment, indexName) {
    const response = await fetch(`https://${indexName}-${environment}.svc.pinecone.io/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Api-Key': apiKey
        },
        body: JSON.stringify({
            vector: queryVector,
            topK: 50, // Get top 50 most similar items
            includeMetadata: true,
            includeValues: false
        })
    });
    
    if (!response.ok) {
        throw new Error(`Pinecone search failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.matches || [];
}

// Convert Pinecone search results back to CSV format
function convertSearchResultsToCSV(searchResults) {
    if (searchResults.length === 0) {
        return 'No relevant items found';
    }
    
    // Get headers from first result metadata
    const firstResult = searchResults[0];
    const headers = Object.keys(firstResult.metadata).filter(key => key !== 'searchableText');
    
    // Create CSV
    const csvRows = [headers.join(',')]; // Header row
    
    searchResults.forEach(result => {
        const row = headers.map(header => {
            const value = result.metadata[header] || '';
            // Escape commas and quotes in CSV
            if (value.includes(',') || value.includes('"')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
}
