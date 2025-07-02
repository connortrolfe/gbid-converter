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
        const { sheetId, range } = req.body;

        if (!sheetId) {
            return res.status(400).json({ error: 'Sheet ID is required' });
        }

        console.log('Attempting to fetch sheet:', sheetId);

        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        console.log('CSV URL:', csvUrl);

        const response = await fetch(csvUrl);
        console.log('Google Sheets response status:', response.status);
        
        if (!response.ok) {
            console.error('Google Sheets error:', response.status, response.statusText);
            if (response.status === 404) {
                throw new Error('Sheet not found. Make sure the sheet is public and the ID is correct.');
            } else if (response.status === 403) {
                throw new Error('Access denied. Make sure the sheet is set to "Anyone with the link can view".');
            } else {
                throw new Error(`Failed to fetch sheet: ${response.status} ${response.statusText}`);
            }
        }

        const csvData = await response.text();
        console.log('CSV data length:', csvData.length);
        
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
