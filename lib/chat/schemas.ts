import { z } from 'zod';

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 48_000;

const partSchema = z.object({
  text: z.string().optional(),
});

/** 前端 / 客户端发来的单条对话 */
export const chatClientMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(MAX_MESSAGE_CHARS).optional(),
  parts: z.array(partSchema).max(500).optional(),
});

export type ChatClientMessage = z.infer<typeof chatClientMessageSchema>;

export function normalizeClientMessageContent(msg: ChatClientMessage): string {
  const fromParts = msg.parts?.map((p) => p.text ?? '').join('') ?? '';
  const text = (msg.content ?? '').trim().length ? (msg.content ?? '') : fromParts;
  return typeof text === 'string' ? text : '';
}

export const chatPostBodySchema = z
  .object({
    model: z.string().min(1).max(128).default('llama3.2'),
    messages: z
      .array(chatClientMessageSchema)
      .min(1, '至少一条消息')
      .max(MAX_MESSAGES, `最多 ${MAX_MESSAGES} 条消息`),
    temperature: z.number().min(0).max(2).optional(),
  })
  .superRefine((data, ctx) => {
    const last = data.messages[data.messages.length - 1];
    if (!last || last.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '最后一条消息须为用户（user）',
        path: ['messages'],
      });
      return;
    }
    const content = normalizeClientMessageContent(last);
    if (!content.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '用户消息内容不能为空',
        path: ['messages', data.messages.length - 1],
      });
    }
  });

export type ChatPostBody = z.infer<typeof chatPostBodySchema>;

const teamMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(MAX_MESSAGE_CHARS).default(''),
});

/** Team API：messages 与 question 二选一（由 refine 约束） */
export const teamPostBodySchema = z
  .object({
    model: z.string().min(1).max(128).default('llama3.2'),
    teamId: z.union([z.string(), z.null()]).optional(),
    messages: z.array(teamMessageSchema).max(MAX_MESSAGES).optional(),
    question: z.string().max(MAX_MESSAGE_CHARS).optional(),
  })
  .refine(
    (d) =>
      (d.messages != null && d.messages.length > 0) ||
      Boolean(d.question?.trim()),
    { message: '请提供 messages 或 question', path: ['messages'] }
  );

export type TeamPostBody = z.infer<typeof teamPostBodySchema>;
