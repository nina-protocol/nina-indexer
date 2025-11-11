import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure ffmpeg path if needed
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

/**
 * Extract segment number from filename
 * @param {string} filename - e.g., "surfing_on_sawtooth_001.m4s"
 * @returns {number} - e.g., 1
 */
export const extractSegmentNumber = (filename) => {
  const match = filename.match(/(\d+)\.m4s$/);
  if (!match) {
    throw new Error(`Invalid segment filename format: ${filename}`);
  }
  return parseInt(match[1], 10);
};

/**
 * Fetch file from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<Buffer>} - File content as buffer
 */
export const fetchFromS3 = async (bucket, key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('No body in S3 response');
    }
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error(`Error fetching from S3: ${error.message}`);
    throw new Error(`Failed to fetch file from S3: ${error.message}`);
  }
};

/**
 * Generate DASH segment using FFmpeg
 * @param {Buffer} audioBuffer - Original audio file buffer
 * @param {number} segmentNumber - Segment number (1-based)
 * @param {number} segmentDuration - Duration in seconds (default: 4)
 * @returns {Promise<Buffer>} - Generated segment buffer
 */
export const generateSegment = async (audioBuffer, segmentNumber, segmentDuration = 4) => {
  const tempDir = tmpdir();
  const inputPath = join(tempDir, `input_${uuidv4()}.mp3`);
  const outputPath = join(tempDir, `output_${uuidv4()}.m4s`);
  
  try {
    // Write input buffer to temporary file
    await writeFile(inputPath, audioBuffer);
    
    // Calculate start time for segment
    const startTime = (segmentNumber - 1) * segmentDuration;
    
    // Generate segment using FFmpeg
    const segmentBuffer = await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions([`-ss ${startTime}`])
        .outputOptions([
          `-t ${segmentDuration}`,
          '-c:a aac',
          '-b:a 128k',
          '-f mp4',
          '-movflags frag_keyframe+empty_moov'
        ])
        .output(outputPath)
        .on('end', async () => {
          try {
            const segmentBuffer = await readFile(outputPath);
            resolve(segmentBuffer);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(new Error(`FFmpeg error: ${error.message}`));
        })
        .run();
    });
    
    return segmentBuffer;
  } finally {
    // Clean up temporary files
    try {
      await unlink(inputPath);
      await unlink(outputPath);
    } catch (error) {
      console.warn('Failed to clean up temporary files:', error.message);
    }
  }
};

/**
 * Process DASH segment request
 * @param {string} releaseId - Release UUID
 * @param {string} filename - Segment filename
 * @param {string} s3Bucket - S3 bucket name
 * @param {string} s3Key - S3 object key for original audio file
 * @returns {Promise<Buffer>} - Generated segment buffer
 */
export const processDashSegment = async (releaseId, filename, s3Bucket, s3Key) => {
  try {
    // Extract segment number from filename
    const segmentNumber = extractSegmentNumber(filename);
    
    // Fetch original audio file from S3
    const audioBuffer = await fetchFromS3(s3Bucket, s3Key);
    
    // Generate the specific segment
    const segmentBuffer = await generateSegment(audioBuffer, segmentNumber);
    
    return segmentBuffer;
  } catch (error) {
    console.error(`Error processing DASH segment for release ${releaseId}:`, error);
    throw error;
  }
};

/**
 * Get S3 configuration for a release
 * @param {Object} release - Release object with metadata
 * @returns {Object|null} - S3 configuration or null if not found
 */
export const getS3ConfigForRelease = (release) => {
  try {
    // Look for DASH configuration in metadata
    const dashConfig = release.metadata?.properties?.dash;
    
    if (dashConfig?.s3Bucket && dashConfig?.s3Key) {
      return {
        bucket: dashConfig.s3Bucket,
        key: dashConfig.s3Key,
      };
    }
    
    // Look for original audio file in files array (not DASH files)
    const audioFile = release.metadata?.properties?.files?.find(
      file => (file.type === 'audio/mpeg' || file.type === 'audio/wav' || file.type === 'audio/mp3') && !file.isDash
    );
    
    if (audioFile?.uri) {
      // Parse S3 URI if it's in s3:// format
      const s3Match = audioFile.uri.match(/^s3:\/\/([^\/]+)\/(.+)$/);
      if (s3Match) {
        return {
          bucket: s3Match[1],
          key: s3Match[2],
        };
      }
      
      // Parse S3 URI if it's in https:// format
      const httpsMatch = audioFile.uri.match(/^https:\/\/nina-file-service\.s3\.([^.]+)\.amazonaws\.com\/(.+)$/);
      if (httpsMatch) {
        return {
          bucket: `nina-file-service.s3.${httpsMatch[1]}.amazonaws.com`,
          key: httpsMatch[2],
        };
      }
    }
    
    // Look for DASH files to indicate this is a DASH release
    const dashFiles = release.metadata?.properties?.files?.filter(
      file => file.isDash === true || file.type === 'application/dash+xml'
    );
    
    if (dashFiles && dashFiles.length > 0) {
      console.log('DASH files found but no original audio file for segment generation');
      // For now, return null since we need original audio to generate segments
      return null;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting S3 config for release:', error);
    return null;
  }
}; 