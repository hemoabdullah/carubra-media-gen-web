import { getConfig, getVideoGenerationEndpoint, getOperationEndpoint, validateVertexConfig } from './vertex'

export interface VertexConfig {
  project: string
  location: string
  model: string
  credentialsPath: string
  outputGcsUri: string
}

export function extractOperationName(responseData: any): string {
  if (!responseData || typeof responseData !== 'object') {
    throw new Error(`Invalid Vertex AI response: ${JSON.stringify(responseData)}`)
  }

  if (typeof responseData.name === 'string' && responseData.name) {
    return responseData.name
  }

  if (responseData.operation) {
    if (typeof responseData.operation.name === 'string' && responseData.operation.name) {
      return responseData.operation.name
    }
    if (typeof responseData.operation === 'string' && responseData.operation) {
      return responseData.operation
    }
  }

  if (responseData.metadata?.operation?.name) {
    return responseData.metadata.operation.name
  }

  const possibleFields = ['operationName', 'opName', 'id', 'operationId', 'jobId', 'job_id']
  for (const field of possibleFields) {
    if (typeof responseData[field] === 'string' && responseData[field]) {
      return responseData[field]
    }
  }

  throw new Error(
    `Cannot extract operation name from Vertex AI response. ` +
    `Top-level keys: ${Object.keys(responseData).join(', ')}. ` +
    `Full response: ${JSON.stringify(responseData)}`
  )
}

export function normalizeOperationName(opName: string, config: VertexConfig): string {
  if (opName.startsWith('projects/')) {
    return opName
  }

  if (opName.startsWith('http://') || opName.startsWith('https://')) {
    try {
      const url = new URL(opName)
      const path = url.pathname.replace(/^\/v1beta[0-9]?\//, '/v1/').replace(/^\/v1\//, '')
      if (path.startsWith('projects/')) {
        return path
      }
      if (path && !path.includes('/')) {
        return `projects/${config.project}/locations/${config.location}/operations/${path}`
      }
    } catch {
    }
  }

  if (!opName.includes('/')) {
    return `projects/${config.project}/locations/${config.location}/operations/${opName}`
  }

  if (opName.startsWith('operations/')) {
    return `projects/${config.project}/locations/${config.location}/${opName}`
  }

  return opName
}

export function toModelScopedOperationName(opName: string, model: string): string {
  const pattern = /^(projects\/[^/]+\/locations\/[^/]+)\/operations\/(.+)$/
  const match = opName.match(pattern)
  if (!match) return opName
  return `${match[1]}/publishers/google/models/${model}/operations/${match[2]}`
}

export async function getVertexAccessToken(config: VertexConfig): Promise<string> {
  const { GoogleAuth } = require('google-auth-library')
  const authOptions: Record<string, any> = {
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  }
  if (config.credentialsPath) {
    authOptions.keyFilename = config.credentialsPath
  }
  const auth = new GoogleAuth(authOptions)
  const client = await auth.getClient()
  return (await client.getAccessToken()).token
}

export async function generateVideoWithVertex(
  prompt: string,
  resolution: string,
  aspectRatio: string,
  duration: number,
  model: string,
  sourceImage?: string | null
): Promise<{ jobId: string }> {
  console.log('[video-gen] ===== VERTEX GENERATION START =====')

  validateVertexConfig()

  const config = getConfig()
  const endpoint = getVideoGenerationEndpoint()
  const outputGcsUri = config.outputGcsUri

  console.log('[video-gen] Config:', JSON.stringify({
    project: config.project,
    location: config.location,
    model: config.model,
    outputGcsUri,
    endpoint,
  }))

  if (!outputGcsUri) {
    throw new Error('VERTEX_OUTPUT_GCS_URI environment variable is required')
  }

  let providerAspectRatio = '16:9'
  if (aspectRatio === '9:16' || aspectRatio === '3:4') {
    providerAspectRatio = '9:16'
  } else if (aspectRatio === '1:1') {
    providerAspectRatio = '16:9'
  }

  const requestBody = {
    instances: [
      {
        prompt,
        ...(sourceImage ? {
          image: {
            bytesBase64Encoded: sourceImage,
            mimeType: "image/jpeg"
          }
        } : {}),
      }
    ],
    parameters: {
      storageUri: outputGcsUri,
      sampleCount: 1,
      aspectRatios: [providerAspectRatio],
    }
  }

  console.log('[video-gen] Getting access token...')
  let accessToken: string
  try {
    accessToken = await getVertexAccessToken(config)
    console.log('[video-gen] Access token obtained (length:', accessToken.length, ')')
  } catch (authErr: any) {
    throw new Error(`Vertex AI authentication failed: ${authErr.message}`)
  }

  console.log('[video-gen] Calling Vertex AI endpoint:', endpoint)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
  } catch (fetchErr: any) {
    throw new Error(`Vertex AI network error: ${fetchErr.message}`)
  }

  console.log('[video-gen] Response status:', response.status)
  const responseText = await response.text()
  console.log('[video-gen] FULL response body:', responseText)

  if (!response.ok) {
    throw new Error(`Vertex AI API error (${response.status}): ${responseText}`)
  }

  let responseData: any
  try {
    responseData = JSON.parse(responseText)
  } catch {
    throw new Error(`Vertex AI returned invalid JSON: ${responseText}`)
  }

  console.log('[video-gen] Parsed response keys:', Object.keys(responseData))
  console.log('[video-gen] Response done:', responseData.done)

  const rawOpName = extractOperationName(responseData)
  console.log('[video-gen] Raw operation name from response:', rawOpName)

  const normalizedOpName = normalizeOperationName(rawOpName, config)
  const finalJobId = normalizedOpName !== rawOpName ? normalizedOpName : rawOpName
  if (normalizedOpName !== rawOpName) {
    console.log('[video-gen] Normalized operation name:', rawOpName, '->', normalizedOpName)
  }

  console.log('[video-gen] Final jobId to store:', finalJobId)
  console.log('[video-gen] ===== VERTEX GENERATION SUCCESS =====')

  return { jobId: finalJobId }
}

