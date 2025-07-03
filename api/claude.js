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

        // Step 3: Convert search results back to CSV format for Claude
        const relevantData = convertSearchResultsToCSV(searchResults);

        // Step 4: Use Claude to convert to GBID format
        const claudePrompt = `Relevant database entries:
${relevantData}

Give me a list of GBIDs based on the following format, using my GBID database as data. If there is a footage instead of a qty, input the footage in it’s place (do not include measurement symbols - for example, 200' should print out as just 200). If there are multiple "cuts" or “rolls” of an item (namely wire), multiply the length by the amount of cuts/rolls to get the final qty (for example, 2 cuts of 400' of wire would become qty 800, 2 rolls of 500’ would be qty 1000). If an item has a size, such as 2" rigid conduit, search for the item first, then the size within the GBID field. Only write notes at the end of the message, do not interrupt the list. Assume standard for all parts unless specified. Use the "alternate names" column to find the closest name for items with names that do not match. Read the special notes column for all items before output to determine which part numbers are usually standard or if there are any special instructions. Read through every line and every column regardless of whether or not the item is present in the request. Search online for alternate or slang terms if necessary. At the end, double check your work and ensure no mistakes were made.

GBID	QTY
GBID	QTY
GBID	QTY

Create the list based on this message:

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
            topK: 50,
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
    
    // Get headers from first result metadata
    const firstResult = searchResults[0];
    const headers = Object.keys(firstResult.metadata).filter(key => key !== 'searchableText');
    
    // Create CSV
    const csvRows = [headers.join(',')]; // Header row
    
    searchResults.forEach(result => {
        const row = headers.map(header => {
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
