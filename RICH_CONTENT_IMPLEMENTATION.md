# Rich Content Implementation for TipTap Editor

This document outlines the implementation of rich content support for the TipTap editor in the NetGrader backend.

## Overview

The backend now supports rich content for lab parts using TipTap JSON format alongside HTML. This enables advanced text editing capabilities with rich formatting, images, code blocks, and other interactive elements.

## Changes Made

### 1. Rich Content Processing Utilities (`/src/utils/rich-content.ts`)

Created utility functions for processing rich content:

- **`processRichContent(html, json)`**: Main function that processes TipTap content
- **`extractPlainText(html)`**: Converts HTML to plain text
- **`countWords(text)`**: Counts words in text
- **`estimateReadingTime(wordCount)`**: Estimates reading time (200 words/minute)
- **`extractHeadingStructure(json)`**: Extracts heading outline from TipTap JSON
- **`hasImages(json)`**: Checks if content contains images
- **`hasCodeBlocks(json)`**: Checks if content contains code blocks

### 2. Updated Data Models (`/src/modules/parts/model.ts`)

Updated the lab parts model to support rich content:

```typescript
interface RichContent {
  html: string;           // HTML representation
  json: any;             // TipTap JSON document
  plainText: string;     // Plain text version
  metadata: {
    wordCount: number;
    characterCount: number;
    estimatedReadingTime: number;
    lastModified: Date;
    hasImages: boolean;
    hasCodeBlocks: boolean;
    headingStructure: Array<{
      level: number;
      text: string;
      id: string;
    }>;
  };
}
```

**Changed Fields:**
- `instructions`: `string` → `RichContent` (required)

**Fields with Default Values:**
- `description`: `string` with default `""` (normal string field)
- `tasks[].description`: `string` with default `""` (normal string field)
- `task_groups[].description`: `string` with default `""` (normal string field)
- `task_groups`: Array with default `[]`
- `prerequisites`: Array with default `[]`

**Added Fields:**
- `metadata`: Content statistics and versioning
- `assets`: Asset management for images/files

### 3. Updated API Schemas (`/src/modules/parts/index.ts`)

Updated validation schemas to accept rich content:

```typescript
const RichContentSchema = t.Object({
  html: t.String(),
  json: t.Any()
});
```

Only the main `instructions` field uses `RichContentSchema`. All `description` fields remain as normal strings with default empty values for better frontend compatibility.

### 4. Enhanced Service Layer (`/src/modules/parts/service.ts`)

Updated the service to:
- Process rich content only for the `instructions` field
- Calculate content metadata from instructions only
- Provide default empty strings for description fields
- Handle auto-save functionality for instructions
- Manage asset cleanup

### 5. New API Endpoints

#### Auto-Save Endpoint
```
POST {backendurl}/v0/parts/:id/auto-save
```

**Body:**
```json
{
  "labId": "string",
  "content": {
    "html": "string",
    "json": {}
  },
  "field": "instructions|description"
}
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "wordCount": 150
}
```

#### Load Auto-Saved Content Endpoint
```
GET {backendurl}/v0/parts/:id/auto-save/:field?labId=string
```

**Response:**
```json
{
  "success": true,
  "content": {
    "html": "string",
    "json": {},
    "plainText": "string",
    "metadata": {
      "wordCount": 150,
      "estimatedReadingTime": 1
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "wordCount": 150
}
```

#### Get Part with Auto-Save Status
```
GET {backendurl}/v0/parts/:id/with-autosave?labId=string
```

