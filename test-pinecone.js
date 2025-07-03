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
