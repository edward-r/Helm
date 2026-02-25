import { GoogleAIFileManager } from '@google/generative-ai/server'

import { resolveGeminiCredentials } from '../../../../config'

export const uploadToGemini = async (filePath: string, mimeType: string): Promise<string> => {
  const credentials = await resolveGeminiCredentials()
  const fileManager = new GoogleAIFileManager(credentials.apiKey)
  const filename = filePath.split(/[/]/).pop() || 'Uploaded File'
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: filename
  })
  let file = await fileManager.getFile(uploadResult.file.name)
  while (file.state === 'PROCESSING') {
    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    file = await fileManager.getFile(uploadResult.file.name)
  }
  if (file.state === 'FAILED') {
    throw new Error('Gemini failed to process the media file.')
  }
  return file.uri
}
