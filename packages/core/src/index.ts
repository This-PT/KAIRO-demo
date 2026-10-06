import { z } from "zod";

export const Visibility = z.enum(["readable", "restricted"]);
export type Visibility = z.infer<typeof Visibility>;

export const NormalizedTicket = z.object({
  key: z.string(),
  project: z.string(),
  url: z.string(),
  title: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  description: z.string(),
  comments: z.array(z.object({ author: z.string(), created: z.string(), body: z.string() })),
  changelog: z.array(
    z.object({ author: z.string(), created: z.string(), field: z.string(), from: z.string().nullable(), to: z.string().nullable() }),
  ),
  links: z.array(z.object({ type: z.string(), key: z.string() })),
  updated: z.string(),
  issueType: z.string().default("Task"),
  /** Key of the parent ticket (epic for a story, story for a sub-task) */
  parent: z.string().nullable().default(null),
  assignee: z.string().nullable().default(null),
});
export type NormalizedTicket = z.infer<typeof NormalizedTicket>;
export * from "./render";
export * from "./summary";
