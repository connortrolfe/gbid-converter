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
        const { materialInput, sheetId, sheetRange } = req.body;

        if (!materialInput) {
            return res.status(400).json({ error: 'Material input is required' });
        }

        // Log the request for debugging
        console.log('📝 Request received:', {
            hasMaterialInput: !!materialInput,
            hasSheetId: !!sheetId,
            hasSheetRange: !!sheetRange,
            materialInputLength: materialInput.length
        });

        // Get API keys from environment
        const claudeApiKey = process.env.CLAUDE_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeHost = process.env.PINECONE_HOST;

        if (!claudeApiKey || !openaiApiKey || !pineconeApiKey || !pineconeHost) {
            return res.status(500).json({ error: 'API keys or Pinecone host not configured' });
        }

        console.log('🔍 Starting semantic search for:', materialInput);

        // Step 1: Convert material input to embedding
        console.log('📡 Calling OpenAI for embedding...');
        const queryEmbedding = await getEmbedding(materialInput, openaiApiKey);
        console.log('✅ Embedding received, length:', queryEmbedding.length);
        // Debug: print type and sample of embedding
        console.log('🔬 Embedding type:', Array.isArray(queryEmbedding) ? 'Array' : typeof queryEmbedding);
        console.log('🔬 Embedding sample:', queryEmbedding.slice(0, 10));
        
        // Step 2: Search Pinecone for similar items
        console.log('🔍 Pinecone config:', {
            host: pineconeHost,
            apiKeyLength: pineconeApiKey ? pineconeApiKey.length : 0
        });
        
        const searchResults = await searchPinecone(
            queryEmbedding, 
            pineconeApiKey
        );

        console.log(`📊 Found ${searchResults.length} relevant items`);

        // Filter results by relevance score and limit to top results
        const filteredResults = searchResults
            .filter(result => result.score > 0.7) // Only include relevant results
            .slice(0, 8); // Limit to top 8 most relevant

        console.log(`📊 Using ${filteredResults.length} filtered items (score > 0.7)`);

        // Step 3: Convert search results back to CSV format for Claude
        const relevantData = convertSearchResultsToCSV(filteredResults);

        // Step 4: Use Claude to convert to GBID format
        const claudePrompt = `Database entries:
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
                model: 'claude-sonnet-4-20250514',
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
        console.error('Error stack:', error.stack);
        
        // Check if it's a fetch error
        if (error.message.includes('fetch failed') || error.message.includes('fetch')) {
            return res.status(500).json({ 
                error: 'Network error: Unable to connect to external services. Please check your API keys and try again.' 
            });
        }
        
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}

// Get embedding from OpenAI
async function getEmbedding(text, apiKey) {
    console.log('Calling OpenAI...');
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            input: text,
            model: 'text-embedding-3-large'
        })
    });
    
    if (!response.ok) {
        throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('OpenAI success');
    return data.data[0].embedding;
}

// Search Pinecone for similar vectors (serverless index host)
async function searchPinecone(queryVector, apiKey) {
    // Use the host from the Pinecone dashboard
    const pineconeHost = process.env.PINECONE_HOST; // Set this in your env vars!
    if (!pineconeHost) throw new Error('PINECONE_HOST not set in environment variables');
    console.log('Calling Pinecone (serverless host):', pineconeHost);
    const response = await fetch(`${pineconeHost}/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Api-Key': apiKey
        },
        body: JSON.stringify({
            vector: queryVector,
            topK: 10,
            includeMetadata: true,
            includeValues: false
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Pinecone error response:', errorText);
        throw new Error(`Pinecone search failed: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Pinecone success');
    return data.matches || [];
}

// Convert Pinecone search results back to CSV format
function convertSearchResultsToCSV(searchResults) {
    if (searchResults.length === 0) {
        return 'No relevant items found';
    }
    
    // Define essential columns only to reduce token usage
    const essentialColumns = ['GBID', 'Description', 'alternate_names', 'special_notes'];
    
    // Create CSV with only essential columns
    const csvRows = [essentialColumns.join(',')]; // Header row
    
    searchResults.forEach(result => {
        const row = essentialColumns.map(header => {
            let value = result.metadata[header];
            if (value === undefined || value === null) value = '';
            value = String(value);
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
