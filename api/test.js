export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Check environment variables
        const envCheck = {
            claudeApiKey: !!process.env.CLAUDE_API_KEY,
            openaiApiKey: !!process.env.OPENAI_API_KEY,
            pineconeApiKey: !!process.env.PINECONE_API_KEY,
            pineconeEnvironment: !!process.env.PINECONE_ENVIRONMENT,
            pineconeIndex: process.env.PINECONE_INDEX || 'gbid-database'
        };

        // Test basic fetch
        let fetchTest = 'Not tested';
        try {
            const testResponse = await fetch('https://httpbin.org/get');
            fetchTest = testResponse.ok ? 'Success' : `Failed: ${testResponse.status}`;
        } catch (error) {
            fetchTest = `Error: ${error.message}`;
        }

        return res.status(200).json({
            status: 'API is working',
            environment: envCheck,
            fetchTest: fetchTest,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Test API error:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
} 
