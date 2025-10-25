import type { BucketItem } from 'minio';
import yaml from 'js-yaml';
import { env } from 'process';
import { getMinioClient, BUCKET_NAME } from '../../config/minio';

export type TemplateSource = 'mongo' | 'minio';

export interface NormalizedParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
}

export interface NormalizedDefaultTestCase {
  comparison_type: string;
  expected_result: any;
}

export interface CustomTaskTemplate {
  id: string;
  templateId: string;
  name: string;
  description: string;
  parameterSchema: NormalizedParameter[];
  defaultTestCases: NormalizedDefaultTestCase[];
  source: TemplateSource;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: {
    bucket: string;
    objectName: string;
    etag?: string;
    versionId?: string;
    lastModified?: Date;
  };
}

interface CacheEntry {
  data: CustomTaskTemplate[];
  expiresAt: number;
}

const CUSTOM_TASK_PREFIX = env.MINIO_TASK_TEMPLATE_PREFIX || 'custom_tasks';
const CACHE_TTL_MS = Number(env.CUSTOM_TASK_TEMPLATE_CACHE_TTL ?? 5 * 60 * 1000);

let cache: CacheEntry | null = null;

export async function getAllCustomTaskTemplates(): Promise<CustomTaskTemplate[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  try {
    const client = getSafeMinioClient();
    if (!client) {
      return [];
    }

    const objects = await listObjects(client);
    const templates: CustomTaskTemplate[] = [];

    for (const item of objects) {
      if (!item.name || !item.name.match(/\.(ya?ml)$/i)) {
        continue;
      }

      try {
        const parsed = await loadAndParseTemplate(client, item.name);
        const normalized = normalizeTemplate(parsed, item);
        if (normalized) {
          templates.push(normalized);
        }
      } catch (error) {
        console.error(`Failed to load custom task template '${item.name}':`, (error as Error).message);
      }
    }

    cache = {
      data: templates,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return templates;
  } catch (error) {
    console.error('Failed to fetch custom task templates from MinIO:', (error as Error).message);
    return [];
  }
}

export async function getCustomTaskTemplateByTemplateId(templateId: string): Promise<CustomTaskTemplate | null> {
  const templates = await getAllCustomTaskTemplates();
  return templates.find((template) => template.templateId === templateId) ?? null;
}

export async function getCustomTaskTemplateById(id: string): Promise<CustomTaskTemplate | null> {
  const templates = await getAllCustomTaskTemplates();
  return templates.find((template) => template.id === id) ?? null;
}

export function clearCustomTaskTemplateCache(): void {
  cache = null;
}

function getSafeMinioClient() {
  try {
    return getMinioClient();
  } catch (error) {
    console.warn('MinIO not configured, skipping custom task template load:', (error as Error).message);
    return null;
  }
}

type MinioClient = ReturnType<typeof getMinioClient>;

async function listObjects(client: MinioClient): Promise<BucketItem[]> {
  return new Promise((resolve, reject) => {
    const items: BucketItem[] = [];
    const stream = client.listObjectsV2(BUCKET_NAME, CUSTOM_TASK_PREFIX, true);

    stream.on('data', (item: BucketItem) => {
      if (item) {
        items.push(item);
      }
    });

    stream.on('error', (error: unknown) => {
      reject(error);
    });

    stream.on('end', () => {
      resolve(items);
    });
  });
}

async function loadAndParseTemplate(client: MinioClient, objectName: string) {
  const data = await loadObjectData(client, objectName);
  return yaml.load(data) as Record<string, any>;
}

async function loadObjectData(client: MinioClient, objectName: string): Promise<string> {
  const stream = await client.getObject(BUCKET_NAME, objectName);
  const chunks: Buffer[] = [];

  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else if (chunk) {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks).toString('utf-8');
}

function normalizeTemplate(raw: Record<string, any>, item: BucketItem): CustomTaskTemplate | null {
  const templateId = raw?.task_name || raw?.templateId || raw?.name;
  if (!templateId) {
    console.warn(`Custom task template '${item.name}' is missing 'task_name/templateId'. Skipping.`);
    return null;
  }

  const name = raw?.display_name || raw?.name || templateId;
  const description = raw?.description || '';

  const parameterSchema = Array.isArray(raw?.parameters)
    ? raw.parameters
        .map((parameter: any) => normalizeParameter(parameter))
        .filter(Boolean) as NormalizedParameter[]
    : [];

  const defaultTestCases = normalizeValidation(raw?.validation);

  const timestamp = item.lastModified ? new Date(item.lastModified) : new Date();

  const versionId = (item as Record<string, any>)?.versionId;

  return {
    id: templateId,
    templateId,
    name,
    description,
    parameterSchema,
    defaultTestCases,
    source: 'minio',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      bucket: BUCKET_NAME,
      objectName: item.name ?? templateId,
      etag: item.etag,
      versionId: typeof versionId === 'string' ? versionId : undefined,
      lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
    },
  };
}

function normalizeParameter(parameter: Record<string, any>): NormalizedParameter | null {
  if (!parameter?.name) {
    return null;
  }

  return {
    name: parameter.name,
    type: parameter.datatype || parameter.type || 'string',
    description: parameter.description,
    required: parameter.required !== undefined ? Boolean(parameter.required) : true,
  };
}

function normalizeValidation(validation: any): NormalizedDefaultTestCase[] {
  if (!Array.isArray(validation)) {
    return [];
  }

  return validation
    .map((entry) => normalizeValidationEntry(entry))
    .filter(Boolean) as NormalizedDefaultTestCase[];
}

function normalizeValidationEntry(entry: any): NormalizedDefaultTestCase | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const comparisonType = typeof entry.condition === 'string' ? entry.condition : 'custom';

  const expectedResult = {
    field: entry.field,
    value: entry.value,
    description: entry.description,
    operator: entry.operator,
    message: entry.message,
  };

  return {
    comparison_type: comparisonType,
    expected_result: expectedResult.value,
  };
}