export async function pollVertexOperation(
  jobId: string,
  config: VertexConfig,
  accessToken: string
): Promise<{ data: any; strategy: string }> {
  console.log('[video-gen/poll] ===== POLL OPERATION START =====')
  console.log('[video-gen/poll] Job ID from DB:', jobId)
  console.log('[video-gen/poll] Project:', config.project)
  console.log('[video-gen/poll] Location:', config.location)
  console.log('[video-gen/poll] Model:', config.model)

  let pollData: any = null
  let pollingStrategy = 'none'

  const normalizedOpName = normalizeOperationName(jobId, config)
  if (normalizedOpName !== jobId) {
    console.log('[video-gen/poll] Normalized job ID:', jobId, '->', normalizedOpName)
  }

  const modelScopedOpName = toModelScopedOperationName(normalizedOpName, config.model)
  console.log('[video-gen/poll] Model-scoped operation name:', modelScopedOpName)

  try {
    const fetchPredictUrl = getOperationEndpoint()
    console.log('[video-gen/poll] Strategy 1 URL:', fetchPredictUrl)
    console.log('[video-gen/poll] Strategy 1 request body:', JSON.stringify({ operationName: modelScopedOpName }))

    const pollRes = await fetch(fetchPredictUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operationName: modelScopedOpName }),
    })

    console.log('[video-gen/poll] Strategy 1 response status:', pollRes.status)

    if (pollRes.ok) {
      pollData = await pollRes.json()
      pollingStrategy = 'fetchPredictOperation'
      console.log('[video-gen/poll] Strategy 1 response body:', JSON.stringify(pollData))
    } else {
      const errText = await pollRes.text()
      console.error('[video-gen/poll] Strategy 1 FAILED:', pollRes.status)
      console.error('[video-gen/poll] Strategy 1 response body:', errText)

      if (pollRes.status === 404) {
        console.error('[video-gen/poll] 404 DIAGNOSIS:')
        console.error('  operationName used:', normalizedOpName)
        console.error('  Possible causes:')
        console.error('    1. Operation name is invalid or malformed')
        console.error('    2. The :fetchPredictOperation endpoint does not exist for this model')
        console.error('    3. Wrong project/location in endpoint URL')
        console.error('    4. Operation no longer exists')
      } else if (pollRes.status === 403) {
        throw new Error(`Vertex AI 403 Forbidden - check service account permissions. Response: ${errText}`)
      } else if (pollRes.status === 400) {
        throw new Error(`Vertex AI 400 Bad Request: ${errText}`)
      }
    }
  } catch (pollErr: any) {
    if (pollErr.message?.startsWith('Vertex AI')) throw pollErr
    console.warn('[video-gen/poll] Strategy 1 threw:', pollErr.message)
  }

  if (!pollData) {
    try {
      const lroUrl = `https://${config.location}-aiplatform.googleapis.com/v1/${normalizedOpName}`
      console.log('[video-gen/poll] Strategy 2 URL:', lroUrl)

      const lroRes = await fetch(lroUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })

      console.log('[video-gen/poll] Strategy 2 response status:', lroRes.status)

      if (lroRes.ok) {
        pollData = await lroRes.json()
        pollingStrategy = 'lroGet'
        console.log('[video-gen/poll] Strategy 2 response body:', JSON.stringify(pollData))
      } else {
        const errText = await lroRes.text()
        console.error('[video-gen/poll] Strategy 2 FAILED:', lroRes.status)
        console.error('[video-gen/poll] Strategy 2 response body:', errText)

        if (lroRes.status === 404) {
          console.error('[video-gen/poll] Strategy 2 404 DIAGNOSIS:')
          console.error('  URL:', lroUrl)
          console.error('  This confirms the operation path does not resolve.')
          console.error('  The stored job_id is likely incorrect.')
        }
      }
    } catch (lroErr: any) {
      console.warn('[video-gen/poll] Strategy 2 threw:', lroErr.message)
    }
  }

  if (!pollData) {
    console.error('[video-gen/poll] BOTH STRATEGIES FAILED')
    console.error('[video-gen/poll] jobId from DB:', jobId)
    console.error('[video-gen/poll] normalizedOpName:', normalizedOpName)
    throw new Error(
      `Vertex AI polling failed for operation "${normalizedOpName}". ` +
      `Both :fetchPredictOperation and standard LRO GET returned errors. ` +
      `Check that the operation name is correct and the operation still exists.`
    )
  }

  console.log('[video-gen/poll] Polling strategy used:', pollingStrategy)
  console.log('[video-gen/poll] Operation done:', pollData.done)
  if (pollData.done) {
    console.log('[video-gen/poll] Operation error:', pollData.error ? JSON.stringify(pollData.error) : 'none')
  }

  return { data: pollData, strategy: pollingStrategy }
}

