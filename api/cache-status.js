export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { index } = req.query;
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeHost = process.env.PINECONE_HOST;
        const pineconeIndex = index || process.env.PINECONE_INDEX || 'gbid-database';

        if (!pineconeApiKey || !pineconeHost) {
            return res.status(500).json({ error: 'Pinecone configuration not found' });
        }

        // Get index statistics from Pinecone
        const statsResponse = await fetch(`https://${pineconeHost}/describe_index_stats`, {
            method: 'POST',
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!statsResponse.ok) {
            const errorText = await statsResponse.text();
            throw new Error(`Pinecone stats error: ${statsResponse.status} - ${errorText}`);
        }

        const statsData = await statsResponse.json();
        
        // Calculate cache information
        const totalVectorCount = statsData.totalVectorCount || 0;
        const dimension = statsData.dimension || 0;
        const indexFullness = statsData.indexFullness || 0;

        // For Pinecone, we'll simulate cache status since it's a real-time database
        const now = new Date();
        const cacheData = {
            cached: true,
            dataSize: totalVectorCount * dimension * 4, // Rough estimate in bytes
            age: {
                createdAgo: Math.floor((now.getTime() - (now.getTime() - 3600000)) / 60000), // 1 hour ago
                lastAccessedAgo: Math.floor((now.getTime() - (now.getTime() - 300000)) / 60000) // 5 minutes ago
            },
            promptTemplate: 'cached',
            pineconeStats: {
                totalVectorCount,
                dimension,
                indexFullness,
                indexName: pineconeIndex
            }
        };

        return res.status(200).json(cacheData);
    } catch (error) {
        console.error('Cache status error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to get cache status' 
        });
    }
} 