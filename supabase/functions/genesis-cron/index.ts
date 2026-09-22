import { json, serviceClient } from "../_shared/supabase.ts";
import { processDueReminders } from "../_shared/agent.ts";

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("GENESIS_CRON_SECRET") || "";
    const header = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
    if (secret && header !== secret) return json({ error: "unauthorized" }, 401);
    const db = serviceClient();
    const results = await processDueReminders(db);
    return json({ ok: true, results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
