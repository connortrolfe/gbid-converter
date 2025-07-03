// api/claude.js - Research-mode style implementation
export default async function handler(req, res) {
    // ... (setup code) ...
    
    try {
        const { sheetId, materialInput } = req.body;
        const csvData = await fetchGoogleSheetData(sheetId);
        
        // Use research-style approach
        const result = await researchModeConversion(csvData, materialInput, claudeApiKey);
        
        return res.status(200).json({ result });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function researchModeConversion(csvData, materialInput, apiKey) {
    const researchPrompt = `<thinking>
I need to convert this material request to GBID format: "${materialInput}"

Let me think through this systematically:

1. First, I need to analyze what materials are being requested
2. Then search through the database strategically 
3. Find the right GBIDs for each item
4. Calculate the correct quantities
5. Format the final output

Let me start by breaking down the request...
</thinking>

I have access to a complete electrical/construction database. I need to systematically search through it to find the right GBID codes for: "${materialInput}"

Database (${csvData.length} characters):
${csvData}

I will now think step-by-step through this conversion process:

<research_process>
Step 1: Analyze the material request
- What specific products are mentioned?
- What sizes, materials, colors are specified?  
- What quantities and measurements are given?

Step 2: Search strategy
- What terms should I search for in the database?
- Are there alternate names or synonyms to consider?
- Should I look for product families or specific items?

Step 3: Database search
- Scan through relevant sections
- Look for exact matches first
- Consider similar products if exact matches not found
- Check alternate names and special notes columns

Step 4: Quantity calculations  
- Convert footage to quantities
- Handle cuts/rolls multiplication
- Ensure proper formatting

Step 5: Final verification
- Double-check all matches
- Verify quantity calculations
- Ensure proper GBID format
</research_process>

Rules:
- Footage = qty (200' = 200)
- Cuts × length = total qty (3 cuts × 100' = 300)
- Check alternate names and special notes
- Output format: GBID[tab]QTY
- If not found: NO BID[tab]1

Now I'll work through this systematically and provide only the final GBID list.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022', // Use the smarter model
            max_tokens: 4000, // More tokens for research process
            messages: [{
                role: 'user',
                content: researchPrompt
            }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Extract just the final GBID list from the research output
    const fullResponse = data.content[0].text;
    const gbidMatch = fullResponse.match(/(?:GBID.*?QTY|Final.*?list|Results?:?)\s*\n((?:[^\n]+\t[^\n]+\n?)+)/i);
    
    if (gbidMatch) {
        return gbidMatch[1].trim();
    }
    
    // Fallback: return the full response if we can't extract cleanly
    return fullResponse;
}

// Helper function same as before
async function fetchGoogleSheetData(sheetId) {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch sheet: ${response.status}`);
    }
    
    return await response.text();
}
