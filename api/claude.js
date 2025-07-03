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

        // Fetch Google Sheets data directly instead of calling our own API
        console.log('Fetching Google Sheets data for sheet:', sheetId);
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        
        const sheetsResponse = await fetch(csvUrl);
        
        if (!sheetsResponse.ok) {
            console.error('Google Sheets fetch failed:', sheetsResponse.status, sheetsResponse.statusText);
            if (sheetsResponse.status === 404) {
                throw new Error('Sheet not found. Make sure the sheet is public and the ID is correct.');
            } else if (sheetsResponse.status === 403) {
                throw new Error('Access denied. Make sure the sheet is set to "Anyone with the link can view".');
            } else {
                throw new Error(`Failed to fetch sheet: ${sheetsResponse.status} ${sheetsResponse.statusText}`);
            }
        }

        const csvData = await sheetsResponse.text();
        console.log('Successfully fetched CSV data, length:', csvData.length);

        // Prepare Claude API request
        const claudePrompt = `You are a GBID converter. Use the following database to convert materials to GBID format.

DATABASE (CSV format):
${csvData}

INSTRUCTIONS:
Give me a list of GBIDs based on the following format, using my GBID database as data. If there is a footage instead of a qty, input the footage in its place (do not include measurement symbols - for example, 200' should print out as just 200). If there are multiple "cuts" or "rolls" of an item (namely wire), multiply the length by the amount of cuts/rolls to get the final qty (for example, 2 cuts of 400' of wire would become qty 800, 2 rolls of 500' would be qty 1000). If an item has a size, such as 2" rigid conduit, search for the item first, then the size within the GBID field. Only write notes at the end of the message, do not interrupt the list. Assume standard for all parts unless specified. Use the "alternate names" column to find the closest name for items with names that do not match. Read the special notes column for all items before output to determine which part numbers are usually standard or if there are any special instructions. Read through every line and every column regardless of whether or not the item is present in the request. Search online for alternate or slang terms if necessary. If you cannot find the item after exhausting all options, write NO BID as the GBID and 1 as the QTY.

GBID    QTY
GBID    QTY
GBID    QTY

Create the list based on this message:

${materialInput}`;

        console.log('Calling Claude API...');

        // Call Claude API
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 4000,
                messages: [{
                    role: 'user',
                    content: claudePrompt
                }]
            })
        });

        console.log('Claude response status:', claudeResponse.status);

        if (!claudeResponse.ok) {
            const errorText = await claudeResponse.text();
            console.error('Claude API error:', errorText);
            throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
        }

        const claudeData = await claudeResponse.json();
        console.log('Claude response received successfully');
        
        return res.status(200).json({
            result: claudeData.content[0].text
        });

    } catch (error) {
        console.error('Error in Claude function:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}
