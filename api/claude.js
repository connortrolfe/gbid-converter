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
        const { materialInput } = req.body;

        if (!materialInput) {
            return res.status(400).json({ error: 'Material input is required' });
        }

        const claudeApiKey = process.env.CLAUDE_API_KEY;
        const pineconeApiKey = process.env.PINECONE_API_KEY;
        const pineconeHost = process.env.PINECONE_HOST;
        const pineconeIndex = process.env.PINECONE_INDEX || 'gbid-database';

        if (!claudeApiKey) {
            return res.status(500).json({ error: 'Claude API key not configured' });
        }

        if (!pineconeApiKey || !pineconeHost) {
            return res.status(500).json({ error: 'Pinecone configuration not found' });
        }

        // Step 1: Get embeddings for the material input using OpenAI
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        console.log('Getting embeddings for:', materialInput);
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'text-embedding-3-large',
                input: materialInput
            })
        });

        if (!embeddingResponse.ok) {
            const errorText = await embeddingResponse.text();
            throw new Error(`OpenAI embedding error: ${embeddingResponse.status} - ${errorText}`);
        }

        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;

        // Step 2: Query Pinecone for similar items
        console.log('Querying Pinecone for similar items');
        const pineconeQueryResponse = await fetch(`https://${pineconeHost}/query`, {
            method: 'POST',
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                vector: embedding,
                topK: 50, // Get top 50 most similar items
                includeMetadata: true,
                includeValues: false
            })
        });

        if (!pineconeQueryResponse.ok) {
            const errorText = await pineconeQueryResponse.text();
            throw new Error(`Pinecone query error: ${pineconeQueryResponse.status} - ${errorText}`);
        }

        const pineconeData = await pineconeQueryResponse.json();
        const matches = pineconeData.matches || [];

        console.log(`Found ${matches.length} similar items in Pinecone`);

        // Step 3: Convert Pinecone results to CSV format
        let csvData = 'GBID,GBID Template,Description,Properties,Alternate Names,Special Notes\n';
        
        matches.forEach(match => {
            const metadata = match.metadata || {};
            const gbid = metadata.gbid || '';
            const gbidTemplate = metadata.gbidTemplate || '';
            const description = metadata.description || '';
            const properties = metadata.properties || '';
            const alternateNames = metadata.alternateNames || '';
            const specialNotes = metadata.specialNotes || '';
            
            // Escape CSV values (handle commas and quotes)
            const escapeCsv = (value) => {
                if (typeof value !== 'string') return '';
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            };

            csvData += `${escapeCsv(gbid)},${escapeCsv(gbidTemplate)},${escapeCsv(description)},${escapeCsv(properties)},${escapeCsv(alternateNames)},${escapeCsv(specialNotes)}\n`;
        });

        console.log('Claude CSV Data:\n', csvData);

        // Step 4: Prepare Claude API request with Pinecone data
        const systemPrompt = `<thinking>
I am a GBID converter and need to be extremely systematic and accurate. Let me establish my approach:

1. ANALYSIS PHASE:
   - First, I'll carefully parse the material request to identify each distinct item
   - Note quantities, sizes, materials, colors, and any specifications
   - Identify any ambiguous terms that need careful interpretation
   - Plan my search strategy for each item

2. DATABASE SEARCH STRATEGY:
   - Search broadly first, then narrow down
   - Check for exact product name matches
   - Look for alternate names and templates
   - Examine gbidTemplate fields for dynamic generation
   - Check static gbid fields for direct matches
   - Review special notes for template strings and mapping tables
   - Consider industry standard terms and slang

3. GBID GENERATION RULES:
   - If gbidTemplate exists: substitute requested sizes/values into template
   - If static gbid exists: use it directly
   - If GBID field says 'TEMPLATE': look in special notes for template string
   - Apply any mapping tables from special notes (e.g., color abbreviations)
   - Ensure proper formatting with asterisks and brackets as shown in examples

4. QUANTITY CALCULATION METHODOLOGY:
   - Footage becomes qty (remove symbols: 200' = 200)
   - Cuts/rolls: multiply by length (2 cuts × 400' = 800 total)
   - Boxes: check properties column for qty per box, then multiply
   - Verify all calculations are mathematically correct

5. QUALITY ASSURANCE CHECKS:
   - Double-check each match against original request
   - Verify all quantity calculations
   - Ensure GBID format follows templates correctly
   - Confirm I haven't missed any requested items
   - Use NO BID only after exhaustive search

Let me now process this request with extreme care and attention to detail...
</thinking>

You are a GBID converter. Use the following database to convert materials to GBID format.

DATABASE (CSV format):
${csvData}

<thinking>
Now I need to carefully analyze the specific material request. For each item, I'll:
1. Identify the exact product type and specifications
2. Search for matches using multiple approaches
3. Determine the correct GBID generation method
4. Calculate quantities precisely
5. Verify everything before including in the final list

Let me examine each requested item systematically...
</thinking>

INSTRUCTIONS:
- For each requested item, first think step by step about which items in the database are the best matches. Consider alternate names, templates, and all relevant columns.
- Then, give me a list of GBIDs based on the following format, using my GBID database as data.
- If an item contains specifications, such as sizes, search broadly first.

<thinking>
For template processing, I need to be very careful:
1. Check if there's a gbidTemplate field - if so, substitute sizes/values directly
2. If gbid field says 'TEMPLATE', look in special notes for the template string
3. Apply any mapping tables correctly (e.g., color codes, size abbreviations)
4. Ensure proper formatting with equals signs, asterisks, parentheses as shown in examples
</thinking>

- If you find a row with a 'gbidTemplate' field, use the template to generate the GBID by substituting the requested size(s) into the template. For example, if the gbidTemplate is '=ASE(SIZE)X(SIZE)X(SIZE)*' and the user requests an 8x8x6 j box, output '=ASE8X8X6*' as the GBID.
- If the item has a static 'gbid', use it directly.
- If the item has a GBID field that says 'TEMPLATE', look in the special notes for a template string and substitute the requested size(s) into it to generate the GBID.
- If the special notes for a template include a mapping table (e.g., color names to abbreviations), use the mapping to substitute the correct abbreviation for each requested value. For example, if the template is '=165(COLOR)4A' and the special notes say GREEN: GR, then for GREEN tape, output '=165GR4A*'.

<thinking>
For quantity calculations, I must be precise:
- Footage: convert directly (200' becomes 200)
- Cuts/rolls: multiply length by number of cuts/rolls
- Boxes: find qty per box in properties column, then multiply by number of boxes requested
- Double-check all math before finalizing
</thinking>

- If there is a footage instead of a qty, input the footage in its place (do not include measurement symbols - for example, 200' should print out as just 200).
- If there are multiple "cuts" or "rolls" of an item (namely wire), multiply the length by the amount of cuts/rolls to get the final qty (for example, 2 cuts of 400' of wire would become qty 800, 2 rolls of 500' would be qty 1000).
- Items are normally input as per item - if an item requests a number of boxes, use the properties column to determine how many qty is in each box, then output the total qty as a multiple of that.
- If an item has a size, such as 2" rigid conduit, search for the item first, then the size within the GBID field.
- Use the "alternate names" column to find the closest name for items with names that do not match.
- Read the special notes column for all items before output to determine which part numbers are usually standard or if there are any special instructions.
- Read through every line and every column regardless of whether or not the item is present in the request.
- Search online for alternate or slang terms if necessary.
- Do not hallucinate part numbers if you cannot find them.
- If you cannot find the item after exhausting all options, write NO BID as the GBID and 1 as the QTY.
- Only write notes at the end of the message, do not interrupt the list. Do not output anything before the list, all notes go after.

<thinking>
Before I start processing the actual request, let me remind myself of the critical steps:
1. Parse each item in the material request carefully
2. Search database using multiple methods (exact match, alternate names, templates)
3. If using templates, substitute values correctly and apply any mapping tables
4. Calculate quantities precisely according to the rules
5. Format output correctly as GBID[tab]QTY
6. Save all explanatory notes for the end
7. Use NO BID only if absolutely cannot find after exhaustive search

Now let me process the specific material request with maximum accuracy...
</thinking>

Format:
GBID[tab]QTY
GBID[tab]QTY
GBID[tab]QTY
[notes at the end]`;

        const anthropicPayload = {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 12000,
            system: [
                {
                    type: 'text',
                    text: systemPrompt,
                    cache_control: { type: 'ephemeral' }
                }
            ],
            messages: [
                {
                    role: 'user',
                    content: materialInput
                }
            ]
        };

        // Step 5: Call Claude API
        console.log('Calling Claude API with Pinecone data');
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(anthropicPayload)
        });

        if (!claudeResponse.ok) {
            const errorText = await claudeResponse.text();
            throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
        }

        const claudeData = await claudeResponse.json();
        
        console.log('Successfully processed with Pinecone data');
        return res.status(200).json({
            result: claudeData.content[0].text,
            usage: claudeData.usage,
            pineconeMatches: matches.length,
            csvData: csvData // Include for debugging if needed
        });
    } catch (error) {
        console.error('Claude API error:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}
