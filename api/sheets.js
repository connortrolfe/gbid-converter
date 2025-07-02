// api/sheets.js - Vercel serverless function for Google Sheets proxy
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { sheetId, range } = req.body;

        if (!sheetId) {
            return res.status(400).json({ error: 'Sheet ID is required' });
        }

        // For public sheets, we can access them without API key using the /export endpoint
        // This is simpler than setting up Google API credentials
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;

        const response = await fetch(csvUrl);
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Sheet not found. Make sure the sheet is public and the ID is correct.');
            } else if (response.status === 403) {
                throw new Error('Access denied. Make sure the sheet is set to "Anyone with the link can view".');
            } else {
                throw new Error(`Failed to fetch sheet: ${response.status} ${response.statusText}`);
            }
        }

        const csvData = await response.text();
        
        // Count rows (subtract 1 for header if present)
        const rows = csvData.trim().split('\n');
        const rowCount = rows.length;

        return res.status(200).json({
            csvData,
            rowCount,
            message: 'Google Sheets data retrieved successfully'
        });

    } catch (error) {
        console.error('Sheets API error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to fetch Google Sheets data' 
        });
    }
}
