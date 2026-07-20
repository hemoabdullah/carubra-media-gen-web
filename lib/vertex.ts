import { VertexAI } from '@google-cloud/vertexai';
import * as path from 'path';
import * as fs from 'fs';
import { Storage } from '@google-cloud/storage';

// Environment variables are loaded by Next.js (server-side)

/**
 * Get Vertex AI configuration dynamically from environment variables
 * This ensures environment variables are read at runtime, not module load time
 */
export function getConfig() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  
  // Resolve relative paths to absolute paths
  let resolvedCredentialsPath = credentialsPath;
  if (credentialsPath && !path.isAbsolute(credentialsPath)) {
    resolvedCredentialsPath = path.resolve(process.cwd(), credentialsPath);
  }

  return {
    project: process.env.GOOGLE_CLOUD_PROJECT || '',
    location: process.env.VERTEX_LOCATION || 'us-central1',
    model: process.env.VERTEX_MODEL || 'veo-2.0-generate-001',
    credentialsPath: resolvedCredentialsPath,
    outputGcsUri: process.env.VERTEX_OUTPUT_GCS_URI || '',
  };
}

/**
 * Initialize Vertex AI client
 * This function creates a new VertexAI instance with configuration from environment variables
 */
export function initializeVertexAI(): VertexAI {
  const config = getConfig();
  
  console.log('[vertex.ts] DEBUG - Environment variables:', {
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    VERTEX_MODEL: process.env.VERTEX_MODEL,
    resolvedCredentialsPath: config.credentialsPath,
  });

  if (!config.project) {
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required');
  }

  const vertexAI = new VertexAI({
    project: config.project,
    location: config.location,
  });

  return vertexAI;
}

/**
 * Get the generative model for video generation
 * @returns The configured generative model instance
 */
export function getGenerativeModel() {
  const config = getConfig();
  const vertexAI = initializeVertexAI();
  const model = vertexAI.getGenerativeModel({
    model: config.model,
  });

  return model;
}

/**
 * Get current Vertex AI configuration
 * Useful for debugging and validation
 */
export function getVertexConfig() {
  const config = getConfig();
  
  // Check if credentials file exists
  let credentialsFileExists = false;
  if (config.credentialsPath) {
    try {
      credentialsFileExists = fs.existsSync(config.credentialsPath);
    } catch (e) {
      credentialsFileExists = false;
    }
  }

  return {
    project: config.project,
    location: config.location,
    model: config.model,
    credentialsPath: config.credentialsPath,
    hasCredentials: !!config.credentialsPath,
    credentialsFileExists,
  };
}

/**
 * Validate Vertex AI configuration
 * Throws an error if required configuration is missing
 */
export function validateVertexConfig(): void {
  const config = getConfig();
  const errors: string[] = [];

  if (!config.project) {
    errors.push('GOOGLE_CLOUD_PROJECT is required');
  }

  if (!config.location) {
    errors.push('VERTEX_LOCATION is required');
  }

  if (!config.model) {
    errors.push('VERTEX_MODEL is required');
  }

  // For Vercel/serverless deployments, credentials may be provided via ADC
  // or workload identity federation instead of a local file.
  if (!config.credentialsPath) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS is required');
  } else if (config.credentialsPath) {
    try {
      if (!fs.existsSync(config.credentialsPath)) {
        // File doesn't exist locally - this is expected on Vercel where ADC is used
        console.warn(`[vertex.ts] Credentials file not found: ${config.credentialsPath}. Using Application Default Credentials (ADC) if available.`)
      }
    } catch {
      // fs may not be available in all runtimes
    }
  }

  if (!config.outputGcsUri) {
    errors.push('VERTEX_OUTPUT_GCS_URI is required (Cloud Storage URI for video output)');
  }

  if (errors.length > 0) {
    throw new Error(`Vertex AI configuration error: ${errors.join(', ')}`);
  }
}

/**
 * Get the Vertex AI REST API endpoint for video generation
 * This is used by the video generation routes that use the REST API
 */
export function getVideoGenerationEndpoint(): string {
  const config = getConfig();
  return `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.project}/locations/${config.location}/publishers/google/models/${config.model}:predictLongRunning`;
}

/**
 * Get the Vertex AI REST API endpoint for fetching operation status
 * For Veo video generation, we use the fetchPredictOperation endpoint
 * Format: https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:fetchPredictOperation
 */
export function getOperationEndpoint(operationName: string): string {
  const config = getConfig();
  return `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.project}/locations/${config.location}/publishers/google/models/${config.model}:fetchPredictOperation`;
}

/**
 * Generate a signed URL for a GCS object
 * @param gcsUri - The GCS URI (e.g., gs://bucket-name/path/to/file.mp4)
 * @returns A signed URL valid for 24 hours
 */
export async function getSignedUrl(gcsUri: string): Promise<string> {
  const config = getConfig();
  
  // Parse the GCS URI
  const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  
  const bucketName = match[1];
  const fileName = match[2];
  
  // Initialize Storage client (uses ADC if no keyFilename provided)
  const storageOptions: Record<string, string> = {}
  if (config.credentialsPath) {
    storageOptions.keyFilename = config.credentialsPath
  }
  const storage = new Storage(storageOptions);
  
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);
  
  // Generate signed URL valid for 24 hours
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  });
  
  return signedUrl;
}
