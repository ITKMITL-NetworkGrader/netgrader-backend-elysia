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

/**
 * Get the raw YAML content for a MinIO template by its templateId
 * @param templateId - The template ID to get raw content for
 * @returns The raw YAML content as a string, or null if not found
 */
export async function getRawYamlContent(templateId: string): Promise<string | null> {
  try {
    const client = getSafeMinioClient();
    if (!client) {
      return null;
    }

    // First, get the template to find its objectName
    const template = await getCustomTaskTemplateById(templateId);
    if (!template || !template.metadata?.objectName) {
      return null;
    }

    // Load the raw content from MinIO
    const rawContent = await loadObjectData(client, template.metadata.objectName);
    return rawContent;
  } catch (error) {
    console.error(`Failed to get raw YAML content for template '${templateId}':`, (error as Error).message);
    return null;
  }
}

/**
 * Update a MinIO template file with new YAML content
 * @param templateId - The template ID to update
 * @param content - The new YAML content
 * @returns True if successful, false otherwise
 */
export async function updateTemplateFile(templateId: string, content: string): Promise<boolean> {
  try {
    const client = getSafeMinioClient();
    if (!client) {
      throw new Error('MinIO client not available');
    }

    // Get the existing template to find its objectName
    const template = await getCustomTaskTemplateById(templateId);
    if (!template || !template.metadata?.objectName) {
      throw new Error(`Template '${templateId}' not found in MinIO`);
    }

    const objectName = template.metadata.objectName;
    const buffer = Buffer.from(content, 'utf-8');

    // Upload the updated content
    await client.putObject(
      BUCKET_NAME,
      objectName,
      buffer,
      buffer.length,
      {
        'Content-Type': 'text/yaml',
      }
    );

    // Clear cache to pick up the changes
    clearCustomTaskTemplateCache();

    return true;
  } catch (error) {
    console.error(`Failed to update template file '${templateId}':`, (error as Error).message);
    throw error;
  }
}

/**
 * Delete a MinIO template file
 * @param templateId - The template ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteTemplateFile(templateId: string): Promise<boolean> {
  try {
    const client = getSafeMinioClient();
    if (!client) {
      throw new Error('MinIO client not available');
    }

    // Get the existing template to find its objectName
    const template = await getCustomTaskTemplateById(templateId);
    if (!template || !template.metadata?.objectName) {
      throw new Error(`Template '${templateId}' not found in MinIO`);
    }

    const objectName = template.metadata.objectName;

    // Delete the object from MinIO
    await client.removeObject(BUCKET_NAME, objectName);

    // Clear cache to reflect the deletion
    clearCustomTaskTemplateCache();

    return true;
  } catch (error) {
    console.error(`Failed to delete template file '${templateId}':`, (error as Error).message);
    throw error;
  }
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
  return yaml.load(data, { schema: yaml.JSON_SCHEMA }) as Record<string, any>;
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