export async function downloadFromGCS(gcsUri: string, config: VertexConfig): Promise<Buffer> {
  console.log('[video-gen] Downloading video from GCS:', gcsUri)

  const { Storage } = require('@google-cloud/storage')
  const storage = new Storage({
    ...(config.credentialsPath ? { keyFilename: config.credentialsPath } : {})
  })

  const bucketName = gcsUri.match(/gs:\/\/([^\/]+)/)?.[1]
  const objectPath = gcsUri.match(/gs:\/\/[^\/]+\/(.+)/)?.[1]

  if (!bucketName || !objectPath) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`)
  }

  console.log('[video-gen] GCS bucket:', bucketName, 'path:', objectPath)

  const bucket = storage.bucket(bucketName)
  const file = bucket.file(objectPath)

  const [exists] = await file.exists()
  if (!exists) {
    throw new Error(`Video file not found in GCS: ${gcsUri}`)
  }

  const [buffer] = await file.download()
  console.log('[video-gen] GCS download SUCCESS:', buffer.length, 'bytes')
  return buffer
}

export async function listGCSVideos(sessionId: string, config: VertexConfig): Promise<string[]> {
  console.log('[video-gen] Listing GCS videos for session recovery')
  const { Storage } = require('@google-cloud/storage')
  const storage = new Storage({
    ...(config.credentialsPath ? { keyFilename: config.credentialsPath } : {})
  })

  const gcsUri = config.outputGcsUri
  const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/)
  if (!match) {
    console.error('[video-gen] Invalid outputGcsUri:', gcsUri)
    return []
  }

  const bucketName = match[1]
  const prefix = match[2]
  const bucket = storage.bucket(bucketName)

  try {
    const [files] = await bucket.getFiles({ prefix })
    const uris = files.map((f: any) => `gs://${bucketName}/${f.name}`)
    console.log('[video-gen] Found', uris.length, 'files in GCS bucket')
    return uris
  } catch (err: any) {
    console.error('[video-gen] Failed to list GCS files:', err.message)
    return []
  }
}
