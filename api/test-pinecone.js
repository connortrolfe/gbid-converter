export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeIndex = process.env.PINECONE_INDEX;
        if (!pineconeApiKey || !pineconeIndex) {
            return res.status(500).json({ error: 'PINECONE_API_KEY or PINECONE_INDEX not set' });
        }

        // Try a simple query
        const url = `https://api.pinecone.io/indexes/${pineconeIndex}/query`;
        const testVector = [0,0,0,0,0];
        let pineconeResponse, pineconeData, errorText;
        try {
            pineconeResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Api-Key': pineconeApiKey
                },
                body: JSON.stringify({
                    vector: testVector,
                    topK: 1,
                    includeMetadata: false,
                    includeValues: false
                })
            });
            if (!pineconeResponse.ok) {
                errorText = await pineconeResponse.text();
            } else {
                pineconeData = await pineconeResponse.json();
            }
        } catch (err) {
            return res.status(500).json({
                status: 'fetch_failed',
                error: err.message,
                url,
                pineconeIndex,
                pineconeApiKeyPreview: pineconeApiKey.slice(0, 6) + '...'
            });
        }

        const searchResults = await searchPinecone(
            testVector, 
            pineconeApiKey
        );

        return res.status(200).json({
            status: pineconeResponse.ok ? 'success' : 'error',
            httpStatus: pineconeResponse.status,
            errorText,
            pineconeData,
            url,
            pineconeIndex,
            pineconeApiKeyPreview: pineconeApiKey.slice(0, 6) + '...'
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Search Pinecone for similar vectors (serverless index)
async function searchPinecone(queryVector, apiKey, indexName) {
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
