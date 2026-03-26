import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';
import type { DynamicStructuredTool } from '@langchain/core/tools';

export function toolsToOpenAiFunctions(tools: DynamicStructuredTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema as ZodType, {
        target: 'openApi3',
      }),
    },
  }));
}
