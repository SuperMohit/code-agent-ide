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



async function processDirectory(directoryPath: string): Promise<void> {
    try {
        const client = new ChromaClient({
            tenant: 'quest',
            database: 'questdb',
        });

        const collectionName = "python_code";
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
            try {
                console.log(`Processing file: ${filePath}`);
                await processFile(filePath, collection);
            } catch (error) {
                console.error(`Error processing ${filePath}:`, error);
            }
        }

        console.log("Completed processing directory.");
    } catch (error) {
        console.error('Error in processDirectory:', error);
        throw error;
    }
}


parentPort?.on('message', async (message: { type: 'initialize' | 'process', data: string }) => {
    try {
        if (message.type === 'initialize') {
            await initializeOpenAI(message.data);
            parentPort?.postMessage({ success: true });
        } else {
            await processDirectory(message.data);
            parentPort?.postMessage({ success: true });
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error
            ? error.message
            : String(error);
        parentPort?.postMessage({ success: false, error: errorMessage });
    }
});


