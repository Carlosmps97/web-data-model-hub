// Chat agent API endpoint - Shell implementation
// This is a placeholder that returns mock responses.
// The actual AI agent backend will be connected in a future update.
import { NextRequest } from 'next/server';
import { success, error } from '@/lib/utils/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, attachments } = body;

    if (!message && (!attachments || attachments.length === 0)) {
      return error('A message or attachment is required');
    }

    // Mock response - to be replaced with actual agent integration
    const hasAttachments = attachments && attachments.length > 0;
    const responseMessage = hasAttachments
      ? `I've received your message along with ${attachments.length} file(s). The AI agent backend is not yet connected. Once integrated, I will be able to analyze your Excel files and generate data models automatically. This feature will be available in a future update.`
      : `I've received your request: "${message}". The AI agent backend is not yet connected. Once integrated, I will be able to help you create and modify data models using natural language. This feature will be available in a future update.`;

    return success({
      message: responseMessage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return error(`Chat endpoint error: ${err}`, 500);
  }
}
