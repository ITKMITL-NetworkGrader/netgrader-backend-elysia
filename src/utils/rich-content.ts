import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

export interface RichContent {
  html: string;
  json: any;
  plainText: string;
  metadata: {
    wordCount: number;
    characterCount: number;
    estimatedReadingTime: number;
    lastModified: Date;
    hasImages: boolean;
    hasCodeBlocks: boolean;
    headingStructure: Array<{ level: number; text: string; id: string }>;
  };
}

export function extractPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function countCharacters(text: string): number {
  return text.length;
}

export function estimateReadingTime(wordCount: number): number {
  return Math.ceil(wordCount / 200);
}

const generateHeadingId = (text: string, index: number): string => {
  if (!text) {
    return `heading-${index + 1}`;
  }

  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z0-9ก-๙]+/g, "-") // keep alphanumeric + Thai characters
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized;
  }

  return `heading-${index + 1}`;
};

export function extractHeadingStructure(json: any): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = [];

  function traverse(node: any, headingIndex: { value: number }) {
    if (node.type === 'heading' && node.content) {
      const text = node.content.map((n: any) => n.text || '').join('');
      const id = generateHeadingId(text, headingIndex.value);

      headings.push({
        level: node.attrs?.level || 1,
        text: text,
        id: id
      });

      headingIndex.value += 1;
    }

    if (node.content) {
      node.content.forEach((child: any) => traverse(child, headingIndex));
    }
  }

  if (json.content) {
    const headingIndex = { value: 0 };
    json.content.forEach((node: any) => traverse(node, headingIndex));
  }

  return headings;
}

export function hasImages(json: any): boolean {
  function traverse(node: any): boolean {
    if (node.type === 'image') {
      return true;
    }
    if (node.content) {
      return node.content.some(traverse);
    }
    return false;
  }

  return json.content ? json.content.some(traverse) : false;
}

export function hasCodeBlocks(json: any): boolean {
  function traverse(node: any): boolean {
    if (node.type === 'codeBlock') {
      return true;
    }
    if (node.content) {
      return node.content.some(traverse);
    }
    return false;
  }

  return json.content ? json.content.some(traverse) : false;
}

export function processRichContent(html: string, json: any): RichContent {
  // DSEC-02: Sanitize HTML before storing to prevent XSS
  const sanitizedHtml = DOMPurify.sanitize(html);

  const plainText = extractPlainText(sanitizedHtml);
  const wordCount = countWords(plainText);
  const characterCount = countCharacters(plainText);
  const estimatedReadingTime = estimateReadingTime(wordCount);
  const headingStructure = extractHeadingStructure(json);

  return {
    html: sanitizedHtml,
    json,
    plainText,
    metadata: {
      wordCount,
      characterCount,
      estimatedReadingTime,
      lastModified: new Date(),
      hasImages: hasImages(json),
      hasCodeBlocks: hasCodeBlocks(json),
      headingStructure
    }
  };
}
