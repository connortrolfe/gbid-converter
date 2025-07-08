# THIS IS A NIGHTLY BUILD

# GBID Materials Converter

A web-based tool for converting material lists to GBID format using Pinecone vector database and Claude AI.

## Features

- **Semantic Search**: Uses Pinecone vector database to find relevant materials based on natural language input
- **AI Processing**: Leverages Claude AI to convert material descriptions to GBID format
- **Real-time Database**: Direct connection to Pinecone for up-to-date material information
- **Web Interface**: Clean, modern UI for easy material conversion

## Environment Variables

The following environment variables must be configured:

### Required
- `PINECONE_API_KEY`: Your Pinecone API key
- `PINECONE_HOST`: Your Pinecone host URL (e.g., `gbid-database-xxxxx.svc.us-east1-gcp.pinecone.io`)
- `PINECONE_INDEX`: Your Pinecone index name (defaults to `gbid-database`)
- `OPENAI_API_KEY`: Your OpenAI API key for generating embeddings
- `CLAUDE_API_KEY`: Your Anthropic Claude API key

### Optional
- `PINECONE_INDEX`: Override the default index name

## API Endpoints

### `/api/claude`
- **Method**: POST
- **Purpose**: Convert material input to GBID format using Pinecone search and Claude AI
- **Body**: `{ "materialInput": "your material description" }`
- **Returns**: GBID conversion results with Pinecone match count

### `/api/cache-status`
- **Method**: GET
- **Purpose**: Get Pinecone database statistics
- **Query**: `?index=your-index-name`
- **Returns**: Database status and vector statistics

## How It Works

1. **Input Processing**: User enters material descriptions in natural language
2. **Embedding Generation**: OpenAI creates vector embeddings for the input text
3. **Semantic Search**: Pinecone finds the most similar materials in the database
4. **CSV Formatting**: Relevant materials are formatted as CSV for Claude
5. **AI Conversion**: Claude processes the materials and outputs GBID format
6. **Results Display**: Formatted GBID results are shown to the user

## Database Schema

The Pinecone database should contain vectors with the following metadata:
- `gbid`: The GBID part number
- `description`: Material description
- `properties`: Additional properties (quantity per box, etc.)
- `alternateNames`: Alternative names for the material
- `specialNotes`: Special instructions or notes

## Deployment

This application is designed to be deployed on Vercel or similar serverless platforms. Make sure to configure all required environment variables in your deployment platform.

## Usage

1. Configure your Pinecone database with material vectors
2. Set up environment variables
3. Deploy the application
4. Test the connection using the "Test Pinecone Connection" button
5. Enter material descriptions and convert to GBID format 
