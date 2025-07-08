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

        // Step 0: Use Claude to split the input into discrete items
        const splitPrompt = `Given the following request, list each distinct material or item as a separate line, one per line, with no extra text or explanation. Only output the list, no commentary.\n\nRequest:\n${materialInput}`;
        const splitPayload = {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: [
                {
                    type: 'text',
                    text: 'You are a helpful assistant for parsing material lists.'
                }
            ],
            messages: [
                {
                    role: 'user',
                    content: splitPrompt
                }
            ]
        };
        console.log('Calling Claude to split input into items...');
        const splitResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(splitPayload)
        });
        if (!splitResponse.ok) {
            const errorText = await splitResponse.text();
            throw new Error(`Claude split error: ${splitResponse.status} - ${errorText}`);
        }
        const splitData = await splitResponse.json();
        let splitText = splitData.content[0].text || '';
        // Split into lines, trim, and filter empty
        const lines = splitText.split('\n').map(l => l.trim()).filter(l => l);
        console.log('Parsed lines from Claude:', lines);
        let allMatches = [];
        for (const line of lines) {
            console.log('Getting embedding for line:', line);
            const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'text-embedding-3-large',
                    input: line
                })
            });
            if (!embeddingResponse.ok) {
                const errorText = await embeddingResponse.text();
                throw new Error(`OpenAI embedding error: ${embeddingResponse.status} - ${errorText}`);
            }
            const embeddingData = await embeddingResponse.json();
            const embedding = embeddingData.data[0].embedding;
            // Query Pinecone for this line
            console.log('Querying Pinecone for line:', line);
            const pineconeQueryResponse = await fetch(`https://${pineconeHost}/query`, {
                method: 'POST',
                headers: {
                    'Api-Key': pineconeApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vector: embedding,
                    topK: 50,
                    includeMetadata: true,
                    includeValues: false
                })
            });
            if (!pineconeQueryResponse.ok) {
                const errorText = await pineconeQueryResponse.text();
                throw new Error(`Pinecone query error: ${pineconeQueryResponse.status} - ${errorText}`);
            }
            const pineconeData = await pineconeQueryResponse.json();
            let matches = pineconeData.matches || [];
            // Rerank: prefer matches where name or alternate names include the main type
            const type = extractType(line);
            matches = matches.sort((a, b) => {
                const aMeta = (a.metadata?.name || '') + ' ' + (a.metadata?.alternateNames || '') + ' ' + (a.metadata?.alternate_names || '');
                const bMeta = (b.metadata?.name || '') + ' ' + (b.metadata?.alternateNames || '') + ' ' + (b.metadata?.alternate_names || '');
                const aMatch = aMeta.toLowerCase().includes(type);
                const bMatch = bMeta.toLowerCase().includes(type);
                return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
            });
            // Only take the top 5 matches for this line
            allMatches.push(...matches.slice(0, 5));
        }
        // Deduplicate matches by vector id
        const seen = new Set();
        const dedupedMatches = allMatches.filter(match => {
            if (seen.has(match.id)) return false;
            seen.add(match.id);
            return true;
        });
        console.log(`Merged and deduped to ${dedupedMatches.length} unique matches`);
        // Step 3: Convert deduped Pinecone results to CSV format
        let csvData = 'Name,GBID,GBID Template,Description,Properties,Alternate Names,Special Notes\n';
        dedupedMatches.forEach(match => {
            const metadata = match.metadata || {};
            const name = metadata.name || '';
            const gbid = metadata.gbid || '';
            const gbidTemplate = metadata.gbidTemplate || '';
            const description = metadata.description || '';
            const properties = metadata.properties || '';
            // Use both alternateNames and alternate_names for robustness
            const alternateNames = metadata.alternateNames || metadata.alternate_names || '';
            const specialNotes = metadata.specialNotes || metadata.special_notes || '';
            // Escape CSV values (handle commas and quotes)
            const escapeCsv = (value) => {
                if (typeof value !== 'string') return '';
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            };
            csvData += `${escapeCsv(name)},${escapeCsv(gbid)},${escapeCsv(gbidTemplate)},${escapeCsv(description)},${escapeCsv(properties)},${escapeCsv(alternateNames)},${escapeCsv(specialNotes)}\n`;
        });
        console.log('Claude CSV Data:\n', csvData);

        // Step 4: Prepare Claude API request with Pinecone data
        const systemPrompt = `You are a GBID converter. Use the following database to convert materials to GBID format.

DATABASE (CSV format):
${csvData}

INSTRUCTIONS:
- For each requested item, first think step by step about which items in the database are the best matches. Consider alternate names, templates, and all relevant columns.
- When multiple items have the same size or property, prefer the one whose name or alternate names most closely match the requested item type (e.g., 'bushing' for 'bang on bushing').
- If an item in the database has a Name that exactly matches the requested item, always prefer that item over others, even if other properties are similar.
- If none of the items in the database have a Name or Alternate Names that are reasonably close to the requested item, output NO BID for that item. Do not select items based only on similar properties or sizes if the name/type does not match. Only output a match if you are confident it is the correct item; otherwise, output NO BID.
- Then, give me a list of GBIDs based on the following format, using my GBID database as data. Do NOT output anything before the list. Keep notes at the end.
- If an item contains specifications, such as sizes, search broadly first.
- Assume copper for all wire unless specified as aluminum.
- If you find a row with a 'gbidTemplate' field, use the template to generate the GBID by substituting the requested size(s) into the template. For example, if the gbidTemplate is '=ASE(SIZE)X(SIZE)X(SIZE)*' and the user requests an 8x8x6 j box, output '=ASE8X8X6*' as the GBID.
- If the item has a static 'gbid', use it directly.
- If there is a footage instead of a qty, input the footage in its place (do not include measurement symbols - for example, 200' should print out as just 200).
- If there are multiple "cuts" or "rolls" of an item (namely wire), multiply the length by the amount of cuts/rolls to get the final qty (for example, 2 cuts of 400' of wire would become qty 800, 2 rolls of 500' would be qty 1000).
- Items are normally input as per item - if an item requests a number of boxes, use the properties column to determine how many qty is in each box, then output the total qty as a multiple of that.
- Use the "alternate names" column to find the closest name for items with names that do not match.
- Read the special notes column for all items before output to determine which part numbers are usually standard or if there are any special instructions.
- Read through every line and every column regardless of whether or not the item is present in the request.
- Search online for alternate or slang terms if necessary.
- Do not hallucinate part numbers if you cannot find them.
- If you cannot find the item after exhausting all options, write NO BID as the GBID and 1 as the QTY.
- Only write notes at the end of the message, do not interrupt the list. Do not output anything before the list, all notes go after.

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
                    text: systemPrompt
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
            pineconeMatches: dedupedMatches.length,
            csvData: csvData // Include for debugging if needed
        });
    } catch (error) {
        console.error('Claude API error:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
}

// Re-ranking function: prefer matches where name or alternate names include the main type from the request line
function extractType(line) {
    // Simple heuristic: last word longer than 3 chars, or last word
    const words = line.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()).filter(Boolean);
    if (words.length === 0) return '';
    for (let i = words.length - 1; i >= 0; --i) {
        if (words[i].length > 3) return words[i];
    }
    return words[words.length - 1];
}
