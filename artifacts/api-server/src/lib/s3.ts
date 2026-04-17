import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION ?? "ap-south-1";
const bucket = process.env.AWS_S3_BUCKET ?? "accionhire-recordings";

const hasCredentials =
  !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;

if (!hasCredentials) {
  console.warn(
    "[s3] AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set — recording upload disabled"
  );
}

const s3 = hasCredentials
  ? new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export function generateRecordingKey(interviewId: number): string {
  const timestamp = Date.now();
  return `recordings/interview-${interviewId}-${timestamp}.webm`;
}

export async function uploadRecording(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  if (!s3) {
    throw new Error("AWS credentials not configured");
  }
  if (!bucket) {
    throw new Error("AWS_S3_BUCKET not configured");
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(command);

  // Return the S3 object key — callers can generate presigned URLs as needed
  return key;
}

export async function getSignedUrl(key: string): Promise<string> {
  if (!s3) {
    throw new Error("AWS credentials not configured");
  }
  if (!bucket) {
    throw new Error("AWS_S3_BUCKET not configured");
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return awsGetSignedUrl(s3, command, { expiresIn: 3600 });
}

export { hasCredentials as s3Enabled };
