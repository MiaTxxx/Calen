import { getDocumentProxy } from "unpdf";

export interface PdfTextResult {
  text: string;
  totalPages: number;
  parsedPages: number;
  truncated: boolean;
}

export async function extractPdfPlainText(
  data: Uint8Array,
  options: { maxPages?: number; maxChars?: number } = {}
): Promise<PdfTextResult> {
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const maxChars = Math.max(1_000, options.maxChars ?? 100_000);
  const document = await getDocumentProxy(data);
  const totalPages = document.numPages;
  const pageLimit = Math.min(totalPages, maxPages);
  const pages: string[] = [];
  let length = 0;
  let parsedPages = 0;
  let truncated = totalPages > pageLimit;

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        parsedPages = pageNumber;
        const pageText = content.items
          .map((item: unknown) => {
            const value = item as { str?: unknown; hasEOL?: unknown };
            return typeof value.str === "string"
              ? `${value.str}${value.hasEOL ? "\n" : " "}`
              : "";
          })
          .join("")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/[ \t]{2,}/g, " ")
          .trim();
        if (pageText) {
          const remaining = maxChars - length;
          if (pageText.length > remaining) {
            pages.push(pageText.slice(0, remaining));
            truncated = true;
            break;
          }
          pages.push(pageText);
          length += pageText.length;
        }
        if (length >= maxChars) {
          truncated = pageNumber < totalPages;
          break;
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
  }

  return {
    text: pages
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    totalPages,
    parsedPages,
    truncated,
  };
}
