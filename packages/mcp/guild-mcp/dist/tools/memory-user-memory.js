import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const UserGetInput = z.object({
    user_id: z.string().uuid().optional(),
    namespace: z.string().optional(),
    tags: z.array(z.string()).optional(),
});
const UserSetInput = z.object({
    user_id: z.string().uuid().optional(),
    namespace: z.string(),
    key: z.string(),
    value: z.string(),
    tags: z.array(z.string()).optional(),
});
const UserDeleteInput = z.object({
    user_id: z.string().uuid().optional(),
    namespace: z.string(),
    key: z.string(),
});
export const userGetMemoriesTool = {
    name: "user_get_memories",
    description: "Retrieve user memories. Agents must specify user_id; users default to self.",
    inputSchema: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "User UUID (agents must specify)" },
            namespace: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
        },
    },
};
export const userSetMemoryTool = {
    name: "user_set_memory",
    description: "Create or update a user memory.",
    inputSchema: {
        type: "object",
        properties: {
            user_id: { type: "string" },
            namespace: { type: "string" },
            key: { type: "string" },
            value: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
        },
        required: ["namespace", "key", "value"],
    },
};
export const userDeleteMemoryTool = {
    name: "user_delete_memory",
    description: "Delete a user memory by namespace and key.",
    inputSchema: {
        type: "object",
        properties: {
            user_id: { type: "string" },
            namespace: { type: "string" },
            key: { type: "string" },
        },
        required: ["namespace", "key"],
    },
};
export async function handleUserGetMemories(db, args) {
    const input = UserGetInput.parse(args ?? {});
    let query = db.from("user_memories").select("*");
    if (input.user_id)
        query = query.eq("user_id", input.user_id);
    if (input.namespace)
        query = query.eq("namespace", input.namespace);
    if (input.tags?.length)
        query = query.contains("tags", input.tags);
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ memories: data ?? [] });
}
export async function handleUserSetMemory(db, args) {
    const input = UserSetInput.parse(args);
    const record = {
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        tags: input.tags ?? [],
    };
    if (input.user_id)
        record.user_id = input.user_id;
    const { data, error } = await db
        .from("user_memories")
        .upsert(record, {
        onConflict: "user_id,namespace,key",
        ignoreDuplicates: false,
    })
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return mcpJson({ memory: data });
}
export async function handleUserDeleteMemory(db, args) {
    const input = UserDeleteInput.parse(args);
    let query = db
        .from("user_memories")
        .delete()
        .eq("namespace", input.namespace)
        .eq("key", input.key);
    if (input.user_id)
        query = query.eq("user_id", input.user_id);
    const { error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ deleted: true });
}
//# sourceMappingURL=memory-user-memory.js.map