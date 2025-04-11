import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { ChromaClient, Collection } from 'chromadb';
import { parentPort } from 'worker_threads';


let openai: OpenAI;

async function initializeOpenAI(apiKey: string) {
    if (!apiKey) {
        throw new Error('OpenAI API key is not configured');
    }
    openai = new OpenAI({
        apiKey
    });
}

async function computeEmbedding(text: string): Promise<number[]> {
    try {
        const embedding = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        return embedding.data[0].embedding;
    } catch (error) {
        console.error('Error computing embedding:', error);
        throw error;
    }
}

function getFiles(dir: string): string[] {
    let files: string[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            files = files.concat(getFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}



async function processFile(filePath: string, collection: Collection) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const chunkSize = 200;
        const totalChunks = Math.ceil(lines.length / chunkSize);

        let ids: string[] = [];
        let embeddings: number[][] = [];
        let metadatas: any[] = [];
        let documents: string[] = [];

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, lines.length);
            const chunkLines = lines.slice(start, end);
            const chunkText = chunkLines.join('\n');
            const id = `${filePath}_chunk_${i + 1}`;
            ids.push(id);
            documents.push(chunkText);

            console.log(`Processing chunk ${i + 1} of ${totalChunks} for file: ${filePath}`);
            console.log(`Chunk ID: ${id}`);
            console.log(`Chunk text length: ${chunkText.length}`);

            const embedding = await computeEmbedding(chunkText);
            embeddings.push(embedding);

            // Create metadata object with chapter and verse information
            const metadata = {
                chapter: Math.floor(i / 10) + 1, // Simple chapter calculation
                verse: (i % 10) + 1              // Simple verse calculation
            };
            metadatas.push(metadata);

            console.log(`Metadata for chunk ${i + 1}:`, metadata);
        }

        // Log all data before adding to collection
        console.log('Adding to collection:');
        console.log('IDs:', ids);
        console.log('Embeddings:', embeddings);
        console.log((`Embedding dimension: ${embeddings.length}`))
        console.log('Metadatas:', metadatas);
        console.log('Documents:', documents);

        await collection.add({
            ids,
            embeddings,
            metadatas,
            documents
        });

        console.log('Successfully added to collection');
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
        throw error;
    }
}


const processedFiles = new Set<string>();  // Track the processed files

async function processDirectory(directoryPath: string, projectPath: string): Promise<void> {
    try {
        const client = new ChromaClient({
            tenant: 'quest',
            database: 'questdb',
        });

        let collectionName = projectPath
            .replace(/[^a-zA-Z0-9._-]/g, '') // Remove invalid characters
            .replace(/ /g, '_') // Replace spaces with underscores
            .toLowerCase(); // Convert to lowercase

        // Add prefix if too short
        if (collectionName.length < 3) {
            collectionName = `proj_${collectionName}`;
        }

        // Truncate if too long
        if (collectionName.length > 63) {
            collectionName = collectionName.substring(0, 63);
        }

        // Ensure it starts and ends with a valid character
        if (!/^[a-zA-Z0-9]/.test(collectionName)) {
            collectionName = `p_${collectionName}`;
        }
        if (!/[a-zA-Z0-9]$/.test(collectionName)) {
            collectionName = `${collectionName}_p`;
        }

        console.log(`Using collection name: ${collectionName}`);
        
        let collection: Collection;
        
        // Check if the collection already exists
        try {
            collection = await client.getCollection({ name: collectionName } as any);
            console.log(`Using existing collection: ${collectionName}`);
        } catch (e) {
            console.log(`Collection does not exist. Creating a new one: ${collectionName}`);
            // Create the collection with the correct embedding dimension
            collection = await client.createCollection({
                name: collectionName,
                embeddingFunction: computeEmbedding as any,
                metadata: { embeddingDimension: 1536 } // Ensure correct dimension
            });
            console.log(`Created collection: ${collectionName} with embedding dimension 1536`);
        }

        const files = getFiles(directoryPath);
        for (const filePath of files) {
            if (processedFiles.has(filePath)) {
                console.log(`Skipping already processed file: ${filePath}`)
                continue;
            }

            try {
                console.log(`Processing file: ${filePath}`);
                await processFile(filePath, collection);
                processedFiles.add(filePath);    // Mark the file as processed
            } catch (error) {
                console.error(`Error processing ${filePath}:`, error)
            }
        }

        console.log("Completed processing directory.");
    } catch (error) {
        console.error('Error in processDirectory:', error);
        throw error;
    }
}


parentPort?.on('message', async (message: { 
    type: 'initialize' | 'process', 
    data: { 
        apiKey?: string;
        projectPath: string;
        directoryPath?: string;
    } 
}) => {
    try {
        if (message.type === 'initialize') {
            if (!message.data.apiKey) {
                throw new Error('OpenAI API key is required');
            }
            await initializeOpenAI(message.data.apiKey);
            parentPort?.postMessage({ success: true });
        } else {
            if (!message.data.directoryPath) {
                throw new Error('Directory path is required');
            }
            await processDirectory(message.data.directoryPath, message.data.projectPath);
            parentPort?.postMessage({ success: true });
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : String(error);
        parentPort?.postMessage({ success: false, error: errorMessage });
    }
});