**Response:**
```json
{
  "id": "partId",
  "title": "Part Title",
  "instructions": { "html": "...", "json": {} },
  "autoSaveStatus": {
    "hasAutoSave": true,
    "isAutoSaveNewer": true,
    "autoSaveTimestamp": "2024-01-01T00:05:00.000Z",
    "lastModified": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Asset Cleanup Endpoint
```
POST {backendurl}/v0/parts/:id/cleanup-assets
```

**Body:**
```json
{
  "labId": "string",
  "currentAssets": ["asset1", "asset2"]
}
```

**Response:**
```json
{
  "success": true,
  "cleanedAssets": 3
}
```

## Frontend Integration Guide

### 1. Data Structure Changes

When sending data to the backend, structure content as:

```typescript
// Instructions field (rich content)
const partData = {
  instructions: {
    html: "<h1>My Instructions</h1><p>Some text...</p>",
    json: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "My Instructions" }]
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Some text..." }]
        }
      ]
    }
  },
  // Description fields (normal strings with defaults)
  description: "Optional description text", // or omit for default ""
  tasks: [{
    // ... other task fields
    description: "Task description" // or omit for default ""
  }],
  task_groups: [{
    // ... other group fields  
    description: "Group description" // or omit for default ""
  }]
};
```

### 2. TipTap Editor Integration

```typescript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const editor = new Editor({
  extensions: [StarterKit],
  content: partData.instructions?.json || '',
  onUpdate: ({ editor }) => {
    // Auto-save functionality
    const content = {
      html: editor.getHTML(),
      json: editor.getJSON()
    };
    
    // Call auto-save endpoint
    fetch(`${backendurl}/v0/parts/${id}/auto-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        labId,
        content,
        field: 'instructions'
      })
    });
  }
});
```

### 3. Displaying Rich Content

```typescript
// Render TipTap content
const content = partData.instructions?.json;
editor.commands.setContent(content);

// Or display HTML
const htmlContent = partData.instructions?.html;
```

### 4. Content Metadata Access

```typescript
// Only instructions field has rich content metadata
const instructionsMetadata = partData.instructions?.metadata;
console.log(`Word count: ${instructionsMetadata.wordCount}`);
console.log(`Reading time: ${instructionsMetadata.estimatedReadingTime} minutes`);
console.log(`Has images: ${instructionsMetadata.hasImages}`);
console.log(`Has code: ${instructionsMetadata.hasCodeBlocks}`);

// Table of contents from headings
instructionsMetadata.headingStructure.forEach(heading => {
  console.log(`${'  '.repeat(heading.level - 1)}${heading.text}`);
});

// Description fields are simple strings
console.log(`Part description: ${partData.description || 'No description'}`);
console.log(`Task description: ${partData.tasks[0]?.description || 'No description'}`);
```

### 5. Loading Saved Content

```typescript
// Load part with auto-save status
const loadPart = async (id: string, labId: string) => {
  const response = await fetch(`${backendurl}/v0/parts/${id}/with-autosave?labId=${labId}`);
  const partData = await response.json();
  
  // Check if there's newer auto-saved content
  if (partData.autoSaveStatus.isAutoSaveNewer) {
    const shouldRestore = confirm(
      `Auto-saved changes found from ${new Date(partData.autoSaveStatus.autoSaveTimestamp).toLocaleString()}. ` +
      'Would you like to restore them?'
    );
    
    if (shouldRestore) {
      // Load the auto-saved content
      const autoSaveResponse = await fetch(
        `${backendurl}/v0/parts/${id}/auto-save/instructions?labId=${labId}`
      );
      const autoSaveData = await autoSaveResponse.json();
      
      if (autoSaveData.success) {
        // Load auto-saved content into editor
        editor.commands.setContent(autoSaveData.content.json);
        console.log(`Restored auto-save from ${autoSaveData.timestamp}`);
      }
    }
  }
  
  // Otherwise load the regular saved content
  editor.commands.setContent(partData.instructions.json);
};
```

### 6. Asset Management

```typescript
// Track used assets in editor
const usedAssets = [];

// When images are added/removed, update asset list
editor.on('update', () => {
  const doc = editor.getJSON();
  const currentAssets = extractAssetIds(doc);
  
  // Cleanup unused assets
  fetch(`${backendurl}/v0/parts/${id}/cleanup-assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      labId,
      currentAssets
    })
  });
});
```

## Migration Notes

### Existing Data
- Only `instructions` field needs migration to rich content format
- `description` fields remain as strings, no migration needed
- Consider creating a migration script to convert existing instructions from markdown/HTML to TipTap JSON

### Backward Compatibility
- Description fields maintain full backward compatibility
- Instructions field requires rich content structure
- Default values ensure frontend doesn't need to send empty description fields

## Performance Considerations

1. **Auto-save**: Debounce auto-save calls to avoid excessive API requests
2. **Asset cleanup**: Run periodically, not on every content change
3. **Content processing**: Word counting and metadata extraction happen server-side

## Security Notes

1. **HTML sanitization**: The backend processes HTML but should sanitize it before storage
2. **Asset validation**: Validate uploaded assets for type and size
3. **Content validation**: Validate TipTap JSON structure to prevent malicious content

## Testing

Test the following scenarios:
1. Creating parts with rich content
2. Updating parts with rich content
3. Auto-save functionality
4. **Loading auto-saved content**
5. **Auto-save recovery workflows**
6. Asset cleanup
7. Content metadata generation
8. Backwards compatibility with existing data

## Example Complete Implementation

```typescript
// Frontend component example
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const PartEditor = ({ partId, labId, initialContent }) => {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent?.json || '',
    onUpdate: debounce(({ editor }) => {
      const content = {
        html: editor.getHTML(),
        json: editor.getJSON()
      };
      
      // Auto-save
      autoSave(partId, labId, content, 'instructions');
    }, 1000)
  });

  const savePart = async () => {
    const content = {
      html: editor.getHTML(),
      json: editor.getJSON()
    };

    await fetch(`${backendurl}/v0/parts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instructions: content,
        // ... other fields
      })
    });
  };

  return (
    <div>
      <EditorContent editor={editor} />
      <button onClick={savePart}>Save</button>
    </div>
  );
};
```

This implementation provides a robust foundation for rich text editing while maintaining performance and data integrity.