import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const ListClientsInput = z.object({
    status: z.enum(["active", "inactive", "prospect"]).optional(),
});
export const listClientsTool = {
    name: "list_clients",
    description: "List accessible clients, optionally filtered by status.",
    inputSchema: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["active", "inactive", "prospect"],
                description: "Filter by client status",
            },
        },
    },
};
export async function handleListClients(db, args) {
    const input = ListClientsInput.parse(args ?? {});
    let query = db.from("clients").select("id, name, status, metadata");
    if (input.status) {
        query = query.eq("status", input.status);
    }
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ clients: data ?? [] });
}
//# sourceMappingURL=knowledge-list-clients.js.map