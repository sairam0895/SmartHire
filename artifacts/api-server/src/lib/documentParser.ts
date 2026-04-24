// @ts-ignore -- pdf-parse is CJS-only; no ESM default export declaration
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType.includes("pdf")) {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }
  if (mimeType.includes("word") || mimeType.includes("docx") || mimeType.includes("openxmlformats")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  return buffer.toString("utf-8").trim();
}
